import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { IMPORT_MAX_ROWS, importFieldLabel } from '@tracker/shared';
import type {
  ImportCommitResponse,
  ImportOptions,
  ImportPreviewResponse,
  ImportSampleProject,
  ProjectImportRequest,
} from '@tracker/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../Toast';
import { ApiError } from '../../lib/api-client';
import {
  useCommitImport,
  useImportMapping,
  usePreviewImport,
} from '../../hooks/useImport';
import {
  applyMapping,
  blankProjectNameCount,
  downloadTemplateCsv,
  parseCsvFile,
  suggestMapping,
  type ParsedCsv,
} from '../../lib/csvImport';
import { ColumnMappingStep } from './ColumnMappingStep';

type Step = 1 | 2 | 3 | 4;

interface ImportCsvModalProps {
  onClose: () => void;
  /** Called after a successful commit so the grid can refetch. */
  onImported?: () => void;
}

const DEFAULT_OPTIONS: ImportOptions = {
  continueBlankRows: true,
  dateFormat: 'DD/MM/YYYY',
  onDuplicate: 'skip',
};

/**
 * The four-step CSV import wizard (plan §4): choose file → map columns →
 * preview & validate → confirm & result. The CSV is parsed entirely in the
 * browser; only the mapped rows reach the server, first for preview (no
 * writes) and then for the all-or-nothing commit.
 */
