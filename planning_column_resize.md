# Planning: Resizable Grid Columns (Excel-style) + Persistence

**Audience:** opencode (execute phases in order; run `npm run typecheck` and
the relevant Playwright specs as a gate before moving to the next phase).

**Repo:** `opencode2` monorepo — `apps/web`, `apps/server`, `packages/shared`.

**Relationship to other planning docs:** independent of
`planning_sort_and_column_width.md` (default sort + static width bumps) —
this is the drag-to-resize feature layered on top. Doing that plan's static
width bumps first is fine and not required before this one.

---

## 0. Problem statement

The Grid tab (`ProjectTable.tsx`) currently uses fixed, hardcoded `size`
values per column (defined in `columns.tsx`). Nana wants to let users drag a
column's border to resize it, like Excel/Google Sheets, and have that choice
remembered — per user, across sessions/devices — rather than resetting every
time the page reloads.

---

## 1. Decisions

- **Use TanStack Table's built-in column resizing** (`@tanstack/react-table`
  v8, already a dependency) rather than a custom drag implementation.
  `enableColumnResizing: true` + `header.getResizeHandler()` gives a
  resize handle with correct pointer/touch handling for free; we only need to
  render a handle element per header and read `header.getSize()` /
  `column.getIsResizing()` for styling.

- **Resize mode: `columnResizeMode: 'onChange'`.** The grid is not a native
  `<table>` — it's a CSS Grid whose `gridTemplateColumns` string is rebuilt
  from `header.getSize()` on every render (`ProjectTable.tsx`). TanStack's
  `'onEnd'` mode is optimized for native tables that can resize visually via
  the browser's own table layout without a React re-render mid-drag; that
  optimization doesn't apply here, so there's no benefit to it for this grid.
  `'onChange'` re-renders on every pointer-move during a drag, which is fine
  at this app's scale (rows are virtualized and paginated to 25–100 visible
  rows at once). If dragging ever feels laggy in practice, a follow-up
  optimization exists (driving width via a CSS custom property + a ref
  instead of full React state during the drag, then committing to state on
  mouseup) — not needed for the initial implementation.

- **Persist per user, server-side**, not just `localStorage`. This app
  already persists other per-user preferences server-side (`dashboard_views`
  — "Per-user dashboard views... NEVER exported to parquet"), and a LAN app
  where the same account may be used from more than one workstation benefits
  from the setting following the user rather than the browser.
  `localStorage` alone would silently reset on a different machine or a
  cleared browser profile. Store as one JSON blob per `(user_id, table_key)`
  pair — `table_key` is included now even though there's only one resizable
  grid today, so a future second data grid doesn't require a schema change.

- **Debounce the network save, not the local UI update.** Dragging updates
  the in-memory table state immediately (smooth visual resize), but the
  PATCH to persist it is debounced (~600ms after the last resize event) so a
  single drag doesn't fire dozens of requests.

- **Minimum sizes per column**, via `defaultColumn.minSize` plus per-column
  overrides where a too-narrow column would break an inline editor (e.g. the
  `project_name` column hosts the hover-edit pencil and needs more room than
  a plain text column; date columns need enough width for the native
  `<input type="date">` control while being edited).

- **Add a "Reset columns" control** near the existing pagination controls in
  `ProjectTable.tsx`, so a user (or a confused support call) has an obvious
  way to clear a bad resize back to the shipped defaults, and so Playwright
  tests can clean up after themselves without touching the database
  directly.

---

## 2. Phase 1 — Client-side resizing, unpersisted

Get the resizing mechanics correct against this grid's specific layout
(sticky "Project Info" columns, grouped headers) before adding any backend
work.

**Files:**
- `apps/web/src/components/data-grid/ProjectTable.tsx`
- `apps/web/src/components/data-grid/ColumnGroupHeader.tsx` (verify only —
  see note below)
- `apps/web/src/components/data-grid/columns.tsx`

**Changes:**

