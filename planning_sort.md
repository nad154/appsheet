# Planning: Stable Default Sort + 3-State Sort Cycle + Column Width Fixes

**Audience:** opencode (execute phases in order; run `npm run typecheck` and the
relevant Playwright specs as a gate before moving to the next phase).

**Repo:** `opencode2` monorepo — `apps/web`, `apps/server`, `packages/shared`.

---

## 0. Problem statement

Three related but separable issues in the Grid tab:

1. **Rows re-order on every edit.** The grid currently defaults to
   `sort_by=updated_at, sort_dir=desc`. Since `updated_at` changes on every
   write (inline cell edit, modal save, approval), the row a user just edited
   jumps to the top on refetch. We want the *default* view to be sorted by
   `created_at` (which never changes after insert), so the row order is
   stable across edits.

2. **No way to "release" a sort back to default.** Clicking a sortable column
   header currently toggles only between ascending and descending
   (`ProjectTable.tsx` → `handleSortClick`). We want a third click state that
   clears the explicit sort and returns to the default (`created_at`) order.

3. **Certain columns truncate content that shouldn't truncate** — specifically
   the date columns (rendered via `selectDate()` in `columns.tsx`, e.g. "13
   September 2026") and the free-text ID columns (`doc2_number_id`,
   `vendor_project_id`, `document_id`). Their fixed pixel `size` is too narrow
   for their typical rendered content, so the CSS `truncate` class kicks in
   even on normal values.

---

## 1. Decisions

- **Default sort key/direction:** `created_at ASC` (oldest-created project
  first, i.e. insertion order). *(Confirmed by Nana.)*

- **Sort model stays single-column** (matches today's behavior — one active
  `sortBy`/`sortDir` pair, not a stacked multi-sort). The 3-state cycle is
  per column:
  1. Click on an unsorted (or differently-sorted) column → **ASC**
  2. Click again on the same column → **DESC**
  3. Click a third time on the same column → **clears the explicit sort**,
     reverting to the default (`created_at DESC`). No column shows a sort
     arrow in this state.

- **Representing "default/no explicit sort":** `sortBy` becomes
  `string | undefined` where `undefined` means "use the server default."
  This is already close to the existing type in `GridPage.tsx`; the change is
  that the *initial* state and the "3rd click" state now both use `undefined`
  instead of a hardcoded `'updated_at'`.

- **Column width strategy — static widening, not dynamic measurement.**
  Date and ID-pattern fields in this app follow fixed, predictable formats
  (a bounded date string, or prefixed IDs like `PO/2026/000600`). Given the
  grid is CSS-grid based and virtualized (column widths come from
  `header.getSize()` baked into an explicit `gridTemplateColumns`), the
  simplest robust fix is to increase the static `size` passed into the
  `selectDate()` / `text()` column factories for the affected columns, rather
  than building a content-measurement system (canvas `measureText`, dynamic
  `columnSizing` state, recompute-on-data-change, etc.). The dynamic approach
  is real but disproportionate here: content formats are controlled by this
  app, not arbitrary user text, so a generous fixed width reliably prevents
  truncation without added complexity or re-render cost.
  - Keep `truncate` + a `title` attribute as a safety net on every affected
    cell, so if an unusually long value ever does exceed the fixed width, the
    full value is still visible on hover instead of silently cut off with no
    way to see it.

---

## 2. Phase 1 — Default sort → `created_at`, stable across edits

**Files:**
- `apps/web/src/app/grid/GridPage.tsx`
- `apps/server/src/modules/projects/projectsService.ts`

**Changes:**

1. In `GridPage.tsx`, change the initial sort state:
   ```ts
   const [sortBy, setSortBy] = useState<string | undefined>(undefined);
   const [sortDir, setSortDir] = useState<SortDir | undefined>(undefined);
   ```
   (Previously: `useState<string | undefined>('updated_at')` and
   `useState<SortDir>('desc')`.)

2. `useProjects` / `apiClient` already treat `sort_by`/`sort_dir` as optional
   query params — when both are `undefined`, the request omits them, so the
   server must supply the default.

