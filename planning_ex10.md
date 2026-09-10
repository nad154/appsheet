# Dashboard Drill-Down: Click Chart Segment → View & Highlight Project

## Goal
On the Dashboard tab, clicking a pie slice or bar segment (e.g. Priority = "Low")
shows the list of projects in that category, respecting the same RBAC scoping
as the rest of the app. Clicking a project in that list navigates to the Grid
tab and briefly highlights that row so the user can find it.

## Constraints / existing conventions to respect (read before starting)
- RBAC row-scoping MUST reuse `scopeClause` from
  `apps/server/src/modules/projects/projectsService.ts`. Never re-implement
  STAFF filtering — the whole point of `scopeClause` is that the grid and
  dashboard can't diverge on what a STAFF user is allowed to see.
- `priority` is derived at query time from aging thresholds, never persisted.
  Drill-down for the `priority` column must compute aging/priority in JS from
  `project_sent_date` / `approval_date`, exactly like
  `dashboardService.getChartData` already does for the `priority` case. Do not
  try to `WHERE priority = ?` in SQL.
- `DASHBOARD_COLUMNS` in `packages/shared/src/schemas/dashboardView.ts` is the
  authoritative whitelist. The new endpoint must validate `column` against it
  too — never interpolate a client-supplied column name into SQL.
- For `staff_assigned_id` / `pic_id`, the value the user clicks in the chart
  legend is the *joined display name* (or "Unassigned"), not the raw user id
  — see `getChartData`'s `COALESCE(u.name, 'Unassigned')`. The drill-down
  query must match on the same derived label, or clicking "Unassigned" will
  return nothing.
- The Grid is virtualized (`@tanstack/react-virtual`) and paginated
  server-side (`page_size` up to 500). A project clicked from the dashboard
  may not be on whatever page/sort the grid currently has loaded — this must
  be resolved before you can scroll to and highlight the row. Don't assume
  it's always on page 1.
- COUNT(*)/aggregate results from DuckDB come back as BigInt — wrap in
  `Number()` before JSON-serializing, per existing convention.
- The chart labels for `priority` are **capitalized** (`Low`/`Medium`/`High`) but
  `computePriority` returns lowercase (`low`/`medium`/`high`). The drill-down
  filter must compare `value.toLowerCase()` against the computed value — never
  the raw `value`.
- **There are no `@keyframes` defined anywhere yet** (the existing
  `animate-[toast-in_0.18s_ease-out]` in `Toast.tsx` is a silent no-op because
  no `toast-in` keyframes exist). A Tailwind arbitrary animation class alone
  will NOT animate. Phase 3 must add `@keyframes row-flash` to `index.css`
  (plain CSS block next to the `@tailwind` directives) or the highlight will be
  invisible. Do NOT touch `Toast.tsx`.

## Phase 1 — Backend: drill-down endpoint
Files: `apps/server/src/modules/dashboard/dashboardService.ts`,
`apps/server/src/modules/dashboard/routes.ts`

- Add `GET /api/dashboard/drill-down?column=<DashboardColumn>&value=<string>`,
  mounted on the existing `dashboardRouter` (already has `requireAuth`). Zod
  validates both params (`column` against `DASHBOARD_COLUMNS`, `value` a
  non-empty string).
- Reuse `scopeClause(user)` for RBAC filtering — identical to `getChartData`.
- Response shape: `{ projects: { id: string; project_name: string }[] }`,
  ordered by `project_name ASC` for deterministic output.
- Shared type: add `drillDownSchema` + `DrillDownResult` to
  `packages/shared/src/schemas/dashboardView.ts` (single source of truth for
  client and server, per convention).
- Implementation:
  - If `column === 'priority'`: fetch `id, project_name, project_sent_date,
    approval_date` for the scoped rows, compute `computePriority(computeAging(row),
    thresholds)` per row (reuse `resolveAgingThresholds()`), and filter where
    the computed value equals `value.toLowerCase()`.
  - Else if `column` is `staff_assigned_id` or `pic_id`: join to `users` the
    same way `getChartData` does, and match on `COALESCE(u.name, 'Unassigned') =
    value`. Assemble the scope clause and this condition as `WHERE ... AND ...`
    (guard for the empty admin clause).
  - Else (plain columns like `current_stage`, `service_or_goods`,
    `vendor_type`, `market_segment`): match `COALESCE(p.<column>::VARCHAR, 'Unset') =
    value`.
- Gate: typecheck, plus a manual check that a STAFF token never returns a
  project outside their own `staff_assigned_id`.

## Phase 2 — Frontend: click-to-drill-down list
Files: `apps/web/src/hooks/useDashboard.ts`,
`apps/web/src/components/dashboard/ChartCard.tsx`,
new `apps/web/src/components/dashboard/DrillDownPanel.tsx`

- Add `useDrillDown(columnKey, value)` — a `useQuery` hitting the new
  endpoint, `enabled: value != null`.
