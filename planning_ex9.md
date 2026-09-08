# Planning: Dashboard Tab, Row Edit Modal, Aging Priority

**Project:** opencode2 (`apps/web`, `apps/server`, `packages/shared`)
**Audience:** AI coding agent (e.g. via opencode / Claude Code) working directly in this repo.

This plan adds three related features:

1. A new **Dashboard** tab, unique per user, where a user builds "views" (pie or bar chart of a chosen column).
2. A **row edit modal** — hover over the project name cell to reveal an edit icon; clicking opens a popup with all fields of that row, editable and saveable in one action.
3. An **Aging → Priority** system: SUPER_ADMIN-configurable Low/Medium/High day thresholds, and a new **non-editable** `Priority` column derived from `Aging`.

Follow the repo's existing conventions throughout:
- DuckDB: no real FKs (app-layer referential integrity only), all writes go through `runWrite`, all schema changes go through `migrate.ts`'s idempotent `CREATE TABLE IF NOT EXISTS` + `columnExists`/`ALTER TABLE` pattern.
- Zod schemas live in `packages/shared/src/schemas/*.ts` and are re-exported from `packages/shared/src/index.ts`.
- Server modules follow `modules/<name>/{routes.ts,<name>Service.ts}` with a custom `<Name>Error` class and a local `handleError`.
- Client data access follows `hooks/use<Name>.ts` wrapping `apiClient` + React Query.
- RBAC is enforced server-side (`requireRole`), client-side checks in `lib/rbac.ts` are UX-only.
- After every direct write, call `exportSnapshots([...])` for the affected tables (skip for tables that don't need a parquet snapshot, e.g. brand-new `dashboard_views` / `aging_thresholds` — see Phase 0 notes).

---

## Phase 0 — Shared schema & types

**Goal:** Establish the new DB tables, shared TypeScript types/zod schemas, and the pure priority-calculation function, with zero UI changes yet.

### 0.1 `packages/shared/src/thresholds.ts`
Add default aging threshold constants (used to seed the DB row):
```ts
export const DEFAULT_AGING_LOW_MAX_DAYS = 15;
export const DEFAULT_AGING_MEDIUM_MAX_DAYS = 30;
```
(High = anything strictly greater than `medium_max_days`.)

### 0.2 `packages/shared/src/lib/aging.ts` (extend, don't replace)
Add:
```ts
export const PRIORITY_LEVELS = ['low', 'medium', 'high'] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

export interface AgingThresholds {
  low_max_days: number;
  medium_max_days: number;
}

/** Pure function — mirrors computeAging's null-propagation. */
export function computePriority(
  aging: number | null,
  thresholds: AgingThresholds,
): PriorityLevel | null {
  if (aging === null) return null;
  if (aging <= thresholds.low_max_days) return 'low';
  if (aging <= thresholds.medium_max_days) return 'medium';
  return 'high';
}
```
Keep `computeAging` untouched — `Priority` is always derived from its output, never recomputed independently, so the two can never disagree.

### 0.3 New schema file `packages/shared/src/schemas/agingThresholds.ts`
```ts
import { z } from 'zod';

export const agingThresholdsSchema = z.object({
  low_max_days: z.number().int().positive(),
  medium_max_days: z.number().int().positive(),
}).refine((v) => v.medium_max_days > v.low_max_days, {
  message: 'medium_max_days must be greater than low_max_days',
});

export type AgingThresholdsInput = z.infer<typeof agingThresholdsSchema>;
```

### 0.4 New schema file `packages/shared/src/schemas/dashboardView.ts`
```ts
import { z } from 'zod';

export const CHART_TYPES = ['pie', 'bar'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

// Whitelist of columns a user may build a view on. Keep in sync with
// DASHBOARD_CHARTABLE_COLUMNS in apps/server (server is authoritative).
export const DASHBOARD_COLUMNS = [
  'current_stage',
  'service_or_goods',
  'vendor_type',
  'market_segment',
  'staff_assigned_id',
  'pic_id',
  'priority',
] as const;
export type DashboardColumn = (typeof DASHBOARD_COLUMNS)[number];

export const dashboardViewSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  chart_type: z.enum(CHART_TYPES),
  column_key: z.enum(DASHBOARD_COLUMNS),
  label: z.string().min(1),
  sort_order: z.number().int(),
  created_at: z.string().datetime(),
});

export const dashboardViewCreateSchema = z.object({
  chart_type: z.enum(CHART_TYPES),
  column_key: z.enum(DASHBOARD_COLUMNS),
  label: z.string().min(1).max(80),
});

export type DashboardView = z.infer<typeof dashboardViewSchema>;
export type DashboardViewCreate = z.infer<typeof dashboardViewCreateSchema>;

// Response shape for GET /api/dashboard/views/:id/data
export const chartDataSchema = z.object({
  labels: z.array(z.string()),
  values: z.array(z.number()),
});
export type ChartData = z.infer<typeof chartDataSchema>;
```

### 0.5 `packages/shared/src/index.ts`
Add:
```ts
export * from './schemas/agingThresholds.js';
export * from './schemas/dashboardView.js';
```

### 0.6 `apps/server/src/db/migrate.ts` — new tables + column
Add to `DDL`:
```sql
CREATE TABLE IF NOT EXISTS dashboard_views (
  id VARCHAR PRIMARY KEY,
  user_id VARCHAR NOT NULL,           -- FK dropped, DuckDB UPDATE limitation
  chart_type VARCHAR NOT NULL CHECK (chart_type IN ('pie','bar')),
  column_key VARCHAR NOT NULL,
  label VARCHAR NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS aging_thresholds (
  id VARCHAR PRIMARY KEY,             -- always the literal 'default' (singleton row)
  low_max_days INTEGER NOT NULL,
  medium_max_days INTEGER NOT NULL,
  updated_by VARCHAR,                 -- FK dropped
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);
```
Add a `migrateColumns()`-style seed step (new function `seedAgingThresholds()`, called from `migrate()` after `migrateColumns()`):
```ts
async function seedAgingThresholds(): Promise<void> {
  const rows = await runRead<{ id: string }>(`SELECT id FROM aging_thresholds WHERE id = 'default'`);
  if (rows.length === 0) {
    await runWrite(async (exec) => {
      await exec(
        `INSERT INTO aging_thresholds (id, low_max_days, medium_max_days, updated_at)
         VALUES ('default', ?, ?, current_timestamp)`,
        [DEFAULT_AGING_LOW_MAX_DAYS, DEFAULT_AGING_MEDIUM_MAX_DAYS],
      );
    });
  }
}
```
(Import the two constants from `@tracker/shared`.) These two tables are never exported to parquet — they're operational/config data, not part of the projects/users domain snapshot contract in `export.ts`. Leave `export.ts`'s `exportSnapshots` signature untouched.

**Checkpoint:** run `npm run typecheck --workspaces` and confirm `packages/shared` builds before moving to Phase 1.

---

## Phase 1 — Backend: Aging Thresholds (settings, SUPER_ADMIN only)

**Goal:** SUPER_ADMIN can read/update the two threshold values. This must land before Phase 2/3 because priority computation depends on it.

### 1.1 `apps/server/src/modules/settings/settingsService.ts`
Add:
```ts
export async function getAgingThresholds(): Promise<AgingThresholds> {
  const rows = await runRead<{ low_max_days: number; medium_max_days: number }>(
    `SELECT low_max_days, medium_max_days FROM aging_thresholds WHERE id = 'default'`,
  );
  const row = rows[0];
  return row
    ? { low_max_days: row.low_max_days, medium_max_days: row.medium_max_days }
    : { low_max_days: DEFAULT_AGING_LOW_MAX_DAYS, medium_max_days: DEFAULT_AGING_MEDIUM_MAX_DAYS };
}

export async function updateAgingThresholds(rawPayload: unknown, caller: AuthUser): Promise<void> {
  const payload = agingThresholdsSchema.parse(rawPayload);
  await runWrite(async (ex) => {
    await ex(
      `UPDATE aging_thresholds SET low_max_days = ?, medium_max_days = ?, updated_by = ?, updated_at = current_timestamp
       WHERE id = 'default'`,
      [payload.low_max_days, payload.medium_max_days, caller.id],
    );
  });
}
```
No `exportSnapshots` call needed (not part of the parquet contract).

### 1.2 `apps/server/src/modules/settings/routes.ts`
Add (still under the existing `settingsRouter.use(requireAuth, requireRole('SUPER_ADMIN'))` gate — this whole router is already admin-only, matching the "only available to SUPER_ADMIN" requirement):
```ts
settingsRouter.get('/aging-thresholds', async (_req, res) => {
  try {
    res.json(await getAgingThresholds());
  } catch (err) {
    handleError(err, res);
  }
});

settingsRouter.patch('/aging-thresholds', async (req, res) => {
  try {
    await updateAgingThresholds(req.body, req.user!);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});
```

### 1.3 Server-side helper used by everything downstream
Create `apps/server/src/modules/settings/agingThresholdsCache.ts` (small in-memory cache, invalidated on update, so every project-list request doesn't need an extra round trip):
```ts
import { getAgingThresholds } from './settingsService.js';
import type { AgingThresholds } from '@tracker/shared';

let cached: AgingThresholds | null = null;

export async function resolveAgingThresholds(): Promise<AgingThresholds> {
  if (cached) return cached;
  cached = await getAgingThresholds();
  return cached;
}

export function invalidateAgingThresholdsCache(): void {
  cached = null;
}
```
Call `invalidateAgingThresholdsCache()` at the end of `updateAgingThresholds` in `settingsService.ts`.

### 1.4 Frontend: `apps/web/src/hooks/useSettings.ts`
Add:
```ts
export function useAgingThresholds() {
  const query = useQuery({
    queryKey: ['settings', 'aging-thresholds'],
    queryFn: () => apiClient.get<{ low_max_days: number; medium_max_days: number }>('/api/settings/aging-thresholds'),
  });
  return { data: query.data, isLoading: query.isLoading, isError: query.isError, error: query.error };
}

export function useUpdateAgingThresholds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { low_max_days: number; medium_max_days: number }) =>
      apiClient.patch<{ ok: boolean }>('/api/settings/aging-thresholds', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'aging-thresholds'] });
      qc.invalidateQueries({ queryKey: ['projects'] }); // Priority column will change
    },
  });
}
```

### 1.5 Frontend: `apps/web/src/app/settings/SettingsPage.tsx`
Add a third panel, `AgingThresholdsPanel`, below `MarketSegmentsPanel` (same visual style: bordered `section`, `btnPrimary`, inline validation message). Two number inputs: "Low priority — up to N days" and "Medium priority — up to N days", plus static text "High priority — anything above". Client-side guard: disable Save unless `medium > low` (mirrors the zod `.refine`). Reuse `alert(...)` fallback pattern already used elsewhere in this file for now (a toast wire-up is optional polish, not blocking).

**Checkpoint:** SUPER_ADMIN can view/edit thresholds in Settings; STAFF gets 403 (already enforced by the router-level `requireRole`).

---

## Phase 2 — Backend: Priority column (server-computed, read-only)

**Goal:** Every project row returned by the API includes a `priority` field, computed from `Aging` + current thresholds. No new column is stored in `projects` — priority is always derived, never persisted, so it can never drift from the thresholds.

### 2.1 `packages/shared/src/schemas/project.ts`
Add to `projectSchema` (not to `projectCreateSchema`/`projectUpdateSchema` — it must never be submittable):
```ts
priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
```

### 2.2 `apps/server/src/modules/projects/projectsService.ts`
After fetching `rows` in `listProjects`, enrich each row:
```ts
import { computeAging, computePriority } from '@tracker/shared';
import { resolveAgingThresholds } from '../settings/agingThresholdsCache.js';
// ...
const thresholds = await resolveAgingThresholds();
const enriched = rows.map((r) => ({
  ...r,
  priority: computePriority(computeAging(r), thresholds),
}));
return { rows: enriched, total, page, page_size: pageSize };
```
Do the same in `pendingEditsService.ts`'s `fetchProject()` (used by the diff view and by `submitUpdate`'s ownership check) for consistency, though the diff view can simply omit `priority` from `FIELD_LABELS`/`SECTION_OF` since it's never a changeable field — no diff-view code changes required there as long as `priority` is absent from `changes_json` (guaranteed by omitting it from `projectUpdateSchema`).

### 2.3 Frontend: `apps/web/src/components/data-grid/columns.tsx`
Add a read-only `priorityColumn`, styled like `StatusFlagCell` (badge with color per level), placed immediately after `agingColumn`:
```tsx
const PRIORITY_STYLES: Record<'low' | 'medium' | 'high', string> = {
  low: 'bg-green-100 text-green-800 border-green-300',
  medium: 'bg-amber-100 text-amber-800 border-amber-300',
  high: 'bg-red-100 text-red-800 border-red-300',
};
const PRIORITY_LABEL: Record<'low' | 'medium' | 'high', string> = {
  low: 'Low', medium: 'Medium', high: 'High',
};

const priorityColumn: ColumnDef<Project> = {
  id: 'priority',
  header: 'Priority',
  size: 100,
  enableSorting: false,
  // NOTE: no `meta.editable` — this makes it non-editable by construction,
  // since ProjectTable.tsx only renders the edit affordance when meta.editable is true.
  cell: ({ row }) => {
    const p = row.original.priority;
    if (!p) return <span className="text-gray-300">—</span>;
    return (
      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLES[p]}`}>
        {PRIORITY_LABEL[p]}
      </span>
    );
  },
};
```
Insert `priorityColumn` into the `vendor` column group array, right after `agingColumn`.

**Checkpoint:** Grid shows a Priority badge per row; changing thresholds in Settings and refetching the grid (`invalidateQueries(['projects'])` already wired in 1.4) changes the badges without a page reload.

---

## Phase 3 — Backend: Dashboard views CRUD + chart data endpoint

**Goal:** Per-user views, and an endpoint that returns grouped counts for a given column, respecting the same RBAC row-scoping as the grid (STAFF only sees their own projects).

### 3.1 Refactor: extract row-scoping so it's reusable
In `apps/server/src/modules/projects/projectsService.ts`, extract:
```ts
export function scopeClause(user: AuthUser): { whereClause: string; params: unknown[] } {
  if (user.role === 'STAFF') return { whereClause: 'WHERE p.staff_assigned_id = ?', params: [user.id] };
  return { whereClause: '', params: [] };
}
```
Use it in `listProjects` (replacing the inline `isStaff` logic) so the dashboard aggregation and the grid can never diverge in what a STAFF user is allowed to see.

### 3.2 New module `apps/server/src/modules/dashboard/dashboardService.ts`
```ts
import { runRead, runWrite } from '../../db/connection.js';
import { uuid } from '../../lib/uuid.js';
import { scopeClause } from '../projects/projectsService.js';
import { resolveAgingThresholds } from '../settings/agingThresholdsCache.js';
import { computeAging, computePriority, DASHBOARD_COLUMNS } from '@tracker/shared';
import type { AuthUser } from '../../middleware/requireAuth.js';
import type { DashboardView, DashboardViewCreate, ChartData, DashboardColumn } from '@tracker/shared';

