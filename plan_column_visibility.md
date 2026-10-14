# Plan: Per-user Column Visibility (additive to Sticky Columns)

## 1. Goal

Add a **Columns** control so each user can hide/show individual columns and whole column groups. The choice is saved to the user's profile, so it follows them across browsers and devices. It sits **next to** the existing Sticky columns control.

**Explicitly additive.** The sticky feature is not replaced, renamed, or merged:

- `hooks/useStickyColumns.ts` — unchanged
- `components/data-grid/StickyColumnsMenu.tsx` — unchanged (keeps `sticky-columns-button` / `sticky-columns-panel` / `sticky-reset` testids and its label-based grouping)
- `getColumnOptions()` in `columns.tsx` — unchanged (still feeds the sticky menu)
- `apps/web/e2e/sticky-columns.spec.ts` — unchanged, must still pass
- No `sticky_column_ids` in the new preference object; no localStorage→server sticky migration

## 2. Current state (verified against code)

| Piece | Where | Relevance |
|---|---|---|
| Column tree, 4 groups, **32 leaf columns** | `components/data-grid/columns.tsx` → `buildProjectColumns` | Group ids: `project_info`, `update_progress_group`, `customer`, `vendor` |
| Flat list for the sticky menu | `getColumnOptions()` in `columns.tsx` | Returns `{id, label, group}` where **`group` is the display label**, not the group id |
| Sticky selection hook | `hooks/useStickyColumns.ts` | `localStorage` only — **left untouched** |
| Sticky menu | `components/data-grid/StickyColumnsMenu.tsx` | **Left untouched** |
| Grid renderer | `ProjectTable.tsx` | `useReactTable` has **no `state`** today (`:280`); `leafHeaders` drives `gridTemplateColumns`; cells use `getVisibleCells()` |
| Group header | `ColumnGroupHeader.tsx` | Splits a group into sticky/non-sticky runs |

Leaf counts by group: `project_info` 7 (`number`, `folder_name`, `project_name`, `staff_assigned_id`, `pic_id`, `current_stage`, `issues`), `update_progress_group` 1, `customer` 9, `vendor` 15 — **32 total**.

TanStack Table's `columnVisibility` state does most of the work. Hidden leaves drop out of `getHeaderGroups()` and `getVisibleCells()`, and a group whose leaves are all hidden disappears from the header automatically.

**Locked columns** (cannot be hidden): `project_name`, and `number` (`#`). Without them the grid is unusable. The Project Info group can be collapsed to just those two, but not removed.

## 3. Data model

Store what is **hidden**, not what is visible, so newly added columns appear by default.

```ts
// packages/shared/src/schemas/gridPreferences.ts
export const gridPreferencesSchema = z.object({
  hidden_column_ids: z.array(z.string().max(64)).max(200).default([]),
  hidden_group_ids: z.array(z.string().max(64)).max(50).default([]),
  version: z.literal(1).default(1),
});
export type GridPreferences = z.infer<typeof gridPreferencesSchema>;
```

Semantics:

- A leaf column is visible iff it is **locked** OR (`id ∉ hidden_column_ids` AND `group_id ∉ hidden_group_ids`).
- `hidden_group_ids` is stored explicitly, rather than derived from "all leaves hidden". A hidden group therefore stays hidden when we later add columns to it.
- Unknown ids are ignored on read, and removed the next time the user saves.

## 4. Persistence (per user profile)

### 4.1 Server

New table, created in `db/migrate.ts` `DDL` (operational/config data — **never** exported to parquet, same as `dashboard_views` and `aging_thresholds`; write routes must not call `exportSnapshots`):

```sql
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id VARCHAR NOT NULL,        -- FK dropped, project convention
  pref_key VARCHAR NOT NULL,       -- e.g. 'grid_columns'
  value_json VARCHAR NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  PRIMARY KEY (user_id, pref_key)
);
```

DuckDB notes (following the existing migrations in `migrate.ts`):

