import { useMemo } from 'react';
import { IMPORT_FIELDS, IMPORT_DATE_FORMATS } from '@tracker/shared';
import type { ImportDateFormat, ImportOptions } from '@tracker/shared';
import { FieldSelect, fieldTypeInfo } from './FieldSelect';
import { columnSamples, type MappingSuggestion } from '../../lib/csvImport';
import { Select } from '../ui/Input';
import { cn } from '../ui/cn';

export interface MappingStepProps {
  headers: string[];
  /** Raw CSV rows — used for the per-column sample values. */
  rows: string[][];
  suggestions: MappingSuggestion[];
  mapping: Record<string, string | null>;
  onMappingChange: (next: Record<string, string | null>) => void;
  options: ImportOptions;
  onOptionsChange: (next: ImportOptions) => void;
  saveMapping: boolean;
  onSaveMappingChange: (value: boolean) => void;
  /** Ready flag for "Next" — only project_name is mandatory (plan §4). */
  projectMapped: boolean;
}

/**
 * Wizard step 2: one row per CSV column with the plan's exact sentence —
 * `"Header" will be mapped to [Field] (in the platform)` — the chosen field's
 * description and type hint, sample values, suggested tags, the required
 * Project Name banner and the import options.
 */
export function ColumnMappingStep({
  headers,
  rows,
  suggestions,
  mapping,
  onMappingChange,
  options,
  onOptionsChange,
  saveMapping,
  onSaveMappingChange,
  projectMapped,
}: MappingStepProps) {
  // fieldKey -> CSV header using it (prevents choosing a field twice).
  const usedBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of headers) {
      const key = mapping[h];
      if (key && !map.has(key)) map.set(key, h);
    }
    return map;
  }, [headers, mapping]);

  const sourceOf = useMemo(() => {
    const map = new Map<string, MappingSuggestion['source']>();
    for (const s of suggestions) map.set(s.header, s.source);
    return map;
  }, [suggestions]);

  const colIndex = (header: string) => headers.indexOf(header);
  const vendorMapped = headers.some((h) => mapping[h] === 'vendor_name');

  const setField = (header: string, key: string | null) =>
    onMappingChange({ ...mapping, [header]: key });

  return (
    <div className="space-y-4 px-5 py-4">
      {!projectMapped && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-ink"
        >
          Map a CSV column to <strong>Project Name</strong> to continue.
        </div>
      )}

      {!vendorMapped && (
        <div className="rounded-md border border-border bg-canvas px-3 py-2 text-sm text-ink-muted">
          No vendor column mapped: projects will be created without vendor lines.
        </div>
      )}

      <div className="space-y-3">
        {headers.map((header) => {
          const selectedKey = mapping[header] ?? null;
          const field = selectedKey ? IMPORT_FIELDS.find((f) => f.key === selectedKey) : undefined;
          const samples = columnSamples(rows, colIndex(header), 3);
          const source = sourceOf.get(header) ?? 'none';
          return (
            <div key={header} className="rounded-md border border-border bg-surface px-3 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-ink">“{header}”</span>
                {samples.length > 0 && (
                  <span className="text-xs text-ink-muted">
                    sample: {samples.join(', ')}
                  </span>
                )}
                {source !== 'none' && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      source === 'saved'
                        ? 'bg-accent/10 text-accent'
                        : 'bg-emerald-100 text-emerald-700',
                    )}
                    title={
                      source === 'saved'
                        ? 'From your saved mapping'
                        : 'Suggested from a matching name — please check'
                    }
                  >
                    {source === 'saved' ? 'saved' : 'suggested'}
                  </span>
                )}
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
                <span>(from the CSV) will be mapped to</span>
                <FieldSelect
                  value={selectedKey}
                  usedBy={usedBy}
                  header={header}
                  onChange={(key) => setField(header, key)}
                  ariaLabel={`Platform field for CSV column ${header}`}
                />
                <span>(in the platform)</span>
              </div>

              {field && (
                <div className="mt-1.5 space-y-0.5 pl-1">
                  <p className="text-xs text-ink-muted">{field.description}</p>
                  <p className="text-xs font-medium text-ink-muted/80">{fieldTypeInfo(field)}</p>
                  {samples.length > 0 && (
                    <p className="text-xs text-ink-muted/80">Values in this file: {samples.join(', ')}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <fieldset className="rounded-md border border-border bg-canvas px-3 py-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Import options
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-start gap-2 text-sm text-ink sm:col-span-3">
            <input
              type="checkbox"
              checked={options.continueBlankRows}
              onChange={(e) => onOptionsChange({ ...options, continueBlankRows: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              Blank project cells continue the row above
              <span className="block text-xs text-ink-muted">
                Grid-style CSV: each project is spread over several rows.
              </span>
            </span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
            Date format
            <Select
              value={options.dateFormat}
              onChange={(e) =>
                onOptionsChange({ ...options, dateFormat: e.target.value as ImportDateFormat })
              }
              className="py-1.5"
              aria-label="Date format"
            >
              {IMPORT_DATE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
            If a project already exists
            <Select
              value={options.onDuplicate}
              onChange={(e) =>
                onOptionsChange({ ...options, onDuplicate: e.target.value as 'skip' | 'reject' })
              }
              className="py-1.5"
              aria-label="If a project already exists"
            >
              <option value="skip">Skip it</option>
              <option value="reject">Reject the whole import</option>
            </Select>
          </label>
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={saveMapping}
          onChange={(e) => onSaveMappingChange(e.target.checked)}
        />
        Save this mapping for next time
      </label>
    </div>
  );
}