export class DashboardError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'DashboardError';
  }
}

export async function listViews(userId: string): Promise<DashboardView[]> {
  return runRead<DashboardView>(
    `SELECT * FROM dashboard_views WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC`,
    [userId],
  );
}

export async function createView(user: AuthUser, payload: DashboardViewCreate): Promise<{ id: string }> {
  const id = uuid();
  await runWrite(async (ex) => {
    const [{ maxOrder } = { maxOrder: 0 }] = await ex<{ maxOrder: number }>(
      `SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM dashboard_views WHERE user_id = ?`,
      [user.id],
    );
    await ex(
      `INSERT INTO dashboard_views (id, user_id, chart_type, column_key, label, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, current_timestamp)`,
      [id, user.id, payload.chart_type, payload.column_key, payload.label, (maxOrder ?? 0) + 1],
    );
  });
  return { id };
}

export async function deleteView(user: AuthUser, viewId: string): Promise<void> {
  await runWrite(async (ex) => {
    // Ownership check baked into the WHERE clause — a user can only ever
    // delete their own view, mirroring the pending-edits ownership pattern.
    await ex(`DELETE FROM dashboard_views WHERE id = ? AND user_id = ?`, [viewId, user.id]);
  });
}

interface ProjectGroupRow {
  staff_assigned_id?: string | null;
  pic_id?: string | null;
  staff_assigned_name?: string | null;
  pic_name?: string | null;
  project_sent_date?: string | null;
  approval_date?: string | null;
  [key: string]: unknown;
}