1. In `useReactTable(...)`, enable resizing and set the mode:
   ```ts
   const table = useReactTable({
     data: rows,
     columns: projectColumns,
     getCoreRowModel: getCoreRowModel(),
     enableColumnResizing: true,
     columnResizeMode: 'onChange',
     defaultColumn: { minSize: 60, maxSize: 600 },
     state: { columnSizing },              // added in this phase, see #2
     onColumnSizingChange: setColumnSizing, // added in this phase, see #2
     meta: { pendingProjectIds } as { pendingProjectIds?: Set<string> },
   });
   ```

2. Add local state for column widths (persistence comes in Phase 4 — for now
   this is just `useState`):
   ```ts
   const [columnSizing, setColumnSizing] = useState<Record<string, number>>({});
   ```

3. Render a resize handle on every **leaf** header (not the group headers —
   resizing a group directly doesn't make sense; resize its children
   instead). Inside the existing leaf-header `<div role="columnheader">`
   block in `ProjectTable.tsx`, append a handle as the last child:
   ```tsx
   {header.column.getCanResize() && (
     <div
       onMouseDown={header.getResizeHandler()}
       onTouchStart={header.getResizeHandler()}
       onClick={(e) => e.stopPropagation()} // don't trigger sort on drag
       className={`absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none ${
         header.column.getIsResizing() ? 'bg-blue-500' : 'hover:bg-blue-300'
       }`}
     />
   )}
   ```
   The header `<div>` needs `position: relative` added to its inline style
   for the handle's `absolute` positioning to anchor correctly.

   **Important interaction with existing sort-on-click:** the header `<div>`
   already has `onClick={isSortable ? () => handleSortClick(columnId) : undefined}`
   for the 3-state sort cycle (see `planning_sort_and_column_width.md`). The
   resize handle's `onMouseDown`/`stopPropagation` above prevents a
   click-to-resize drag from also firing a sort toggle. Verify this
   manually — a drag should never change the sort state, and a plain click
   elsewhere on the header should still cycle sort as before.

4. Per-column minimum sizes, set directly in the relevant `columnDef`s in
   `columns.tsx` (only where the default `60` is too small to stay usable):
   - `text('project_name', ...)` → `minSize: 160` (hosts the hover pencil
     button).
   - `selectDate(...)` columns → `minSize: 110` (native date input needs
     room).
   - `salesColumn()` / `picColumn()` (`editType: 'user'`, a `<select>`) →
     `minSize: 100`.

5. **`ColumnGroupHeader.tsx` note:** no code change should be needed. Its
   `gridColumn: span N` sizing already derives from the sum of the group's
   leaf `header.getSize()` values on every render (see `headerWidth()`,
   which is already correct — just confirm it's actually wired into the
   style, since it currently appears to be computed but the `style` object
   uses `span ${header.colSpan}` against the shared `gridTemplateColumns`
   rather than `headerWidth()` directly; both approaches land on the same
   pixel total as long as the leaf `gridTemplateColumns` array is kept in
   sync, which it already is). Verify visually that resizing a leaf column
   inside e.g. the "Customer Section" group correctly grows/shrinks that
   group's colored header band.

6. **Sticky column offsets:** `ProjectTable.tsx` already recomputes
   `stickyLeftOffsets` from `header.getSize()` inside the render body on
   every render (not memoized), so resizing a sticky "Project Info" column
   should automatically shift the `left` offset of the sticky columns after
   it, with no additional change required. Verify this specifically: resize
   the "Sales" column (inside the sticky group) and confirm "PIC" and the
   sticky group's right-edge shadow both shift correctly, and that
   non-sticky columns scrolled underneath still line up under the header.

**Verification:** drag several column borders (a plain text column, a date
column, a column inside the sticky group, a column inside a colored group
like "Vendor Section") and confirm layout stays correct with no visual
tearing, the header/body columns stay aligned, and sort-by-click still works
on a plain click.

---

## 3. Phase 2 — Shared schema + DB migration