- In `ChartCard`:
  - Pie: add `onClick` to `<Pie>` — recharts passes `(data)` where
    `data.name` is the clicked label.
  - Bar: add `onClick` to `<Bar>` similarly.
  - On click, store `{ columnKey, value: data.name }` in local state and
    render `DrillDownPanel`.
- `DrillDownPanel` (new): **inline panel rendered below the chart inside the
  same card** (Decision, confirmed). Loading / error / empty states, plus:
  - The list is **capped at the first 50 projects** with a `Showing N of M`
    footer note when there are more (Decision, confirmed).
  - Each row is a project-name button; clicking it calls
    `navigate('/grid', { state: { highlightProjectId: project.id } })`
    (`useNavigate` in `ChartCard`, passed down).
  - A close (×) button clears the drill-down local state.

## Phase 3 — Grid: locate and highlight the target row
Files: `apps/web/src/app/grid/GridPage.tsx`,
`apps/web/src/components/data-grid/ProjectTable.tsx`,
`apps/web/src/index.css`

- `GridPage` reads `location.state?.highlightProjectId` via `useLocation` on
  mount into `highlightedRowId` state.
- Resolving the row's position (Option A confirmed — matches this app's
  ≤500-row scale):
  - While `highlightedRowId` is set, a secondary **locator query**
    (`page: 1, page_size: 500, sort_by: 'updated_at', sort_dir: 'desc'` — the
    default sort) runs through the existing `useProjects` hook; its distinct
    query key (`['projects', {...params}]`) already keeps it from clashing
    with the grid's own query.
  - When the target row is found in that 500-row set, compute
    `targetPage = floor(index / currentPageSize) + 1` and `setPage(targetPage)`.
  - If the row isn't found (project deleted / >500 scoped rows), clear the
    highlight state quietly — no crash, no stale highlight.
- Add `highlightedRowId` state in `GridPage`, passed down to `ProjectTable` as
  an optional prop. Once the target row is present in `modelRows`:
  - Call `rowVirtualizer.scrollToIndex(rowIndex, { align: 'center' })`.
  - Apply `bg-yellow-200` + `animate-[row-flash_1.5s_ease-out]` on the row,
    and `data-testid="highlighted-row"` for the e2e test.
  - Clear `highlightedRowId` after ~1.8s (`setTimeout`), which also triggers
    GridPage's state/nav cleanup.
- **`index.css`:** add `@keyframes row-flash` (yellow → transparent fade,
  ~1.5s) as a plain CSS block next to the `@tailwind` directives. Without
  defined keyframes the arbitrary animation class is a silent no-op (see the
  gotcha at the top of this file). Do NOT modify `Toast.tsx`.
- After consuming `location.state`, clear it (`navigate('.', { replace:
  true, state: {} })`) so refreshing the Grid page doesn't re-trigger the
  highlight.

## Phase 4 — Tests and polish
- Playwright test (new file, e.g. `apps/web/e2e/dashboard-drilldown.spec.ts`):
  login as SUPER_ADMIN, create a Stage pie view (unique label per run, per the
  `dashboard.spec.ts` convention), click a `.recharts-sector` slice →
  drill-down panel shows a project name → click it → land on `/grid` with the
  `[data-testid="highlighted-row"]` row scrolled into view and carrying the
  highlight class. Delete the view afterwards.
- Manual RBAC check: log in as STAFF, confirm drill-down never lists a
  project outside their scope, even if you guess another project's id.
- **Verification scope (Decision, confirmed):** `npm run typecheck`
  across workspaces + run the new drill-down spec only. Do NOT gate on the
  full existing Playwright suite — it has 7 pre-existing failures from an
  earlier DB state and is not authoritative for this feature.

## Decisions (confirmed with the user before implementation)
1. **Drill-down panel UX:** inline panel below the chart inside the same card
   (not a modal), list capped at the first 50 projects with a `Showing N of M`
   footer when truncated.
2. **Verification:** typecheck across workspaces + the new drill-down e2e spec
   + a manual STAFF RBAC spot-check. Full suite is not a merge gate.
3. **Row-flash keyframes:** add `@keyframes row-flash` to `index.css` so the
   highlight animates (the existing `toast-in` reference is a no-op today);
   `Toast.tsx` is left untouched.
4. **Grid locate (Option A):** one-time locator fetch at `page_size: 500` with
   the default sort (`updated_at desc`), compute the target page, then
   scroll+flash once the row is in `modelRows`. Option B (server-side resolve)
   is explicitly out of scope at this scale.

## Open questions (resolved — no longer blocking)
- ~~Should the drill-down panel show ALL matching projects, or cap/paginate
  the list if a category is large?~~ → Capped at 50, `Showing N of M` note
  (Decision 1).
- ~~Inline panel under the chart vs. a modal — pick whichever fits the
  existing Dashboard layout better.~~ → Inline panel under the chart
  (Decision 1).