/** Groups & counts rows for one column, applying the same RBAC scoping as the grid. */
export async function getChartData(user: AuthUser, columnKey: DashboardColumn): Promise<ChartData> {
  if (!DASHBOARD_COLUMNS.includes(columnKey)) {
    throw new DashboardError('Unsupported column', 400);
  }
  const { whereClause, params } = scopeClause(user);

  if (columnKey === 'priority') {
    const thresholds = await resolveAgingThresholds();
    const rows = await runRead<ProjectGroupRow>(
      `SELECT project_sent_date, approval_date FROM projects p ${whereClause}`,
      params,
    );
    const counts: Record<string, number> = { low: 0, medium: 0, high: 0 };
    for (const r of rows) {
      const p = computePriority(computeAging(r), thresholds);
      if (p) counts[p] += 1;
    }
    const labels = (['low', 'medium', 'high'] as const).filter((k) => counts[k] > 0);
    return { labels: labels.map((l) => l[0].toUpperCase() + l.slice(1)), values: labels.map((l) => counts[l]) };
  }

  const isUserColumn = columnKey === 'staff_assigned_id' || columnKey === 'pic_id';
  const selectExpr = isUserColumn
    ? `COALESCE(u.name, 'Unassigned') AS label`
    : `COALESCE(p.${columnKey}::VARCHAR, 'Unset') AS label`;
  const joinClause = isUserColumn ? `LEFT JOIN users u ON u.id = p.${columnKey}` : '';

  const rows = await runRead<{ label: string; cnt: number | bigint }>(
    `SELECT ${selectExpr}, COUNT(*) AS cnt
     FROM projects p ${joinClause} ${whereClause}
     GROUP BY label
     ORDER BY cnt DESC`,
    params,
  );
  return { labels: rows.map((r) => r.label), values: rows.map((r) => Number(r.cnt)) };
}
```
Note: `columnKey` is always validated against the `DASHBOARD_COLUMNS` whitelist before being interpolated — never accept an arbitrary client-supplied column name into SQL (same discipline as `SORTABLE_COLUMNS` in `projectsService.ts`).

### 3.3 `apps/server/src/modules/dashboard/routes.ts`
```ts
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/requireAuth.js';
import { dashboardViewCreateSchema, DASHBOARD_COLUMNS } from '@tracker/shared';
import { listViews, createView, deleteView, getChartData, DashboardError } from './dashboardService.js';