**Files:**
- `packages/shared/src/schemas/gridPreferences.ts` (new)
- `packages/shared/src/index.ts` (export the new schema)
- `apps/server/src/db/migrate.ts`

**Changes:**

1. New shared schema:
   ```ts
   // packages/shared/src/schemas/gridPreferences.ts
   import { z } from 'zod';

   // Column id -> pixel width. Keys are whatever TanStack column ids are
   // active at save time; unknown/stale keys on read are simply ignored by
   // the client (a column that no longer exists just falls back to its
   // default size).
   export const columnWidthsSchema = z.record(z.string(), z.number().positive());
   export type ColumnWidths = z.infer<typeof columnWidthsSchema>;

   export const gridPreferencesSchema = z.object({
     table_key: z.string().min(1).max(80),
     widths: columnWidthsSchema,
   });
   export type GridPreferences = z.infer<typeof gridPreferencesSchema>;
   ```
   Export it from `packages/shared/src/index.ts` alongside the other schema
   exports.

2. New table in `migrate.ts`'s `DDL` string (grouped near
   `dashboard_views`/`aging_thresholds`, with the same "operational/config,
   never exported to parquet" comment convention already used there):
   ```sql
   -- Per-user, per-table column widths for resizable data grids. Operational/
   -- config data — NEVER exported to parquet (same convention as
   -- dashboard_views and aging_thresholds above).
   CREATE TABLE IF NOT EXISTS grid_column_widths (
     user_id VARCHAR NOT NULL,      -- FK dropped, DuckDB UPDATE limitation
     table_key VARCHAR NOT NULL,
     widths_json VARCHAR NOT NULL,
     updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
     PRIMARY KEY (user_id, table_key)
   );
   ```
   `IF NOT EXISTS` keeps `migrate()` idempotent, matching every other table
   in this file. No parquet export wiring needed — confirm
   `apps/server/src/db/export.ts`'s `exportSnapshots()` table union type is
   NOT extended to include this table (it should stay limited to
   `'projects' | 'pending_edits' | 'users'`).

---

## 4. Phase 3 — Server module (routes + service)

This must **not** live under `/api/settings` — that router is gated
`requireRole('SUPER_ADMIN')` for everything, but column-width preferences
belong to any authenticated user (STAFF included), scoped to their own
`user_id`, mirroring the `dashboard_views` ownership pattern
(`WHERE id = ? AND user_id = ?`).

**Files (new):**
- `apps/server/src/modules/grid-preferences/routes.ts`
- `apps/server/src/modules/grid-preferences/gridPreferencesService.ts`

**File (edit):**
- `apps/server/src/app.ts` — mount the new router.

**Service (`gridPreferencesService.ts`):**
```ts
import { runRead, runWrite } from '../../db/connection.js';
import { gridPreferencesSchema } from '@tracker/shared';
import type { ColumnWidths } from '@tracker/shared';

export class GridPreferencesError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'GridPreferencesError';
  }
}

interface Row { widths_json: string }

export async function getColumnWidths(userId: string, tableKey: string): Promise<ColumnWidths> {
  const rows = await runRead<Row>(
    `SELECT widths_json FROM grid_column_widths WHERE user_id = ? AND table_key = ?`,
    [userId, tableKey],
  );
  if (rows.length === 0) return {};
  try {
    return JSON.parse(rows[0].widths_json) as ColumnWidths;
  } catch {
    return {};
  }
}

export async function saveColumnWidths(
  userId: string,
  rawPayload: unknown,
): Promise<void> {
  const { table_key, widths } = gridPreferencesSchema.parse(rawPayload);
  await runWrite(async (ex) => {
    // Upsert: DuckDB has no native UPSERT here (kept consistent with the
    // rest of this codebase's manual approach) — delete then insert inside
    // the write mutex.
    await ex(`DELETE FROM grid_column_widths WHERE user_id = ? AND table_key = ?`, [userId, table_key]);
    await ex(
      `INSERT INTO grid_column_widths (user_id, table_key, widths_json, updated_at)
       VALUES (?, ?, ?, current_timestamp)`,
      [userId, table_key, JSON.stringify(widths)],
    );
  });
}

export async function resetColumnWidths(userId: string, tableKey: string): Promise<void> {
  await runWrite(async (ex) => {
    await ex(`DELETE FROM grid_column_widths WHERE user_id = ? AND table_key = ?`, [userId, tableKey]);
  });
}
```

