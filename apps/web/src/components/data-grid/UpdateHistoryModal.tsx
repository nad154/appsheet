import { useProjectUpdateHistory } from '../../hooks/useProjectUpdates';
import { FIELD_LABELS } from '../../lib/projectFields';
import type { Project, ProjectUpdateEntry } from '@tracker/shared';
import { Modal } from '../ui/Modal';

function fmt(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
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
        <span className="text-sm font-semibold text-ink">{entry.staff_name}</span>
        <span className="text-xs text-ink-muted">{fmtDate(entry.created_at)}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <table className="w-full border-collapse text-sm md:col-span-2">
          <tbody>
            {fields.map((key) => (
              <tr key={key} className="border-b border-border/60 align-top">
                <td className="w-2/5 py-1 pr-2 text-ink-muted">{FIELD_LABELS[key] ?? key}</td>
                <td className="w-1/4 py-1 pr-2 text-ink-muted line-through">{fmt(entry.changes[key].old)}</td>
                <td className="py-1 font-medium text-success">→ {fmt(entry.changes[key].new)}</td>
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