const idParam = z.object({ id: z.string().uuid() });
const columnQuery = z.object({ column: z.enum(DASHBOARD_COLUMNS) });

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/views', async (req, res) => {
  try { res.json(await listViews(req.user!.id)); } catch (err) { handleError(err, res); }
});

dashboardRouter.post('/views', async (req, res) => {
  try {
    const payload = dashboardViewCreateSchema.parse(req.body);
    res.status(201).json(await createView(req.user!, payload));
  } catch (err) { handleError(err, res); }
});

dashboardRouter.delete('/views/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  try { await deleteView(req.user!, id); res.json({ ok: true }); } catch (err) { handleError(err, res); }
});

dashboardRouter.get('/chart-data', async (req, res) => {
  try {
    const { column } = columnQuery.parse(req.query);
    res.json(await getChartData(req.user!, column));
  } catch (err) { handleError(err, res); }
});

function handleError(err: unknown, res: Response): void {
  if (err instanceof DashboardError) { res.status(err.statusCode).json({ error: err.message }); return; }
  if (err instanceof z.ZodError) { res.status(400).json({ error: 'Invalid input', details: err.flatten() }); return; }
  console.error('Dashboard error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
```

### 3.4 `apps/server/src/app.ts`
Register the router:
```ts
import { dashboardRouter } from './modules/dashboard/routes.js';
// ...
app.use('/api/dashboard', dashboardRouter);
```

**Checkpoint:** `POST /api/dashboard/views`, `GET /api/dashboard/views`, `DELETE /api/dashboard/views/:id`, `GET /api/dashboard/chart-data?column=current_stage` all work and are RBAC-scoped per role.

---

## Phase 4 — Frontend: Dashboard tab

### 4.1 `apps/web/src/hooks/useDashboard.ts`
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { DashboardView, DashboardViewCreate, ChartData, DashboardColumn } from '@tracker/shared';

export function useDashboardViews() {
  const query = useQuery({
    queryKey: ['dashboard', 'views'],
    queryFn: () => apiClient.get<DashboardView[]>('/api/dashboard/views'),
  });
  return { data: query.data, isLoading: query.isLoading, isError: query.isError, error: query.error };
}

export function useCreateDashboardView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DashboardViewCreate) => apiClient.post<{ id: string }>('/api/dashboard/views', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', 'views'] }),
  });
}

export function useDeleteDashboardView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.del<{ ok: boolean }>(`/api/dashboard/views/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', 'views'] }),
  });
}

