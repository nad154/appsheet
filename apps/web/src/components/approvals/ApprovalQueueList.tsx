import type { PendingEdit } from '@tracker/shared';

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ApprovalQueueList({
  edits,
  selectedId,
  onSelect,
  isLoading,
}: {
  edits: PendingEdit[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading queue…</p>;
  }
  if (edits.length === 0) {
    return <p className="text-sm text-gray-500">No pending edits.</p>;
  }

  return (
    <ul className="divide-y divide-gray-100">
      {edits.map((edit) => {
        const isNew = edit.edit_type === 'CREATE';
        return (
          <li key={edit.id}>
            <button
              type="button"
              onClick={() => onSelect(edit.id)}
              className={`flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-gray-50 ${
                selectedId === edit.id ? 'bg-blue-50' : ''
              }`}
            >
              <span
                className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                  isNew ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                }`}
              >
                {edit.edit_type}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-800">
                  {isNew ? 'New project' : 'Edit project'}
                  {!isNew && edit.changes_json.project_name
                    ? ` · ${String(edit.changes_json.project_name)}`
                    : ''}
                </span>
                <span className="block truncate text-xs text-gray-500">
                  Submitted {fmtDate(edit.created_at)} by {edit.requested_by.slice(0, 8)}…
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
