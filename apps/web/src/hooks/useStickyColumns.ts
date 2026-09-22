import { useCallback, useState } from 'react';
import { DEFAULT_STICKY_COLUMN_IDS, getColumnOptions } from '../components/data-grid/columns';

const VALID = new Set(getColumnOptions().map((o) => o.id));
const keyFor = (userId?: string) => `tracker.grid.stickyColumns.${userId ?? 'anon'}`;

function read(userId?: string): string[] {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return DEFAULT_STICKY_COLUMN_IDS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_STICKY_COLUMN_IDS;
    return parsed.filter((id): id is string => typeof id === 'string' && VALID.has(id));
  } catch {
    return DEFAULT_STICKY_COLUMN_IDS;
  }
}

// Per-user sticky column selection, persisted in localStorage (D5). An empty
// array is a valid selection (nothing sticky).
export function useStickyColumns(userId?: string) {
  const [ids, setIds] = useState<string[]>(() => read(userId));

  const save = useCallback((next: string[]) => {
    setIds(next);
    try {
      localStorage.setItem(keyFor(userId), JSON.stringify(next));
    } catch {
      // ignore quota / private-mode failures
    }
  }, [userId]);

  const reset = useCallback(() => save(DEFAULT_STICKY_COLUMN_IDS), [save]);
  return { stickyColumnIds: ids, setStickyColumnIds: save, resetStickyColumns: reset };
}