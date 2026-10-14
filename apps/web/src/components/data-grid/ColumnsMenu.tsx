import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getColumnGroups,
  GRID_PRESETS,
  type ColumnGroupOption,
  type GridPresetId,
} from './columns';

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
        className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300"
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
          className="absolute left-0 top-full z-50 mt-1 w-80 rounded-lg border border-gray-200 bg-white shadow-lg"
          data-testid="columns-panel"
        >
          <div className="flex flex-wrap gap-1 border-b border-gray-100 p-2">
            {GRID_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPreset(p.id)}
                className="rounded-full border border-gray-300 px-2.5 py-0.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="border-b border-gray-100 p-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search columns"
              aria-label="Search columns"
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300"
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
                      className="accent-blue-600"
                    />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      {group.label}
                    </span>
                  </legend>
                  <div className="space-y-0.5">
                    {group.columns.map((col) => {
                      const checked = col.locked || isVisible(group.id, col.id);
                      return (
                        <label
                          key={col.id}
                          className="flex items-center gap-2 rounded px-1 py-0.5 pl-5 text-sm text-gray-800 hover:bg-gray-50"
                          title={col.locked ? 'This column cannot be hidden' : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={col.locked}
                            aria-label={col.label}
                            onChange={(e) => toggleColumn(group, col.id, e.target.checked)}
                            className="accent-blue-600 disabled:opacity-60"
                          />
                          {col.locked && (
                            <span aria-hidden="true" className="text-xs text-gray-400">
                              🔒
                            </span>
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
              <p className="px-1 py-2 text-xs text-gray-400">No columns match "{search}".</p>
            )}
          </div>

          {vendorHidden && (
            <p className="border-t border-amber-100 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
              Rows are still shown per vendor line.
            </p>
          )}

          <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
            <span className="text-xs text-gray-500">
              Showing {visibleCount} of {totalColumns} columns
            </span>
            <button
              type="button"
              onClick={onReset}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
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
