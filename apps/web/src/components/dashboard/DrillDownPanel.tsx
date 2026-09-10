import { useDrillDown } from '../../hooks/useDashboard';
import type { DashboardColumn } from '@tracker/shared';

// Inline panel under a chart listing the projects behind one slice/segment.
// Capped at 50 rows — at this app's scale the full list is likely small, but
// broad categories (e.g. every "service" project) shouldn't blow up the card.
const MAX_VISIBLE = 50;

export function DrillDownPanel({
  columnKey,
  value,
  onSelect,
  onClose,
}: {
  columnKey: DashboardColumn;
  value: string;
  onSelect: (projectId: string) => void;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useDrillDown(columnKey, value);
  const projects = data?.projects ?? [];
  const visible = projects.slice(0, MAX_VISIBLE);

  return (
    <div className="mt-3 border-t border-gray-100 pt-3" data-testid="drill-down-panel">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Projects — {value}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close drill-down"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          ×
        </button>
      </div>

      {isLoading && <p className="py-3 text-sm text-gray-400">Loading projects…</p>}
      {isError && <p className="py-3 text-sm text-red-500">Failed to load projects.</p>}
      {!isLoading && !isError && projects.length === 0 && (
        <p className="py-3 text-sm text-gray-400">No projects in this category.</p>
      )}

      {!isLoading && !isError && visible.length > 0 && (
        <>
          <ul className="max-h-56 space-y-1 overflow-auto">
            {visible.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className="w-full rounded px-2 py-1 text-left text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700"
                >
                  {p.project_name}
                </button>
              </li>
            ))}
          </ul>
          {projects.length > MAX_VISIBLE && (
            <p className="mt-2 text-xs text-gray-400">
              Showing {MAX_VISIBLE} of {projects.length} projects.
            </p>
          )}
        </>
      )}
    </div>
  );
}