- Upsert as `DELETE` then `INSERT` inside one `runWrite` block. This avoids relying on `UPDATE` behaviour on constrained tables.
- No `ADD COLUMN … NOT NULL DEFAULT`; the table is new, so this does not apply.

New module `modules/preferences/` (`routes.ts`, `preferencesService.ts`), using the existing dashboard module as the reference pattern (`requireAuth`, `req.user!.id`, `z.ZodError` → 400, domain `PreferencesError` carrying a status). Mounted at `/api/me/preferences` in `app.ts`:

```ts
import { preferencesRouter } from './modules/preferences/routes.js';
// ...
app.use('/api/me/preferences', preferencesRouter);
```

| Route | Behaviour |
|---|---|
| `GET /api/me/preferences/grid-columns` | Returns the saved object, or the schema defaults (nothing hidden) if none |
| `PUT /api/me/preferences/grid-columns` | Validates with `gridPreferencesSchema`, upserts for `req.user.id` |
| `DELETE /api/me/preferences/grid-columns` | Reset to default (delete the row) |

Rules:

- Use `requireAuth` only. The user id always comes from the token, never from the body or URL, so users can only read or write their own preferences.
- Cap `value_json` size (e.g. 8 KB) and cap array lengths (see schema).
- Both roles can use it.

### 4.2 Client

New hook `hooks/useGridPreferences.ts` (React Query **v5 object syntax**, matching `hooks/useSettings.ts`):

- `useQuery({ queryKey: ['preferences', 'grid-columns'], queryFn })` to load. Use `localStorage` as a warm cache so the grid does not flash all columns on first paint.
- `useMutation` to save via `PUT`. Optimistic update, debounced about 400 ms, so ticking several boxes causes one PUT.
- On failure, keep the local change, show a toast ("Couldn't save your view"), and retry on the next change.

The hook exposes `{ hiddenColumnIds, hiddenGroupIds, setColumnVisible, setGroupVisible, applyPreset, reset, isColumnVisible }`.

No changes to `useStickyColumns`.

## 5. Grid behaviour (`ProjectTable.tsx`)

1. Add a prop `columnVisibility: Record<string, boolean>` (default `{}`). The existing `stickyColumnIds` prop is untouched.
2. Pass it into `useReactTable({ data, columns, getCoreRowModel, state: { columnVisibility } })`.
3. `leafHeaders` is computed from `table.getHeaderGroups().at(-1)`, which already contains only visible leaves. `gridTemplateColumns`, `tableWidth` and sticky offsets then follow automatically.
4. In `stickySet`, drop any id not present in `leafHeaders` at render time (a hidden-but-pinned column stops sticking; the saved sticky state is retained, so re-showing it restores the pin). This is the only change to sticky logic and it does not alter the sticky menu or hook.
5. `ColumnGroupHeader` needs no change in principle (it reads `header.subHeaders`), but verify that a group with zero visible leaves renders no cell and does not leave a grid gap.

Edge cases:

- **Hiding the whole Vendor group** still leaves one display row per vendor line, because `flattenRows` and server pagination are based on line counts. Decision for v1: do not collapse rows. Rows would look blank and duplicated, so add a small hint in the menu ("Rows are still shown per vendor line"). Collapsing is a later option.
- **Dashboard drill-down highlight** works on rows, not columns, so it is unaffected.
- **Inline editing** only applies to visible cells, so there is nothing to change.
- **`getColumnSizes()`** is used for the sticky width cap; it keeps summing all columns — unchanged, since sticky is untouched.

## 6. UI: a separate "Columns" control

Leave `<StickyColumnsMenu>` where it is (next to the Year/Stage filters). Add a new `<ColumnsMenu>` directly beside it. Two buttons: **Columns (n)** (new, testids `columns-button`, `columns-panel`, `columns-reset`) and the existing **Sticky columns (n)**.

The Columns panel has a single **Show / hide** tab (no Pin tab — sticky stays separate):