export function ImportCsvModal({ onClose, onImported }: ImportCsvModalProps) {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const saved = useImportMapping();
  const preview = usePreviewImport();
  const commit = useCommitImport();

  const [step, setStep] = useState<Step>(1);
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [mappingReady, setMappingReady] = useState(false);
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_OPTIONS);
  const [saveMapping, setSaveMapping] = useState(true);
  const [result, setResult] = useState<ImportCommitResponse | null>(null);

  // Seed the mapping once both the file and the saved mapping are available.
  // The saved mapping wins over header auto-matching (plan §4 step 2), and the
  // seed runs once per file so later edits are never clobbered.
  useEffect(() => {
    if (!csv || mappingReady || saved.isLoading) return;
    const suggested = suggestMapping(csv.headers, saved.mapping);
    setMapping(Object.fromEntries(suggested.map((s) => [s.header, s.fieldKey])));
    setMappingReady(true);
  }, [csv, mappingReady, saved.isLoading, saved.mapping]);

  // Grid-style CSVs: auto-tick the continuation option when blank cells exist
  // in the column mapped to Project Name (never unticks the user's choice).
  useEffect(() => {
    if (!csv || !mappingReady) return;
    if (blankProjectNameCount(csv.headers, csv.rows, mapping) > 0) {
      setOptions((o) => (o.continueBlankRows ? o : { ...o, continueBlankRows: true }));
    }
  }, [csv, mapping, mappingReady]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setParsing(true);
    setFileError(null);
    preview.reset();
    commit.reset();
    setResult(null);
    try {
      const parsed = await parseCsvFile(file);
      setCsv(parsed);
      setMapping({});
      setMappingReady(false);
      setOptions(DEFAULT_OPTIONS);
      setStep(1);
    } catch (e) {
      setCsv(null);
      setFileError(e instanceof Error ? e.message : 'Could not read this file.');
    } finally {
      setParsing(false);
    }
  };

  const projectMapped = Object.values(mapping).includes('project_name');
  const tooManyRows = csv !== null && csv.rowCount > IMPORT_MAX_ROWS;

  const requestBody: ProjectImportRequest = useMemo(
    () => ({
      options,
      rows: csv ? applyMapping(csv.headers, csv.rows, mapping) : [],
    }),
    [csv, options, mapping],
  );

  const hasErrors = (preview.data?.summary.errors ?? 0) > 0;

  const startPreview = () => {
    setStep(3);
    preview.mutate(requestBody);
  };

  const nextFromMapping = () => {
    // "Save this mapping for next time" (ticked by default) — fire and forget;
    // a failure shows a toast via the hook.
    if (saveMapping) saved.save.mutate({ mapping, version: 1 });
    startPreview();
  };

  const runCommit = () => {
    commit.mutate(requestBody, {
      onSuccess: (res) => {
        setResult(res);
        void qc.invalidateQueries({ queryKey: ['projects'] });
        void qc.invalidateQueries({ queryKey: ['entities'] });
        onImported?.();
        const n = res.created_projects;
        showToast(
          `Imported ${n} project${n === 1 ? '' : 's'}${
            res.skipped_duplicates > 0 ? `, skipped ${res.skipped_duplicates} duplicate${res.skipped_duplicates === 1 ? '' : 's'}` : ''
          }.`,
          'success',
        );
      },
    });
  };

  const close = () => {
    if (commit.isPending) return;
    onClose();
  };

  const apiErrorMessage = (e: unknown): string =>
    e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';

  // -- footer per step -------------------------------------------------------
  const footer = (() => {
    if (step === 1) {
      return (
        <>
          <Button
            onClick={() => setStep(2)}
            disabled={!csv || tooManyRows || parsing || saved.isLoading}
          >
            Next: Map columns
          </Button>
        </>
      );
    }
    if (step === 2) {
      return (
        <>
          <Button variant="secondary" onClick={() => setStep(1)}>
            Back
          </Button>
          <Button onClick={nextFromMapping} disabled={!projectMapped || preview.isPending}>
            {preview.isPending ? 'Validating…' : 'Next: Preview'}
          </Button>
        </>
      );
    }
    if (step === 3) {
      return (
        <>
          <Button variant="secondary" onClick={() => setStep(2)}>
            Back
          </Button>
          <Button
            onClick={() => setStep(4)}
            disabled={!preview.data || preview.isPending || preview.isError || hasErrors}
          >
            Next: Confirm
          </Button>
        </>
      );
    }
    // step 4
    if (result) {
      return <Button onClick={onClose}>Close</Button>;
    }
    return (
      <>
        <Button variant="secondary" onClick={() => setStep(3)} disabled={commit.isPending}>
          Back
        </Button>
        <Button onClick={runCommit} disabled={commit.isPending}>
          {commit.isPending ? 'Importing…' : `Import ${preview.data?.summary.projects ?? 0} project${(preview.data?.summary.projects ?? 0) === 1 ? '' : 's'}`}
        </Button>
      </>
    );
  })();

  return (
    <Modal
      ariaLabel="Import projects from CSV"
      eyebrow={`Step ${result ? 4 : step} of 4`}
      title="Import projects from CSV"
      onClose={close}
      footer={footer}
      maxWidthClass="max-w-4xl"
      closeOnOverlayClick={!commit.isPending}
    >
      {/* -- Step 1: choose file -- */}
      {step === 1 && (
        <div className="space-y-4 px-5 py-4">
          <div className="rounded-md border border-dashed border-border bg-canvas px-4 py-6 text-center">
            <p className="text-sm text-ink">
              Choose a <code className="rounded bg-surface px-1">.csv</code> file exported from
              Excel or your other tool. Nothing is uploaded until you reach the preview step.
            </p>
            <label className="mt-3 inline-block">
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => void onFile(e.target.files?.[0])}
                data-testid="import-file-input"
              />
              <span className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas">
                Choose file…
              </span>
            </label>
            <p className="mt-3 text-xs text-ink-muted">
              Or{' '}
              <button
                type="button"
                onClick={downloadTemplateCsv}
                className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
                data-testid="download-template"
              >
                Download CSV template
              </button>
            </p>
          </div>

          {parsing && (
            <p className="flex items-center gap-2 text-sm text-ink-muted">
              <Spinner /> Reading file…
            </p>
          )}
          {fileError && (
            <p role="alert" className="text-sm text-danger">
              {fileError}
            </p>
          )}
          {csv && (
            <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink">
              <p>
                <strong>{csv.fileName}</strong>
              </p>
              <p className="text-ink-muted">
                {csv.rowCount.toLocaleString()} data rows, {csv.headers.length} columns, delimiter:{' '}
                {csv.delimiterLabel}
              </p>
            </div>
          )}
          {tooManyRows && (
            <p role="alert" className="text-sm text-danger">
              This file has {csv?.rowCount.toLocaleString()} rows; the import limit is{' '}
              {IMPORT_MAX_ROWS.toLocaleString()} rows.
            </p>
          )}
        </div>
      )}

      {/* -- Step 2: map columns -- */}
      {step === 2 && csv && (
        <ColumnMappingStep
          headers={csv.headers}
          rows={csv.rows}
          suggestions={suggestMapping(csv.headers, saved.mapping)}
          mapping={mapping}
          onMappingChange={setMapping}
          options={options}
          onOptionsChange={setOptions}
          saveMapping={saveMapping}
          onSaveMappingChange={setSaveMapping}
          projectMapped={projectMapped}
        />
      )}

      {/* -- Step 3: preview & validate -- */}
      {step === 3 && (
        <div className="space-y-4 px-5 py-4">
          {preview.isPending && (
            <p className="flex items-center gap-2 text-sm text-ink-muted">
              <Spinner /> Validating rows — nothing is written…
            </p>
          )}
          {preview.isError && (
            <div className="space-y-3">
              <p role="alert" className="text-sm text-danger">
                {apiErrorMessage(preview.error)}
              </p>
              <Button variant="secondary" onClick={() => preview.mutate(requestBody)}>
                Try again
              </Button>
            </div>
          )}
          {preview.data && <PreviewBody preview={preview.data} />}
        </div>
      )}

      {/* -- Step 4: confirm / result -- */}
      {step === 4 && (
        <div className="space-y-4 px-5 py-4">
          {result ? (
            <div className="space-y-3" data-testid="import-result">
              <h3 className="text-base font-semibold text-ink">
                {result.created_projects} project{result.created_projects === 1 ? '' : 's'} imported
              </h3>
              <ul className="grid grid-cols-2 gap-2 text-sm text-ink sm:grid-cols-3">
                <ResultLine label="Vendor lines" value={result.created_vendor_lines} />
                <ResultLine label="New customers" value={result.created_customers} />
                <ResultLine label="New vendors" value={result.created_vendors} />
                <ResultLine label="New market segments" value={result.created_segments} />
                <ResultLine label="Skipped duplicates" value={result.skipped_duplicates} />
              </ul>
              <p className="text-sm text-ink-muted">The grid has been refreshed.</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-ink">
                Review the numbers below. The import runs in one transaction: either every project
                is created, or nothing is.
              </p>
              {preview.data && <SummaryList summary={preview.data.summary} />}
              {preview.data?.notes.map((n) => (
                <p key={n} className="text-sm text-ink-muted">
                  {n}
                </p>
              ))}
              {commit.isError && (
                <p role="alert" className="text-sm text-danger">
                  {apiErrorMessage(commit.error)}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function ResultLine({ label, value }: { label: string; value: number }) {
  return (
    <li className="rounded-md border border-border bg-canvas px-2 py-1.5">
      <span className="block text-xs text-ink-muted">{label}</span>
      <span className="font-semibold text-ink">{value.toLocaleString()}</span>
    </li>
  );
}

function SummaryList({ summary }: { summary: ImportPreviewResponse['summary'] }) {
  const items: [string, number, boolean?][] = [
    ['Projects to create', summary.projects],
    ['Vendor lines to create', summary.vendor_lines],
    ['New customers', summary.new_customers.length],
    ['New vendors', summary.new_vendors.length],
    ['New market segments', summary.new_segments.length],
    ['Rows skipped as duplicates', summary.skipped_duplicates],
    ['Rows with errors', summary.errors, true],
    ['Warnings', summary.warnings],
  ];
  return (
    <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      {items.map(([label, value, isDanger]) => (
        <li key={label} className="rounded-md border border-border bg-canvas px-2 py-1.5">
          <span className="block text-xs text-ink-muted">{label}</span>
          <span className={`font-semibold ${isDanger && value > 0 ? 'text-danger' : 'text-ink'}`}>
            {value.toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PreviewBody({ preview }: { preview: ImportPreviewResponse }) {
  const maxShown = 100;
  return (
    <div className="space-y-4">
      <SummaryList summary={preview.summary} />

      {preview.notes.map((n) => (
        <p key={n} className="rounded-md border border-border bg-canvas px-3 py-2 text-sm text-ink-muted">
          {n}
        </p>
      ))}

      {preview.errors.length > 0 && (
        <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2">
          <p className="mb-1 text-sm font-semibold text-danger">
            Fix these rows before importing ({preview.summary.errors}):
          </p>
          <ul className="max-h-40 space-y-0.5 overflow-auto text-sm text-ink">
            {preview.errors.slice(0, maxShown).map((e, i) => (
              <li key={i}>
                Row {e.row}: {e.message}
              </li>
            ))}
            {preview.errors.length > maxShown && (
              <li className="text-ink-muted">…and {preview.errors.length - maxShown} more.</li>
            )}
          </ul>
        </div>
      )}

      {preview.warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="mb-1 text-sm font-semibold text-ink">Warnings ({preview.summary.warnings}):</p>
          <ul className="max-h-32 space-y-0.5 overflow-auto text-sm text-ink">
            {preview.warnings.slice(0, maxShown).map((w, i) => (
              <li key={i}>
                Row {w.row}: {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          First {preview.sample.length} project{preview.sample.length === 1 ? '' : 's'}
          {preview.sample_truncated ? ' of more' : ''}
        </p>
        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-xs text-ink-muted">
              <tr>
                <th className="px-3 py-1.5 font-medium">Rows</th>
                <th className="px-3 py-1.5 font-medium">{importFieldLabel('project_name')}</th>
                <th className="px-3 py-1.5 font-medium">Vendor lines</th>
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((p, i) => (
                <SampleRow key={i} project={p} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SampleRow({ project }: { project: ImportSampleProject }) {
  const name = String(project.values.project_name ?? '—');
  const folder = project.values.folder_name;
  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-1.5 text-xs text-ink-muted">{project.rows.join(', ')}</td>
      <td className="px-3 py-1.5">
        <span className="font-medium text-ink">{name}</span>
        {folder ? <span className="block text-xs text-ink-muted">{String(folder)}</span> : null}
      </td>
      <td className="px-3 py-1.5">
        <ul className="space-y-0.5 text-xs text-ink">
          {project.lines.map((line, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <span className="font-medium">{String(line.values.vendor_name ?? '(no vendor)')}</span>
              {line.values.project_sent_date ? (
                <span className="text-ink-muted">
                  {importFieldLabel('project_sent_date')}: {String(line.values.project_sent_date)}
                </span>
              ) : null}
              {line.values.approval_date ? (
                <span className="text-ink-muted">
                  {importFieldLabel('approval_date')}: {String(line.values.approval_date)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </td>
    </tr>
  );
}
