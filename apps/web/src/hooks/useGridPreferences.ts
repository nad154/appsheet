import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gridPreferencesDefaults } from '@tracker/shared';
import type { GridPreferences } from '@tracker/shared';
import { apiClient } from '../lib/api-client';
import { useToast } from '../components/Toast';
import { getPresetHidden, type GridPresetId } from '../components/data-grid/columns';

const QUERY_KEY = ['preferences', 'grid-columns'];
const SAVE_DEBOUNCE_MS = 400;

// Warm cache so the grid does not flash all columns on first paint, before the
// server value arrives. Per user, per browser — purely a cache; the server copy
// is the source of truth.
const cacheKeyFor = (userId?: string) => `tracker.grid.visibility.${userId ?? 'anon'}`;

function readCache(userId?: string): GridPreferences {
  try {
    const raw = localStorage.getItem(cacheKeyFor(userId));
    if (!raw) return { ...gridPreferencesDefaults };
    const parsed = JSON.parse(raw) as Partial<GridPreferences>;
    return {
      hidden_column_ids: Array.isArray(parsed.hidden_column_ids) ? parsed.hidden_column_ids : [],
      hidden_group_ids: Array.isArray(parsed.hidden_group_ids) ? parsed.hidden_group_ids : [],
      version: 1,
    };
  } catch {
    return { ...gridPreferencesDefaults };
  }
}

function writeCache(userId: string | undefined, prefs: GridPreferences): void {
  try {
    localStorage.setItem(cacheKeyFor(userId), JSON.stringify(prefs));
  } catch {
    // ignore quota / private-mode failures
  }
}

export interface UseGridPreferences {
  hiddenColumnIds: string[];
  hiddenGroupIds: string[];
  isColumnVisible: (id: string) => boolean;
  // Bulk setter — the "Columns" menu computes the full hidden sets and applies
  // them in one go (keeps group/column flags consistent).
  setHidden: (hiddenColumnIds: string[], hiddenGroupIds: string[]) => void;
  setColumnVisible: (id: string, visible: boolean) => void;
  setGroupVisible: (groupId: string, visible: boolean) => void;
  applyPreset: (preset: GridPresetId) => void;
  reset: () => void;
}

/**
 * Per-user grid column visibility, persisted server-side (user_preferences) so
 * it follows the user across browsers. Optimistic local state + debounced save;
 * localStorage is only a warm cache. Independent of useStickyColumns.
 */
export function useGridPreferences(userId?: string): UseGridPreferences {
  const qc = useQueryClient();
  const { showToast } = useToast();

  // Seed from the warm cache; the query overwrites once the server value loads.
  const cached = useMemo(() => readCache(userId), [userId]);
  const [hiddenColumnIds, setHiddenColumnIds] = useState<string[]>(cached.hidden_column_ids);
  const [hiddenGroupIds, setHiddenGroupIds] = useState<string[]>(cached.hidden_group_ids);

  // Reset local state when the signed-in user changes (cache is per user).
  useEffect(() => {
    const next = readCache(userId);
    setHiddenColumnIds(next.hidden_column_ids);
    setHiddenGroupIds(next.hidden_group_ids);
  }, [userId]);

  const query = useQuery({
    queryKey: [...QUERY_KEY, userId],
    queryFn: () => apiClient.get<GridPreferences>('/api/me/preferences/grid-columns'),
  });

  // Server value wins once it arrives.
  useEffect(() => {
    if (!query.data) return;
    setHiddenColumnIds(query.data.hidden_column_ids);
    setHiddenGroupIds(query.data.hidden_group_ids);
    writeCache(userId, query.data);
  }, [query.data, userId]);

  const mutation = useMutation({
    mutationFn: (prefs: GridPreferences) =>
      apiClient.put<GridPreferences>('/api/me/preferences/grid-columns', prefs),
    onSuccess: (data) => {
      qc.setQueryData([...QUERY_KEY, userId], data);
      writeCache(userId, data);
    },
    onError: () => {
      // Keep the local change; it will be retried on the next change.
      showToast("Couldn't save your view", 'error');
    },
  });

  const saveTimer = useRef<number | null>(null);
  const pending = useRef<GridPreferences | null>(null);

  const schedule = useCallback(
    (cols: string[], groups: string[]) => {
      pending.current = { hidden_column_ids: cols, hidden_group_ids: groups, version: 1 };
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        const value = pending.current;
        pending.current = null;
        if (value) mutation.mutate(value);
      }, SAVE_DEBOUNCE_MS);
    },
    [mutation],
  );

  const setHidden = useCallback(
    (cols: string[], groups: string[]) => {
      setHiddenColumnIds(cols);
      setHiddenGroupIds(groups);
      writeCache(userId, { hidden_column_ids: cols, hidden_group_ids: groups, version: 1 });
      schedule(cols, groups);
    },
    [schedule, userId],
  );

  const setColumnVisible = useCallback(
    (id: string, visible: boolean) => {
      const next = visible ? hiddenColumnIds.filter((x) => x !== id) : Array.from(new Set([...hiddenColumnIds, id]));
      setHidden(next, hiddenGroupIds);
    },
    [hiddenColumnIds, hiddenGroupIds, setHidden],
  );

  const setGroupVisible = useCallback(
    (groupId: string, visible: boolean) => {
      const next = visible
        ? hiddenGroupIds.filter((x) => x !== groupId)
        : Array.from(new Set([...hiddenGroupIds, groupId]));
      setHidden(hiddenColumnIds, next);
    },
    [hiddenColumnIds, hiddenGroupIds, setHidden],
  );

  const applyPreset = useCallback(
    (preset: GridPresetId) => {
      const { hiddenColumnIds: cols, hiddenGroupIds: groups } = getPresetHidden(preset);
      setHidden(cols, groups);
    },
    [setHidden],
  );

  const reset = useCallback(() => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pending.current = null;
    setHiddenColumnIds([]);
    setHiddenGroupIds([]);
    writeCache(userId, { ...gridPreferencesDefaults });
    apiClient
      .del('/api/me/preferences/grid-columns')
      .then(() => qc.invalidateQueries({ queryKey: [...QUERY_KEY, userId] }))
      .catch(() => showToast("Couldn't reset your view", 'error'));
  }, [qc, showToast, userId]);

  const hiddenCols = useMemo(() => new Set(hiddenColumnIds), [hiddenColumnIds]);
  const isColumnVisible = useCallback((id: string) => !hiddenCols.has(id), [hiddenCols]);

  return {
    hiddenColumnIds,
    hiddenGroupIds,
    isColumnVisible,
    setHidden,
    setColumnVisible,
    setGroupVisible,
    applyPreset,
    reset,
  };
}