- A checkbox per group (tri-state: all / some / none). Clicking it toggles every column in that group and sets or clears `hidden_group_ids`. For `project_info`, "off" collapses to the two locked columns.
- Indented checkboxes per column under each group, using the same labels as the headers.
- Locked columns shown checked and disabled, with a lock icon and tooltip.
- Search box to filter the list (about 32 columns).
- Footer: "Showing 32 of 32 columns" and **Reset to default**.

**Presets** (a row of chips at the top, applied as one click; Project Info's locked pair is always retained):

- *All columns* (default)
- *Compact*: Project Info + Update Progress + Customer name/price
- *Customer focus*: Project Info + Customer Section
- *Vendor focus*: Project Info + Vendor Section

Presets only set `hidden_*`; they do not save user-named views (out of scope for v1).

Accessibility: panel is a `role="dialog"` or `menu` with focus trap and Escape to close. Checkboxes keep their `aria-label`s. Tri-state uses `aria-checked="mixed"`.

**Interplay with sticky:** a pinned column that gets hidden is simply not rendered (not sticky); re-showing it restores the pin. The sticky menu continues to list all columns (simplest, additive), so a hidden pinned column still shows checked in the sticky menu but is not rendered — covered by the menu hint. Filtering the sticky list to visible-only columns is a possible follow-up, not v1.

## 7. Implementation steps

1. `shared`: add `gridPreferences.ts` schema and export it from `index.ts`.
2. `server`: add the `user_preferences` table to `migrate.ts`; add the `preferences` module and the `/api/me/preferences` mount in `app.ts`.
3. `web/columns.tsx`: add `getColumnGroups(): { id, label, locked, columns: { id, label, locked }[] }[]`. Keep `getColumnOptions()` working for the sticky tab.
4. `web/hooks`: add `useGridPreferences` (React Query v5 syntax).
5. `web/components/data-grid`: add `ColumnsMenu.tsx` (new; leave `StickyColumnsMenu.tsx` alone).
6. `ProjectTable.tsx`: accept `columnVisibility` and wire it into `useReactTable`; drop hidden ids from `stickySet`.
7. `GridPage.tsx`: render `<ColumnsMenu>` beside the existing `<StickyColumnsMenu>` and pass the visibility state down.
8. Tests (section 8).

Optional, unrelated cleanup (separate from this feature — do only if wanted): filter `DEFAULT_STICKY_COLUMN_IDS` through `VALID` in `useStickyColumns.ts` so the commented-out `drive_folder_id` no longer rides along in the default. It is harmless today because no header matches it.

## 8. Test plan

`apps/web/e2e/column-visibility.spec.ts` (Playwright; create fixtures through the API like `sticky-columns.spec.ts`):

- Hiding the Vendor group removes its group header and all vendor leaf headers; the grid has no empty column gap.
- Un-hiding restores them.
- Hiding a single Customer column leaves the rest of Customer visible, and the group checkbox shows the mixed state.
- `project_name` and `#` cannot be unchecked.
- Reload keeps the view. **Log out and back in in a fresh browser context**: the view still applies (this proves it is per profile, not per browser).
- Two users keep different views (admin vs `staff1`).
- Reset restores all columns.
- A pinned column that gets hidden is not sticky, and is sticky again once re-shown.
- API: `PUT` with a bad payload returns 400, and a user cannot read another user's preferences (no user id in the route).
- `sticky-columns.spec.ts` still passes unchanged (the default view hides nothing, so its `IDX` indexes stay valid).

## 9. Acceptance criteria

- A user can hide and show individual columns and whole groups from one panel, without affecting the existing Sticky columns control.
- The choice persists after reload and on a different browser, per user.
- Locked columns cannot be hidden.
- No layout gaps, and sticky offsets stay correct after hiding.
- The default view for new users is identical to today's grid.
- Reset returns to that default.

## 10. Open decisions

1. Should hiding the Vendor group also collapse rows to one per project? (Recommended: not in v1.)
2. Admin-set default view for all staff? (Not in v1; the schema does not block it.)
3. Later: filter the Sticky columns menu to only visible columns?
