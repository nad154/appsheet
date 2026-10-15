import { useDrillDown } from '../../hooks/useDashboard';
import type { DashboardColumn, DashboardStageFilter } from '@tracker/shared';

// Inline panel under a chart listing the projects behind one slice/segment.
// Capped at 50 rows — at this app's scale the full list is likely small, but
// broad categories (e.g. every "service" project) shouldn't blow up the card.
const MAX_VISIBLE = 50;

export function DrillDownPanel({
  columnKey,
  value,
  stage,
  year,
  onSelect,
  onClose,
}: {
  columnKey: DashboardColumn;
  value: string;
  stage: DashboardStageFilter;
  year: number | null;
  onSelect: (projectId: string) => void;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useDrillDown(columnKey, value, { stage, year });
  const projects = data?.projects ?? [];
  const visible = projects.slice(0, MAX_VISIBLE);

  return (
    <div className="mt-3 border-t border-border pt-3" data-testid="drill-down-panel">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Projects — {value}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close drill-down"
          className="rounded p-1 text-ink-muted hover:bg-canvas hover:text-ink"
        >
          ×
        </button>
      </div>

      {isLoading && <p className="py-3 text-sm text-ink-muted">Loading projects…</p>}
      {isError && <p className="py-3 text-sm text-danger">Failed to load projects.</p>}
      {!isLoading && !isError && projects.length === 0 && (
        <p className="py-3 text-sm text-ink-muted">No projects in this category.</p>
      )}

      {!isLoading && !isError && visible.length > 0 && (
        <>
          <ul className="max-h-56 space-y-1 overflow-auto">
            {visible.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className="flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-left text-sm text-ink hover:bg-accent-soft hover:text-accent"
                >
                  <span className="truncate">{p.project_name}</span>
                  {/* vendor-based drill-downs (vendor_type / priority) list one
                      entry per vendor line — show which vendor the line belongs to */}
                  {p.vendor_name && (
                    <span className="shrink-0 truncate text-xs font-normal text-ink-muted" title={p.vendor_name}>
                      {p.vendor_name}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {projects.length > MAX_VISIBLE && (
            <p className="mt-2 text-xs text-ink-muted">
              Showing {MAX_VISIBLE} of {projects.length} projects.
            </p>
          )}
        </>
      )}
    </div>
  );
}