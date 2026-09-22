import { useEffect, useMemo, useRef, useState } from 'react';
import { getColumnOptions } from './columns';

interface StickyColumnsMenuProps {
  selectedIds: string[];
  // id -> px, from the column defs' `size`, so the total-width cap is enforced.
  columnWidths: Record<string, number>;
  onChange: (ids: string[]) => void;
  onReset: () => void;
}

// Cap total sticky width at 60% of the window so the grid can't be made
// unusable (D6).
function capPx(): number {
  return typeof window === 'undefined' ? 0 : window.innerWidth * 0.6;
}

export function StickyColumnsMenu({
  selectedIds,
  columnWidths,
  onChange,
  onReset,
}: StickyColumnsMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const options = useMemo(() => {
    const grouped = new Map<string, { id: string; label: string }[]>();
    for (const o of getColumnOptions()) {
      const list = grouped.get(o.group) ?? [];
      list.push({ id: o.id, label: o.label });
      grouped.set(o.group, list);
    }
    return [...grouped.entries()];
  }, []);

  const selected = new Set(selectedIds);
  const totalWidth = selectedIds.reduce((sum, id) => sum + (columnWidths[id] ?? 0), 0);
  const overCap = totalWidth > capPx();

  const toggle = (id: string, checked: boolean) => {
    const next = checked ? [...selectedIds, id] : selectedIds.filter((x) => x !== id);
    onChange(next);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300"
        data-testid="sticky-columns-button"
        aria-haspopup="true"
        aria-expanded={open}
      >
        Sticky columns ({selectedIds.length})
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-gray-200 bg-white shadow-lg"
          data-testid="sticky-columns-panel"
        >
          <div className="max-h-96 overflow-auto p-2">
            {options.map(([group, cols]) => (
              <fieldset key={group} className="mb-2">
                <legend className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {group}
                </legend>
                <div className="space-y-0.5">
                  {cols.map((o) => {
                    const isSelected = selected.has(o.id);
                    return (
                      <label
                        key={o.id}
                        className="flex items-center gap-2 rounded px-1 py-0.5 text-sm text-gray-800 hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          aria-label={o.label}
                          disabled={!isSelected && overCap}
                          onChange={(e) => toggle(o.id, e.target.checked)}
                          className="accent-blue-600 disabled:opacity-40"
                        />
                        <span className="truncate">{o.label}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
            <span className="text-xs text-gray-500">{totalWidth}px sticky</span>
            <button
              type="button"
              onClick={onReset}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
              data-testid="sticky-reset"
            >
              Reset to default
            </button>
          </div>
          {overCap && (
            <p className="border-t border-amber-100 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
              Sticky columns are wider than 60% of the screen — uncheck some to add more.
            </p>
          )}
        </div>
      )}
    </div>
  );
}