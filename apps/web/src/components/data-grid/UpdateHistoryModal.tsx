import { useProjectUpdateHistory } from '../../hooks/useProjectUpdates';
import { FIELD_LABELS, FIELD_TYPES, NUMBER_FIELDS } from '../../lib/projectFields';
import { formatGridDate, formatGridNumber } from '../../lib/format';
import type { Project, ProjectUpdateEntry } from '@tracker/shared';
import { Modal } from '../ui/Modal';

// Vendor-line field keys, so history entries render the same formatting as the
// project-level ones (dates and rupiah amounts).
const DATE_KEYS = new Set([
  ...Object.entries(FIELD_TYPES)
    .filter(([, type]) => type === 'date')
    .map(([key]) => key),
  'project_sent_date',
  'project_finish_date',
  'negotiation_date',
  'approval_date',
  'document_sent_date',
  'vendor_start_contract',
  'vendor_end_contract',
]);
const MONEY_KEYS = new Set([...NUMBER_FIELDS, 'vendor_revenue', 'vendor_price']);

// Old/new values are stored as raw JSON, so format them the same way the grid
// does: dates as "15 September 2026", amounts as "Rp 1,234,567".
function fmtValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (MONEY_KEYS.has(key)) {
    const n = Number(value);
    if (!Number.isNaN(n)) return `Rp ${formatGridNumber(n)}`;
  }
  if (DATE_KEYS.has(key)) return formatGridDate(String(value));
  return String(value);
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function HistoryEntryCard({ entry }: { entry: ProjectUpdateEntry }) {
  const fields = Object.keys(entry.changes);
  return (
    <div className="rounded border border-border p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-ink">{entry.staff_name ?? '(deleted user)'}</span>
        <span className="text-xs text-ink-muted">{fmtDate(entry.created_at)}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <table className="w-full border-collapse text-sm md:col-span-2">
          <tbody>
            {fields.map((key) => (
              <tr key={key} className="border-b border-border/60 align-top">
                <td className="w-2/5 py-1 pr-2 text-ink-muted">{FIELD_LABELS[key] ?? key}</td>
                <td className="w-1/4 py-1 pr-2 text-ink-muted line-through">{fmtValue(key, entry.changes[key].old)}</td>
                <td className="py-1 font-medium text-success">→ {fmtValue(key, entry.changes[key].new)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rounded bg-warning-soft p-2 text-sm text-ink md:col-span-1">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-warning">Update Progress</p>
          {entry.update_progress}
        </div>
      </div>
    </div>
  );
}

export function UpdateHistoryModal({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const { data, isLoading, isError } = useProjectUpdateHistory(project?.id ?? null);
  if (!project) return null;

  return (
    <Modal
      ariaLabel={`Update history — ${project.project_name}`}
      eyebrow="Update history"
      title={project.project_name}
      onClose={onClose}
      maxWidthClass="max-w-3xl"
    >
      <div className="space-y-3 px-5 py-4">
        {isLoading && <p className="text-sm text-ink-muted">Loading history…</p>}
        {isError && <p className="text-sm text-danger">Could not load update history.</p>}
        {!isLoading && !isError && (data?.entries.length ?? 0) === 0 && (
          <p className="text-sm text-ink-muted">No updates recorded for this project yet.</p>
        )}
        {data?.entries.map((entry) => <HistoryEntryCard key={entry.id} entry={entry} />)}
      </div>
    </Modal>
  );
}