3. In `projectsService.ts` (`listProjects`), the current fallback is:
   ```ts
   const sortExpr = SORTABLE_COLUMNS[sortKey] ?? 'updated_at';
   ```
   Change the default fallback (used both for an empty/omitted `sort_by` and
   for an unrecognized key) to `created_at`:
   ```ts
   const sortExpr = SORTABLE_COLUMNS[sortKey] ?? 'created_at';
   ```
   Also change the default `sortDir` so an omitted `sort_by` (i.e. the
   "default view") resolves to **ASC**, not the current `DESC` fallback. The
   existing line:
   ```ts
   const sortDir = query.sort_dir === 'asc' ? 'ASC' : 'DESC';
   ```
   defaults to `DESC` whenever `sort_dir` is absent, which is wrong once
   `sort_by` is also absent (the default-view case). Make the fallback
   direction depend on whether a `sort_by` was actually supplied:
   ```ts
   const sortDir = query.sort_dir
     ? (query.sort_dir === 'asc' ? 'ASC' : 'DESC')
     : (query.sort_by ? 'DESC' : 'ASC');
   ```
   This keeps `DESC` as the fallback direction if a caller sends an explicit
   `sort_by` without a `sort_dir` (unchanged behavior for that edge case),
   but makes the true default (no `sort_by`, no `sort_dir`) resolve to
   `created_at ASC`.

4. `created_at` is already present in `SORTABLE_COLUMNS` (`created_at:
   'created_at'`) — no whitelist change needed.

5. Double check `ProjectTable.tsx`'s `sortDir = 'asc'` default prop — since
   `isActiveSort` is gated on `columnId === sortBy`, and `sortBy` will be
   `undefined` by default, no column will show an active-sort arrow in the
   default state. This is correct/desired — leave as-is, just confirm the
   type accepts `undefined` for `sortBy`.

**Verification:** with default sort active, edit a field on a row that is not
at the top of the list (inline cell edit or modal save) and confirm the row
stays in the same position after the refetch (previously it would jump,
since `updated_at` changed).

---

## 3. Phase 2 — Three-state column header sort cycle

**Files:**
- `apps/web/src/components/data-grid/ProjectTable.tsx`
- `apps/web/src/app/grid/GridPage.tsx`

**Changes:**

1. `ProjectTable.tsx` props: widen the types to allow clearing the sort:
   ```ts
   sortBy?: string;
   sortDir?: SortDir;
   onSortChange: (sortBy: string | undefined, sortDir: SortDir | undefined) => void;
   ```

2. Replace `handleSortClick`'s two-state toggle with a three-state cycle:
   ```ts
   const handleSortClick = (columnId: string) => {
     resetEditing();
     if (sortBy !== columnId) {
       onSortChange(columnId, 'asc');
     } else if (sortDir === 'asc') {
       onSortChange(columnId, 'desc');
     } else {
       // Third click on the same column: release back to the app default.
       onSortChange(undefined, undefined);
     }
   };
   ```

3. `GridPage.tsx`'s `handleSortChange` must accept the cleared state:
   ```ts
   const handleSortChange = (nextSortBy: string | undefined, nextSortDir: SortDir | undefined) => {
     setSortBy(nextSortBy);
     setSortDir(nextSortDir);
     setPage(1);
   };
   ```

4. No change needed to the header-arrow rendering logic in
   `ProjectTable.tsx` (`isActiveSort`, the `↑`/`↓` glyph) — when `sortBy` is
   `undefined` none of the columns match, so no arrow is shown, which
   correctly signals "default order."

**Verification (manual/dev):** click a sortable header (e.g. "Project") once
→ ascending arrow, rows sort A→Z. Click again → descending arrow, rows sort
Z→A. Click a third time → arrow disappears, rows return to the
`created_at ASC` default order (same order as a fresh page load).

---

## 4. Phase 3 — Column width fixes (dates + ID fields)

**File:** `apps/web/src/components/data-grid/columns.tsx`

1. Bump the default size in the `selectDate()` factory from `130` to `170`
   (the longest realistic rendered value, e.g. `"30 September 2026"`, needs
   more room than 130px at the current `text-sm` size plus `px-3` cell
   padding).
   ```ts
   function selectDate(accessorKey: keyof Project, header: string, size = 170): ColumnDef<Project> {
   ```