**Routes (`routes.ts`):**
```ts
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import { getColumnWidths, saveColumnWidths, resetColumnWidths, GridPreferencesError } from './gridPreferencesService.js';

const tableKeyQuery = z.object({ table: z.string().min(1).max(80) });

export const gridPreferencesRouter = Router();
gridPreferencesRouter.use(requireAuth);

gridPreferencesRouter.get('/column-widths', async (req, res) => {
  try {
    const { table } = tableKeyQuery.parse(req.query);
    const widths = await getColumnWidths(req.user!.id, table);
    res.json({ widths });
  } catch (err) {
    handleError(err, res);
  }
});

gridPreferencesRouter.put('/column-widths', async (req, res) => {
  try {
    await saveColumnWidths(req.user!.id, req.body);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

gridPreferencesRouter.delete('/column-widths', async (req, res) => {
  try {
    const { table } = tableKeyQuery.parse(req.query);
    await resetColumnWidths(req.user!.id, table);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

function handleError(err: unknown, res: Response): void {
  if (err instanceof GridPreferencesError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.flatten() });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('Grid preferences error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
```

**`app.ts`:** mount alongside the other routers:
```ts
import { gridPreferencesRouter } from './modules/grid-preferences/routes.js';
...
app.use('/api/grid-preferences', gridPreferencesRouter);
```

---

## 5. Phase 4 — Wire persistence into the frontend

**Files (new):**
- `apps/web/src/hooks/useGridPreferences.ts`

**Files (edit):**
- `apps/web/src/components/data-grid/ProjectTable.tsx`

**Changes:**

1. New hook, following the existing React Query hook conventions
   (`useSettings.ts`, `useDashboard.ts`):
   ```ts
   // apps/web/src/hooks/useGridPreferences.ts
   import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
   import { apiClient } from '../lib/api-client';
   import type { ColumnWidths } from '@tracker/shared';

   export function useColumnWidths(tableKey: string) {
     const query = useQuery({
       queryKey: ['grid-preferences', 'column-widths', tableKey],
       queryFn: () => apiClient.get<{ widths: ColumnWidths }>(
         `/api/grid-preferences/column-widths?table=${encodeURIComponent(tableKey)}`,
       ),
     });
     return { data: query.data?.widths, isLoading: query.isLoading };
   }

   export function useSaveColumnWidths() {
     return useMutation({
       mutationFn: (input: { table_key: string; widths: ColumnWidths }) =>
         apiClient.put<{ ok: boolean }>('/api/grid-preferences/column-widths', input),
     });
   }

   export function useResetColumnWidths(tableKey: string) {
     const qc = useQueryClient();
     return useMutation({
       mutationFn: () => apiClient.del<{ ok: boolean }>(
         `/api/grid-preferences/column-widths?table=${encodeURIComponent(tableKey)}`,
       ),
       onSuccess: () => qc.invalidateQueries({ queryKey: ['grid-preferences', 'column-widths', tableKey] }),
     });
   }
   ```
   `apiClient` needs a `put` method — check `apps/web/src/lib/api-client.ts`;
   it currently exposes `get`/`post`/`patch`/`del` but no `put`. Either add a
   thin `put<T>(path, body)` wrapper (same shape as `patch`) or use `PATCH`
   instead of `PUT` on the server route in Phase 3 to avoid touching the
   client at all — **recommend PATCH** for the save endpoint specifically to
   avoid adding a new HTTP verb to the client just for this feature.

