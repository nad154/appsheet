import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getColumnGroups,
  GRID_PRESETS,
  type ColumnGroupOption,
  type GridPresetId,
} from './columns';
import { LockIcon } from '../ui/icons';

interface ColumnsMenuProps {
  hiddenColumnIds: string[];
  hiddenGroupIds: string[];
  onChange: (hiddenColumnIds: string[], hiddenGroupIds: string[]) => void;
  onPreset: (preset: GridPresetId) => void;
  onReset: () => void;
}

// Per-user column show/hide menu. Purely additive to the Sticky columns menu:
// this controls visibility only. A column is visible when it is locked (always
// shown), or its id is not hidden and its group is not hidden.
export function ColumnsMenu({
  hiddenColumnIds,
  hiddenGroupIds,
  onChange,
  onPreset,
  onReset,
}: ColumnsMenuProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const groups = useMemo(() => getColumnGroups(), []);
  const totalColumns = useMemo(
    () => groups.reduce((n, g) => n + g.columns.length, 0),
    [groups],
  );

  const hiddenCols = useMemo(() => new Set(hiddenColumnIds), [hiddenColumnIds]);
  const hiddenGroups = useMemo(() => new Set(hiddenGroupIds), [hiddenGroupIds]);

  const isVisible = (groupId: string, colId: string) =>
    !hiddenGroups.has(groupId) && !hiddenCols.has(colId);

  const visibleCount = useMemo(
    () =>
      groups.reduce(
        (n, g) => n + g.columns.filter((c) => c.locked || isVisible(g.id, c.id)).length,
        0,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, hiddenCols, hiddenGroups],
  );

  // Non-locked columns of a group drive its tri-state (locked ones are always
  // visible, so they never affect the toggle).
  function groupState(group: ColumnGroupOption) {
    const cols = group.columns.filter((c) => !c.locked);
    const visible = cols.filter((c) => isVisible(group.id, c.id)).length;
    return {
      total: cols.length,
      visible,
      all: cols.length > 0 && visible === cols.length,
      mixed: visible > 0 && visible < cols.length,
    };
  }

  function toggleGroup(group: ColumnGroupOption, nextChecked: boolean) {
    const groupColIds = group.columns.map((c) => c.id);
    const otherHiddenCols = hiddenColumnIds.filter((id) => !groupColIds.includes(id));
    const otherHiddenGroups = hiddenGroupIds.filter((id) => id !== group.id);
    if (nextChecked) {
      // Show the group: drop the group flag and any individual hidden flags.
      onChange(otherHiddenCols, otherHiddenGroups);
    } else {
      // Hide the group: set the group flag; individual flags are redundant now.
      onChange(otherHiddenCols, [...otherHiddenGroups, group.id]);
    }
  }

  function toggleColumn(group: ColumnGroupOption, colId: string, nextChecked: boolean) {
    if (group.columns.find((c) => c.id === colId)?.locked) return;
    const groupColIds = group.columns.map((c) => c.id);
    if (nextChecked) {
      if (hiddenGroups.has(group.id)) {
        // Reveal just this column: un-hide the group and hide its siblings.
        const siblings = group.columns.filter((c) => !c.locked && c.id !== colId).map((c) => c.id);
        const otherHiddenCols = hiddenColumnIds.filter((id) => !groupColIds.includes(id));
        onChange([...otherHiddenCols, ...siblings], hiddenGroupIds.filter((id) => id !== group.id));
      } else {
        onChange(hiddenColumnIds.filter((id) => id !== colId), hiddenGroupIds);
      }
    } else {
      onChange(Array.from(new Set([...hiddenColumnIds, colId])), hiddenGroupIds);
    }
  }

  const term = search.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!term) return groups;
    return groups
      .map((g) => ({
        ...g,
        columns: g.columns.filter((c) => c.label.toLowerCase().includes(term)),
      }))
      .filter((g) => g.columns.length > 0 || g.label.toLowerCase().includes(term));
  }, [groups, term]);

  const vendorHidden = hiddenGroups.has('vendor');

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40"
        data-testid="columns-button"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Columns ({visibleCount})
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose visible columns"
          tabIndex={-1}
          className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border border-border bg-surface shadow-overlay"
          data-testid="columns-panel"
        >
          <div className="flex flex-wrap gap-1 border-b border-border p-2">
            {GRID_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPreset(p.id)}
                className="rounded-full border border-border px-2.5 py-0.5 text-xs text-ink-muted hover:bg-canvas"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="border-b border-border p-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search columns"
              aria-label="Search columns"
              className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          <div className="max-h-80 overflow-auto p-2">
            {filteredGroups.map((group) => {
              const state = groupState(group);
              const groupChecked = state.all;
              const groupMixed = state.mixed;
              return (
                <fieldset key={group.id} className="mb-2">
                  <legend className="mb-1 flex w-full items-center gap-2 px-1">
                    <input
                      type="checkbox"
                      checked={groupChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = groupMixed;
                      }}
                      aria-label={group.label}
                      aria-checked={groupMixed ? 'mixed' : groupChecked}
                      disabled={state.total === 0}
                      onChange={(e) => toggleGroup(group, e.target.checked)}
                      className="accent-accent"
                    />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                      {group.label}
                    </span>
                  </legend>
                  <div className="space-y-0.5">
                    {group.columns.map((col) => {
                      const checked = col.locked || isVisible(group.id, col.id);
                      return (
                        <label
                          key={col.id}
                          className="flex items-center gap-2 rounded px-1 py-0.5 pl-5 text-sm text-ink hover:bg-canvas"
                          title={col.locked ? 'This column cannot be hidden' : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={col.locked}
                            aria-label={col.label}
                            onChange={(e) => toggleColumn(group, col.id, e.target.checked)}
                            className="accent-accent disabled:opacity-60"
                          />
                          {col.locked && (
                            <LockIcon
                              size={12}
                              aria-hidden="true"
                              className="shrink-0 text-ink-muted/70"
                            />
                          )}
                          <span className="truncate">{col.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
            {filteredGroups.length === 0 && (
              <p className="px-1 py-2 text-xs text-ink-muted">No columns match "{search}".</p>
            )}
          </div>

          {vendorHidden && (
            <p className="border-t border-warning/20 bg-warning-soft px-3 py-1.5 text-xs text-warning">
              Rows are still shown per vendor line.
            </p>
          )}

          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <span className="text-xs text-ink-muted">
              Showing {visibleCount} of {totalColumns} columns
            </span>
            <button
              type="button"
              onClick={onReset}
              className="rounded border border-border px-2 py-1 text-xs text-ink-muted hover:bg-canvas"
              data-testid="columns-reset"
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