2. Update the explicit per-call sizes on every `selectDate(...)` invocation
   in `projectColumns` that currently pass a narrower override, so they all
   land at `170` (or omit the override to use the new default):
   - `date_customer_received_doc1` (140 → 170)
   - `date_customer_received_doc2` (140 → 170)
   - `customer_start_contract` (130 → 170)
   - `customer_end_contract` (130 → 170)
   - `project_sent_date` (130 → 170)
   - `project_finish_date` (130 → 170)
   - `negotiation_date` (130 → 170)
   - `approval_date` (130 → 170)
   - `document_sent_date` (130 → 170)
   - `vendor_start_contract` (130 → 170)
   - `vendor_end_contract` (130 → 170)

3. Widen the free-text ID columns that hold structured codes, via their
   `text(...)` calls in `projectColumns`:
   - `doc2_number_id` (120 → 170)
   - `vendor_project_id` (130 → 170)
   - `document_id` (130 → 170)

4. Add a `title` attribute to the `text()` factory's cell renderer so any
   value that still overflows a widened column remains inspectable on hover
   (the `selectDate()` factory should get the same treatment for its raw ISO
   value, or a formatted title — either is fine, formatted is friendlier):
   ```ts
   // text()
   return (
     <span className="block truncate text-sm text-gray-800" title={String(v)}>
       {String(v)}
     </span>
   );
   ```
   ```ts
   // selectDate()
   return (
     <span className="block truncate text-sm text-gray-800" title={display}>
       {display}
     </span>
   );
   ```

5. Do **not** change `numberCol()`, `selectCol()`, or the sticky
   `project_info` group columns (`project_name`, Sales, PIC, Stage) — those
   are out of scope for this request and already sized reasonably.

**Verification:** load the grid with the seeded/dummy data and visually
confirm no date or ID column shows an ellipsis for a normal-length value.
Spot-check the longest month name ("September") in a date column at the new
width.

---

## 5. Phase 4 — Tests

**Files:**
- `apps/web/e2e/grid.spec.ts` (extend) or a new `apps/web/e2e/grid-sort.spec.ts`

1. **Sort stability across edits.** After logging in as admin:
   - Capture the on-screen order of the first few visible project names in
     the default view.
   - Edit a non-top row's field (e.g. change `Issues` via the inline cell or
     the row modal) and save.
   - Re-assert the captured order is unchanged (the edited row does not move
     to the top). This directly tests the Phase 1 fix.

2. **Three-click header cycle.** Click a sortable header once and assert the
   `aria-sort="ascending"` state (or the `↑` glyph) plus a re-ordering of at
   least one known pair of rows; click again and assert `descending`; click a
   third time and assert neither `ascending` nor `descending` is set (no
   `aria-sort` other than `none`) and that the row order matches the
   default-view snapshot captured before any header clicks.

3. **Regression check:** confirm `priority.spec.ts`, `dashboard.spec.ts`, and
   `dashboard-drilldown.spec.ts` don't implicitly depend on the old
   `updated_at DESC` default ordering (a quick read of each — none of them
   assert on default row order today, so no changes expected there, but
   re-run them as part of the gate).

**Phase gate:** `npm run typecheck` (root, which fans out to both
workspaces) and `npx playwright test` for the grid-related specs must pass
before this work is considered done.

---

## 6. Resolved decisions (confirmed by Nana)

1. **Default direction:** `created_at ASC` — oldest/first-created project on
   top. Implemented in Phase 1 above.
2. **Column width:** `170px` for the date and ID columns listed in Phase 3,
   kept as-is for now. Revisit only if real production data (as opposed to
   the dummy seed data) turns out to run noticeably longer than the sampled
   `PO/2026/000600`-style values.

## 7. Remaining open item

Anything else that currently assumes `updated_at` is the default sort (e.g.
a future export/report feature) should be checked against this change,
though nothing in the current codebase besides `GridPage.tsx`'s initial
state and `projectsService.ts`'s fallback appears to rely on it.