2. In `ProjectTable.tsx`:
   - Add `const TABLE_KEY = 'projects_grid';` near the top of the file.
   - Load: `const { data: savedWidths, isLoading: widthsLoading } = useColumnWidths(TABLE_KEY);`
     Initialize `columnSizing` state from `savedWidths` once it arrives
     (e.g. via a `useEffect` that runs once when `savedWidths` transitions
     from `undefined` to a value, setting `setColumnSizing(savedWidths)`).
     Until it arrives, the table renders with default sizes — this is a
     brief, acceptable flash-to-default on first load (do not block
     rendering the whole grid on this fetch).
   - Save: debounce column-size changes before persisting. A small
     `useRef` + `setTimeout` debounce is enough — no new dependency needed:
     ```ts
     const saveWidths = useSaveColumnWidths();
     const saveTimer = useRef<number>();
     const handleColumnSizingChange = (updater: Updater<Record<string, number>>) => {
       setColumnSizing((old) => {
         const next = typeof updater === 'function' ? updater(old) : updater;
         window.clearTimeout(saveTimer.current);
         saveTimer.current = window.setTimeout(() => {
           saveWidths.mutate({ table_key: TABLE_KEY, widths: next });
         }, 600);
         return next;
       });
     };
     ```
     Pass `onColumnSizingChange: handleColumnSizingChange` to
     `useReactTable(...)` instead of the raw `setColumnSizing` from Phase 1.
   - Add a **"Reset columns"** button next to the existing "Rows per page"
     control in the pagination row:
     ```tsx
     const resetWidths = useResetColumnWidths(TABLE_KEY);
     ...
     <button
       type="button"
       onClick={() => { setColumnSizing({}); resetWidths.mutate(); }}
       className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
     >
       Reset columns
     </button>
     ```

---

## 6. Phase 5 — Tests

**File (new):** `apps/web/e2e/column-resize.spec.ts`

1. **Resize persists across reload.** Log in as admin, drag a known
   column's resize handle by a fixed offset (Playwright:
   `page.mouse.move`/`down`/`up` on the handle element, or
   `locator.dragTo` if a workable target exists), read the column's new
   rendered width (`getBoundingClientRect().width` on the header cell), then
   reload the page and assert the same column renders at the same width
   (within a small pixel tolerance).

2. **Reset columns.** After the above, click "Reset columns" and assert the
   column returns to its shipped default width; reload again and confirm it
   stays at the default (i.e. the server-side row was actually deleted, not
   just the local state).

3. **Per-user isolation.** Resize a column as admin, log out, log in as
   staff, and assert staff sees the *default* width (not admin's resized
   value) — mirrors the existing per-user isolation pattern already tested
   in `dashboard.spec.ts` ("staff sees only their own dashboard views").

4. **Test cleanup:** each test that resizes a column should call "Reset
   columns" (or hit the DELETE endpoint directly via `page.request.delete`)
   at the end, matching the restore-defaults pattern already used in
   `priority.spec.ts`, so runs don't leave state that affects later runs.

**Phase gate:** `npm run typecheck` and the full Playwright suite (or at
minimum `grid.spec.ts`, `edit-modal.spec.ts`, and the new
`column-resize.spec.ts`, since those most directly touch `ProjectTable.tsx`)
must pass before this is considered done.

---

## 7. Open questions for Nana

1. **Debounce timing:** 600ms after the last resize event is a reasonable
   default for the save call — adjust if it feels too eager/laggy once
   built.
2. **`PATCH` vs. adding `PUT` to `apiClient`:** this plan recommends `PATCH`
   for the save endpoint to avoid touching `api-client.ts`'s method set.
   Flag if a `PUT` is preferred for semantic correctness (full replace) —
   trivial either way, just needs `apiClient.put` added if so.
3. **Scope of "Reset columns":** as written it resets the whole grid's
   widths in one click. If per-column reset (e.g. double-click a column
   border, Excel/Sheets style, to auto-fit or reset just that column) is
   wanted instead of/in addition to the all-columns reset button, that's a
   reasonable follow-up phase, not included here.
