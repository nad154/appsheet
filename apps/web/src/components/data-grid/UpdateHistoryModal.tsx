import { createPortal } from 'react-dom';
import { useProjectUpdateHistory } from '../../hooks/useProjectUpdates';
import { FIELD_LABELS } from '../../lib/projectFields';
import type { Project, ProjectUpdateEntry } from '@tracker/shared';

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
    <div className="rounded border border-gray-200 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-gray-800">{entry.staff_name}</span>
        <span className="text-xs text-gray-400">{fmtDate(entry.created_at)}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <table className="w-full border-collapse text-sm md:col-span-2">
          <tbody>
            {fields.map((key) => (
              <tr key={key} className="border-b border-gray-100 align-top">
                <td className="w-2/5 py-1 pr-2 text-gray-500">{FIELD_LABELS[key] ?? key}</td>
                <td className="w-1/4 py-1 pr-2 text-gray-400 line-through">{fmt(entry.changes[key].old)}</td>
                <td className="py-1 font-medium text-green-700">→ {fmt(entry.changes[key].new)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rounded bg-amber-50 p-2 text-sm text-gray-700 md:col-span-1">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Update Progress</p>
          {entry.update_progress}
        </div>
      </div>
    </div>
  );
}

export function UpdateHistoryModal({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const { data, isLoading, isError } = useProjectUpdateHistory(project?.id ?? null);
  if (!project) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="presentation">
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Update history — ${project.project_name}`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-base font-semibold text-gray-800">{project.project_name} — Update History</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">✕</button>
        </div>
        <div className="space-y-3 px-5 py-4">
          {isLoading && <p className="text-sm text-gray-500">Loading history…</p>}
          {isError && <p className="text-sm text-red-600">Could not load update history.</p>}
          {!isLoading && !isError && (data?.entries.length ?? 0) === 0 && (
            <p className="text-sm text-gray-400">No updates recorded for this project yet.</p>
          )}
          {data?.entries.map((entry) => <HistoryEntryCard key={entry.id} entry={entry} />)}
        </div>
      </div>
    </div>,
    document.body,
  );
}