export function useChartData(column: DashboardColumn) {
  const query = useQuery({
    queryKey: ['dashboard', 'chart-data', column],
    queryFn: () => apiClient.get<ChartData>(`/api/dashboard/chart-data?column=${column}`),
  });
  return { data: query.data, isLoading: query.isLoading, isError: query.isError, error: query.error };
}
```

### 4.2 Add a charting dependency
This app has no chart library yet. Add `recharts` to `apps/web/package.json` dependencies (small, well-typed, matches the library used elsewhere in this org's stack):
```json
"recharts": "^2.12.7"
```

### 4.3 `apps/web/src/components/dashboard/ChartCard.tsx`
A single view card: title, delete button, and either a `PieChart` or `BarChart` from `recharts` fed by `useChartData(view.column_key)`. Include a `<Legend />` for both chart types (explicit requirement: "along with the legend that indicates what is what"). Handle loading/empty states like other components in this codebase (`isLoading` → skeleton text, empty `labels` → "No data yet.").

### 4.4 `apps/web/src/components/dashboard/AddViewForm.tsx`
Small inline form (mirrors the "Add segment"/"Add user" forms in `SettingsPage.tsx`): a `<select>` for chart type (Pie/Bar), a `<select>` for column (human labels mapped from `DASHBOARD_COLUMNS`, e.g. `current_stage` → "Stage", `pic_id` → "PIC" — reuse/extend the label map already implicit in `columns.tsx`/`DiffView.tsx`'s `FIELD_LABELS`), a text input for the view's display label (default it to the column's human label on selection), and a submit button calling `useCreateDashboardView`.

### 4.5 `apps/web/src/app/dashboard/DashboardPage.tsx`
```tsx
export function DashboardPage() {
  const { data: views, isLoading } = useDashboardViews();
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <button onClick={() => setShowAdd((v) => !v)} className="...">Add view</button>
      </div>
      {showAdd && <AddViewForm onDone={() => setShowAdd(false)} />}
      {isLoading && <p className="text-sm text-gray-500">Loading views…</p>}
      {views && views.length === 0 && !isLoading && (
        <p className="text-sm text-gray-400">No views yet — add one to get started.</p>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {views?.map((v) => <ChartCard key={v.id} view={v} />)}
      </div>
    </div>
  );
}
```

### 4.6 Wire up routing & nav
- `apps/web/src/App.tsx`: add `<Route path="/dashboard" element={<DashboardPage />} />` inside the protected layout route (**no** `roles` restriction — every authenticated role gets a dashboard, since "the dashboard is unique to each user").
- `apps/web/src/components/AppLayout.tsx`: add a `NavLink to="/dashboard"` in the nav bar, visible to everyone (unlike Approvals/Settings which are gated by `canSeeApprovals`/`canManageSettings`).

**Checkpoint:** Log in as STAFF and SUPER_ADMIN in two sessions; confirm each sees only their own views, and that a "Stage" pie chart matches the counts visible in their own (RBAC-scoped) grid.

---

## Phase 5 — Frontend: Row edit modal

**Goal:** Hovering the project-name cell reveals a small edit icon; clicking opens a modal with every field of that row, editable, saved as a single PATCH.

### 5.1 New component `apps/web/src/components/data-grid/EditProjectModal.tsx`
- Props: `project: Project`, `users: AssignableUser[]`, `isAdmin: boolean`, `onClose: () => void`, `onSave: (id: string, changes: Record<string, unknown>) => Promise<EditResult>`.
- Internal state: a draft object initialized from `project`, one field per input, grouped into the same three sections used elsewhere (`Project info` / `Customer` / `Vendor` — reuse the `SECTION_OF` mapping idea from `DiffView.tsx`, factor it into a shared constant if convenient, e.g. move `FIELD_LABELS`/`SECTION_OF` into `packages/shared` or a new `apps/web/src/lib/projectFields.ts` so `DiffView.tsx`, `columns.tsx`, and the new modal all agree on labels).
- Field widgets reuse the same primitives as `ProjectTable.tsx`'s `EditableCell` (date/select/user/textarea/number/text). **Decision:** the modal **duplicates** the field rendering logic (does NOT extract a shared `FieldInput`), per the stakeholder decision recorded in the Implementation Notes at the end of this file.
- `Priority` and computed/system fields (`id`, `created_at`, `updated_at`, `drive_folder_id`, `staff_assigned_name`, `pic_name`) are rendered read-only or omitted entirely — never included in the diff sent on save.
- On Save: diff the draft against the original `project` (same "only send changed fields" approach as `submitUpdate` server-side, but computed client-side first so the network payload is minimal); call `onSave`; show the same "Saved." / "Change submitted for approval." toast messaging as the existing inline-edit flow; close on success, keep open with an inline error on failure.
- Modal shell: simple fixed-position overlay + centered panel (no new dependency needed — plain Tailwind, consistent with the rest of the app which doesn't use a headless-UI library). Escape key and backdrop click both close it. (Confirm-discard before closing is **deferred** — documented as a nice-to-have in the Implementation Notes.)

### 5.2 `apps/web/src/components/data-grid/ProjectTable.tsx`
- Add local state `editModalRow: Project | null`.
- In the sticky `project_name` cell's rendering branch, wrap the existing content in a `group relative` container and add:
```tsx
<button
  type="button"
  onClick={(e) => { e.stopPropagation(); setEditModalRow(row.original); }}
  className="ml-1 hidden shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 group-hover:inline-flex"
  aria-label={`Edit ${row.original.project_name}`}
  title="Edit project"
>
  {/* pencil icon svg, 14x14, matches existing inline-svg icon style used in NotificationBell.tsx */}
</button>
```
  (`group`/`group-hover` requires the parent cell `div` to add the `group` class — apply it only to the `project_name` cell's wrapper, not every cell, to keep the hover affordance scoped to that one column as described in the requirement: "an edit button that appears near the project name when you hover over it".)
- Render `{editModalRow && <EditProjectModal project={editModalRow} users={users} isAdmin={!!isAdmin} onClose={() => setEditModalRow(null)} onSave={...} />}` at the bottom of the component, wiring `onSave` to the same PATCH-and-refetch logic already passed in as `onCellUpdate`'s sibling — simplest is to accept a new prop `onRowUpdate` from `ProjectTableProps` that `GridPage.tsx` implements by calling `apiClient.patch('/api/projects/:id', changes)` with the full changes object (this is exactly what `handleCellUpdate` already does for a single field — generalize it to accept a `Record<string, unknown>` instead of one `field`/`value` pair, and have `handleCellUpdate` call it with a single-key object so there's one code path).

### 5.3 `apps/web/src/app/grid/GridPage.tsx`
Refactor `handleCellUpdate(row, field, value)` into `handleRowUpdate(row, changes: Record<string, unknown>)`, and have `handleCellUpdate` become a one-line wrapper: `handleRowUpdate(row, { [field]: value })`. Pass `onRowUpdate={handleRowUpdate}` to `ProjectTable`.

**Checkpoint:** Hovering the project name shows a pencil icon; clicking opens a modal pre-filled with the full row; editing several fields and saving results in exactly one PATCH request containing only the changed fields; STAFF gets the "submitted for approval" toast, SUPER_ADMIN gets "Saved." and sees the grid update immediately.

---

## Phase 6 — E2E tests (Playwright)

Add to `apps/web/e2e/`:

- **`dashboard.spec.ts`**
  - Admin creates a Pie view on "Stage", sees a rendered chart with a legend containing "on_progress" and "finish".
  - Staff creates a view and confirms it does not see the admin's view (separate login/session, assert view list only contains their own).
  - Deleting a view removes its card.
- **`edit-modal.spec.ts`**
  - Hovering `Admin Project A`'s name row reveals the edit button (`toBeVisible` after `hover()`).
  - Opening the modal, changing `customer_name` and `issues`, saving, and asserting the grid cell reflects the new values and a "Saved." toast appears.
  - As STAFF, editing an owned project via the modal results in "Change submitted for approval." and the row keeps its old values until approved (matches existing pending-edit UX in `notifications.spec.ts`).
- **`priority.spec.ts`**
  - As SUPER_ADMIN, update Low/Medium thresholds in Settings, navigate to the grid, and assert a known aging value's Priority badge changes label accordingly.
  - Assert STAFF cannot reach the aging-thresholds panel (route guard) and that a direct `PATCH /api/settings/aging-thresholds` as STAFF returns 403 (can be asserted via `page.request` if desired, or left as a server-only concern already covered by `requireRole`).

Update `playwright.config.ts`'s `testDir` glob is already `apps/web/e2e`, no config change needed — just add the new spec files.

---

## Phase 7 — Docs & cleanup

- Update `AGENT.md` (referenced in memory as the opencode agent-context file) with:
  - The new tables (`dashboard_views`, `aging_thresholds`) and why they're excluded from parquet export.
  - The rule that `priority` is **always derived**, never stored/submitted — anyone adding a new project field must not accidentally add `priority` to `projectUpdateSchema`.
  - The `DASHBOARD_COLUMNS` whitelist location and the requirement to update it in one place (`packages/shared`) if a new chartable column is added later.
- **Note:** The original Phase 7 cleanup items (sweeping commented-out `useToast` in `SettingsPage.tsx` and wiring real toasts) are **cancelled** — do NOT touch dead code. See Implementation Notes at the end of this file.

---

## Suggested delivery order for the agent

The phases are grouped into delivery batches as recorded in the Implementation Notes at the end of this file. Within Batch 1, the dependency order is:

1. Phase 0 (shared schema/migration) — must land first, everything else depends on it.
2. Phase 1 (thresholds settings) — needed before Priority can be computed.
3. Phase 2 (Priority column) — small, high-visibility, good validation checkpoint.
4. Phase 3 + 4 (dashboard backend + frontend) — largest net-new surface area, self-contained.
5. Phase 5 (edit modal) — touches shared grid code, do this after the grid/columns refactor lands cleanly in Phase 2.
6. Phase 6 (tests), Phase 7 (docs) — close out.

Each phase should be its own commit/PR so `npm run typecheck --workspaces` and the existing Playwright suite can gate progress before moving on.

---

# Implementation Notes (added during execution)

## Batching / Delivery Decisions

The work is executed in the following batches (each batch is one working session / PR):

- **Batch 1: Phases 0–2** — Shared schema & types, Aging Thresholds settings (backend + frontend), Priority column.
- **Batch 2: Phases 3–4** — Dashboard backend (CRUD + chart-data endpoint) and frontend (Dashboard tab, recharts).
- **Batch 3: Phase 5** — Row edit modal.
- **Batch 4: Phases 6–7** — E2E tests (Playwright) and docs.

## Confirmed Decisions (from stakeholder review)

1. **Charting library:** `recharts` (^2.12.7) is approved for the Dashboard feature (Phase 4.2).
2. **Row-edit modal field rendering (Phase 5.1):** The modal may **duplicate** the field-rendering logic instead of extracting a shared `FieldInput` component. This deviates from the Phase 5 original intent (extract shared component used by both inline grid editor and modal). The extraction is **not** required — modal duplicates field rendering for now. (This also voids the Phase 7 item about a shared `FieldInput`/field-metadata refactor.)
3. **Modal close confirm-discard (Phase 5.1):** Skipped for v1 — treated as a nice-to-have for later. No `beforeunload`/discard guard.
4. **`scopeClause` extraction (Phase 3.1):** Proceed with the extraction into a reusable `scopeClause(user)` helper in `projectsService.ts`, **with comments in the code documenting that the dashboard aggregation reuse is why the logic was extracted** (so the grid and dashboard can never diverge on STAFF row-scoping).
5. **Dead-code / commented-out cleanup (Phase 7):** **Do NOT** remove commented-out code. Only the new features are created. The Phase 7 bullet about sweeping `SettingsPage.tsx`'s commented-out `useToast` import and wiring real toasts is **cancelled** — leave the `alert(...)` fallbacks and dead comments in place.
6. **Phase 7 docs:** Update `AGENT.md` for the new tables / derived-priority rule / `DASHBOARD_COLUMNS` whitelist, but skip the toast cleanup portion.

## Batch 1 (Phases 0–2) — File-by-file execution checklist

### Phase 0 — Shared schema & types
- [ ] `packages/shared/src/thresholds.ts` — add `DEFAULT_AGING_LOW_MAX_DAYS = 15`, `DEFAULT_AGING_MEDIUM_MAX_DAYS = 30`.
- [ ] `packages/shared/src/lib/aging.ts` — append `PRIORITY_LEVELS`, `AgingThresholds` interface, `computePriority()`. Leave `computeAging` untouched.
- [ ] `packages/shared/src/schemas/agingThresholds.ts` — **new file** with `agingThresholdsSchema` (refined `medium > low`) + `AgingThresholdsInput`.
- [ ] `packages/shared/src/schemas/dashboardView.ts` — **new file** with `CHART_TYPES`, `DASHBOARD_COLUMNS`, `dashboardViewSchema`, `dashboardViewCreateSchema`, `chartDataSchema` + types.
- [ ] `packages/shared/src/index.ts` — add `export *` for both new schema files.
- [ ] `apps/server/src/db/migrate.ts` — add `dashboard_views` + `aging_thresholds` tables to `DDL`; add `seedAgingThresholds()` (single `'default'` row from shared constants) called from `migrate()` after `migrateColumns()`. No parquet export for these tables.
- [ ] **Checkpoint:** `npm run typecheck --workspaces` passes.

### Phase 1 — Aging thresholds (settings)
- [ ] `apps/server/src/modules/settings/settingsService.ts` — add `getAgingThresholds()` (falls back to defaults), `updateAgingThresholds(rawPayload, caller)` (validates via zod, `runWrite`, calls `invalidateAgingThresholdsCache()`). No `exportSnapshots`.
- [ ] `apps/server/src/modules/settings/agingThresholdsCache.ts` — **new file**: `resolveAgingThresholds()` (cached) + `invalidateAgingThresholdsCache()`.
- [ ] `apps/server/src/modules/settings/routes.ts` — add `GET /aging-thresholds` + `PATCH /aging-thresholds` (under existing admin gate).
- [ ] `apps/web/src/hooks/useSettings.ts` — add `useAgingThresholds()` + `useUpdateAgingThresholds()` (invalidates `['settings','aging-thresholds']` and `['projects']`).
- [ ] `apps/web/src/app/settings/SettingsPage.tsx` — add `AgingThresholdsPanel` below `MarketSegmentsPanel` (matching visual style, number inputs, save disabled unless `medium > low`, `alert()` error fallback as-is).
- [ ] **Checkpoint:** SUPER_ADMIN can edit thresholds; STAFF gets 403.

### Phase 2 — Priority column (derived, read-only)
- [ ] `packages/shared/src/schemas/project.ts` — add `priority` to `projectSchema` ONLY (not create/update schemas).
- [ ] `apps/server/src/modules/projects/projectsService.ts` — enrich `listProjects` rows with `priority` via `computePriority(computeAging(r), thresholds)`.
- [ ] `apps/web/src/components/data-grid/columns.tsx` — add `priorityColumn` (badge, green/amber/red), no `meta.editable`; insert after `agingColumn` in vendor group.
- [ ] **Checkpoint:** grid shows Priority badges; changing thresholds + refetch updates badges.
- [ ] Note: `pendingEditsService.ts` `fetchProject()` enrichment is optional for Batch 1 (priority is not a diffable field) — defer unless needed.

## Verification after Batch 1
1. `npm run typecheck --workspaces` passes.
2. Server boots; `dashboard_views` + `aging_thresholds` exist; `'default'` threshold row seeded.
3. `GET /api/settings/aging-thresholds` returns defaults; `PATCH` updates + invalidates cache.
4. Grid shows Priority badges; changing thresholds refreshes badges without reload.
5. Existing Playwright suite still green.

## Batch 3 (Phase 5) — File-by-file execution checklist

- [ ] `apps/web/src/lib/projectFields.ts` — **new file**: `EditType`, `FIELD_LABELS`, `SECTION_OF`, `SECTION_ORDER`, `NUMBER_FIELDS`, `FIELD_TYPES`, `FIELD_SELECT_OPTIONS` (shared by DiffView + edit modal).
- [ ] `apps/web/src/components/approvals/DiffView.tsx` — move local `FIELD_LABELS`/`SECTION_OF`/`SECTION_ORDER` to import from `lib/projectFields.ts` (no behavior change).
- [ ] `apps/web/src/components/data-grid/EditProjectModal.tsx` — **new file**: full-row editor, draft diffed against the original row client-side so only changed fields are PATCHed. Duplicates field rendering per decision #2. Read-only badges show Priority + Drive folder; `staff_assigned_id` hidden for non-admins; system fields never sent. Escape/backdrop close (no confirm-discard, per decision #3); "Saved." / "Change submitted for approval." toast on success, inline error keeps the modal open.
- [ ] `apps/web/src/components/data-grid/ProjectTable.tsx` — `onCellUpdate` → `onRowUpdate(row, Record<string, unknown>)`; pencil button (feather edit-2, 14×14) revealed via `group-hover` on the `project_name` cell; renders `EditProjectModal` at the bottom.
- [ ] `apps/web/src/app/grid/GridPage.tsx` — `handleCellUpdate(row, field, value)` → `handleRowUpdate(row, changes)` (single PATCH with changed fields only); `onCellUpdate` → `onRowUpdate`. Inline edits now go through the same path with a single-key object.
- [ ] **Checkpoint:** hovering a project name shows the pencil; the modal pre-fills the full row; multi-field save results in one PATCH with only changed fields; STAFF sees the approval toast and unchanged grid until approved, SUPER_ADMIN sees "Saved." and instant grid refresh.

## Batch 3 (Phase 5) — Verification results

- `npm run typecheck -w @tracker/web` — clean except the 3 known pre-existing TS6133 errors (`ColumnGroupHeader.tsx` `headerWidth`, `columns.tsx` `statusColumn`/`pendingColumn`); **no new errors**.
- `npx vite build` (bypassing the `tsc` gate that the pre-existing errors block) — succeeds; bundle 831.9 kB (recharts adds weight; chunk-size warning is informational).
- No shared/server changes in Batch 3, so those typechecks are unaffected.

## Batch 4 (Phase 6–7) — File-by-file execution checklist

- [ ] `apps/web/e2e/dashboard.spec.ts` — **new file**: admin creates a Stage pie view (unique label) and asserts the legend shows `on_progress` + `finish`, then deletes it; staff creates their own view and asserts a per-run-unique admin label is never visible (per-user view isolation).
- [ ] `apps/web/e2e/edit-modal.spec.ts` — **new file**: hovering a project name reveals the pencil; admin edits `customer_name` + `issues` in one modal save → "Saved." + grid reflects both; STAFF modal save → "Change submitted for approval." + row unchanged; `staff_assigned_id` is not rendered in the modal for STAFF.
- [ ] `apps/web/e2e/priority.spec.ts` — **new file**: admin sets Staff Project A's `project_sent_date` to 30 calendar days ago (~20–22 business days) → Medium badge with defaults; changing thresholds (5/8 → High, 60/120 → Low) via the Settings panel flips the badge; restores 15/30 and clears the sent date; staff route-guard redirects `/settings` → `/grid` and a direct `PATCH /api/settings/aging-thresholds` with a valid staff token returns 403.
- [ ] `AGENTS.md` — Data Model: added `notifications`, `dashboard_views`, `aging_thresholds`; note that the latter two are operational/config data never exported to parquet; new "Always-Derived Fields" section (`priority` derived-never-stored, `DASHBOARD_COLUMNS` single-whitelist location); REST API surface + modules list updated. NO toast/dead-code cleanup (cancelled per decision #5).

## Batch 4 — Verification results

- `npx playwright test --list` — all 17 tests load (7 new across 3 files + 10 existing across 2 files). Specs are not typechecked by the web workspace tsconfig (`include: ["src", "vite.config.ts"]`), so runtime is the real gate.
- Full run **not yet executed** — needs `_rbac_setup.ts` (destructive: wipes `projects`/`pending_edits`/`sessions` + staff user) which would destroy the manual DB rows the user created since (`john@example.com`, `HII`, `test 5`, `test proposal`). Requires user confirmation first.

## Batch 4 — Known issues to inform the user about

1. **Live DB is out of sync with the e2e fixture.** The current `apps/server/data/app.duckdb` contains manual dev data (`john@example.com` STAFF; projects `HII`, `test 5`, `test proposal`) and is missing the fixture rows the existing + new Playwright specs expect (`staff1@example.com`/`staff12345`, `Admin Project A/B`, `Staff Project A/B`). The existing `grid.spec.ts`/`notifications.spec.ts` would fail too, already, against the current DB. The tracked `apps/server/_rbac_setup.ts` re-creates the fixture but **deletes** the manual rows.
2. **Cross-file pending-edit interplay (pre-existing fragility).** `notifications.spec.ts` exact-badges `toHaveText('1')`; the new `edit-modal.spec.ts` staff test also submits a pending edit. If both files run in parallel workers, the notification badge test can flake. Not fixed (out of scope); flagging as a follow-up if the suite runs in CI.
3. **Time-robust aging math used in priority.spec.ts** — 30 calendar days back ≈ 20–22 business days (networkDays), which stays inside (15, 30] for the default Medium assertion regardless of the week/date the suite runs.
