import { runRead, runWrite } from '../../db/connection.js';
import { uuid } from '../../lib/uuid.js';
import { scopeClause } from '../projects/projectsService.js';
import { resolveAgingThresholds } from '../settings/agingThresholdsCache.js';
import {
  computeAging,
  computePriority,
  DASHBOARD_COLUMNS,
  DASHBOARD_METRICS,
  DASHBOARD_STAGE_FILTERS,
  PROJECT_LEVEL_METRICS,
  VENDOR_BASED_COLUMNS,
} from '@tracker/shared';
import type { AuthUser } from '../../middleware/requireAuth.js';
import type {
  DashboardView,
  DashboardViewCreate,
  DashboardViewUpdate,
  ChartData,
  DashboardColumn,
  DashboardMetric,
  DashboardStageFilter,
  DrillDownResult,
} from '@tracker/shared';

export class DashboardError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'DashboardError';
  }
}

interface DashboardViewRow extends DashboardView {
  [key: string]: unknown;
}

// Per-view filter context shared by every chart / drill-down branch.
export interface ChartFilters {
  metricKey: DashboardMetric;
  stageFilter: DashboardStageFilter;
  yearFilter: number | null;
}

export async function listViews(userId: string): Promise<DashboardView[]> {
  const rows = await runRead<DashboardViewRow>(
    `SELECT * FROM dashboard_views WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    chart_type: r.chart_type,
    column_key: r.column_key,
    metric_key: r.metric_key,
    stage_filter: r.stage_filter,
    year_filter: r.year_filter ?? null,
    label: r.label,
    sort_order: r.sort_order,
    created_at: r.created_at,
  }));
}

export async function createView(user: AuthUser, payload: DashboardViewCreate): Promise<{ id: string }> {
  const id = uuid();
  await runWrite(async (ex) => {
    const [{ maxOrder } = { maxOrder: 0 }] = await ex<{ maxOrder: number }>(
      `SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM dashboard_views WHERE user_id = ?`,
      [user.id],
    );
    await ex(
      `INSERT INTO dashboard_views (id, user_id, chart_type, column_key, metric_key, stage_filter, year_filter, label, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)`,
      [
        id,
        user.id,
        payload.chart_type,
        payload.column_key,
        payload.metric_key,
        payload.stage_filter,
        payload.year_filter ?? null,
        payload.label,
        (maxOrder ?? 0) + 1,
      ],
    );
  });
  return { id };
}

export async function updateView(user: AuthUser, viewId: string, payload: DashboardViewUpdate): Promise<void> {
  // Whitelist of editable fields — a view's chart_type / column_key stay fixed
  // once created (only the label + filters/metric are editable).
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of ['label', 'metric_key', 'stage_filter', 'year_filter'] as const) {
    if (payload[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(payload[key] ?? null);
    }
  }
  if (sets.length === 0) return;

  await runWrite(async (ex) => {
    // Ownership check baked into the WHERE clause — a user can only ever
    // update their own view.
    await ex(`UPDATE dashboard_views SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [
      ...values,
      viewId,
      user.id,
    ]);
  });
}

export async function deleteView(user: AuthUser, viewId: string): Promise<void> {
  await runWrite(async (ex) => {
    // Ownership check baked into the WHERE clause — a user can only ever
    // delete their own view.
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
  vendor_price?: number | null;
  vendor_revenue?: number | null;
  label?: string;
  [key: string]: unknown;
}

// Rows returned by the drill-down queries. For the vendor-based columns the
// priority / vendor_type live on project_vendors, so rows are per vendor LINE
// (a project may appear once per matching line). project_sent_date /
// approval_date on the vendor line are the aging inputs for priority.
interface DrillDownRow {
  id: string;
  project_name: string;
  vendor_name: string | null;
  project_sent_date?: string | null;
  approval_date?: string | null;
  [key: string]: unknown;
}

/**
 * Compose the per-view stage/year filters on top of the RBAC scope clause.
 * Uses the SAME creation-year semantics as the grid: projects created in
 * [year-01-01, year+1-01-01). All conditions reference the `p` alias so they
 * compose cleanly with the scope clause in every branch.
 */
function applyChartFilters(
  scope: { whereClause: string; params: unknown[] },
  filters: ChartFilters,
): { whereClause: string; params: unknown[] } {
  let { whereClause } = scope;
  const params = [...scope.params];
  if (filters.stageFilter !== 'all') {
    whereClause = whereClause ? `${whereClause} AND p.current_stage = ?` : `WHERE p.current_stage = ?`;
    params.push(filters.stageFilter);
  }
  if (filters.yearFilter != null) {
    const start = `${filters.yearFilter}-01-01`;
    const end = `${filters.yearFilter + 1}-01-01`;
    whereClause = whereClause ? `${whereClause} AND p.created_at >= ? AND p.created_at < ?` : `WHERE p.created_at >= ? AND p.created_at < ?`;
    params.push(start, end);
  }
  return { whereClause, params };
}

function validateMetric(metricKey: DashboardMetric): void {
  if (!DASHBOARD_METRICS.includes(metricKey)) {
    throw new DashboardError('Unsupported metric', 400);
  }
}

// Display label expression for a grouping column, identical to the drill-down /
// count paths: user columns use the joined display name, vendor_type comes off
// the vendor line, everything else folds NULLs to 'Unset'.
function labelExpr(columnKey: DashboardColumn): { expr: string; join: string } {
  if (columnKey === 'staff_assigned_id' || columnKey === 'pic_id') {
    return { expr: `COALESCE(u.name, 'Unassigned')`, join: `LEFT JOIN users u ON u.id = p.${columnKey}` };
  }
  if (columnKey === 'vendor_type') {
    return { expr: `COALESCE(pv.vendor_type::VARCHAR, 'Unset')`, join: '' };
  }
  return { expr: `COALESCE(p.${columnKey}::VARCHAR, 'Unset')`, join: '' };
}

/**
 * Groups & aggregates rows for one column, applying the SAME RBAC scoping as
 * the grid (scopeClause) plus the view's stage/year filters, so a STAFF user's
 * charts only ever reflect the projects they own.
 *
 * vendor_type and priority are VENDOR-BASED (planning_customers_vendors §3.3):
 * they aggregate over project_vendors lines joined to the scoped projects, not
 * over the projects table — a project contributes once per vendor line.
 * customer_price is a PROJECT-level figure and is rejected for those two
 * groupings (a multi-vendor project would otherwise be counted in several
 * buckets). avg_aging is derived per line in JS (aging is never stored).
 */
export async function getChartData(
  user: AuthUser,
  columnKey: DashboardColumn,
  filters: ChartFilters,
): Promise<ChartData> {
  if (!DASHBOARD_COLUMNS.includes(columnKey)) {
    throw new DashboardError('Unsupported column', 400);
  }
  if (!DASHBOARD_STAGE_FILTERS.includes(filters.stageFilter)) {
    throw new DashboardError('Unsupported stage filter', 400);
  }
  validateMetric(filters.metricKey);

  if (VENDOR_BASED_COLUMNS.has(columnKey) && PROJECT_LEVEL_METRICS.has(filters.metricKey)) {
    throw new DashboardError('Sum of customer price is not available for priority / vendor-type groupings', 400);
  }

  const scoped = applyChartFilters(scopeClause(user), filters);

  if (columnKey === 'priority') {
    return aggregateByPriority(scoped, filters.metricKey);
  }
  if (filters.metricKey === 'count') {
    return countChart(columnKey, scoped);
  }
  if (filters.metricKey === 'customer_price') {
    return customerPriceChart(columnKey, scoped);
  }
  return lineMetricChart(columnKey, scoped, filters.metricKey);
}

/** COUNT(*) per group — the original chart. vendor_type counts vendor lines. */
async function countChart(
  columnKey: DashboardColumn,
  scoped: { whereClause: string; params: unknown[] },
): Promise<ChartData> {
  const isVendorBased = columnKey === 'vendor_type';
  const { expr, join } = labelExpr(columnKey);
  const fromClause = isVendorBased ? `FROM project_vendors pv JOIN projects p ON p.id = pv.project_id` : `FROM projects p`;

  const rows = await runRead<{ label: string; cnt: number | bigint }>(
    `SELECT ${expr} AS label, COUNT(*) AS cnt
     ${fromClause} ${join} ${scoped.whereClause}
     GROUP BY label
     ORDER BY cnt DESC`,
    scoped.params,
  );
  return { labels: rows.map((r) => r.label), values: rows.map((r) => Number(r.cnt)) };
}

/** SUM(p.customer_price) per group — only for project-based groupings. */
async function customerPriceChart(
  columnKey: DashboardColumn,
  scoped: { whereClause: string; params: unknown[] },
): Promise<ChartData> {
  const { expr, join } = labelExpr(columnKey);
  const rows = await runRead<{ label: string; sum: number | bigint | null }>(
    `SELECT ${expr} AS label, SUM(p.customer_price) AS sum
     FROM projects p ${join} ${scoped.whereClause}
     GROUP BY label
     ORDER BY sum DESC`,
    scoped.params,
  );
  return {
    labels: rows.map((r) => r.label),
    values: rows.map((r) => Number(r.sum ?? 0)),
  };
}

interface LineAgg {
  count: number;
  sum: number;
  agingSum: number;
  agingCount: number;
}

/** Sum of vendor_price / vendor_revenue, or average aging, per group (line-based). */
async function lineMetricChart(
  columnKey: DashboardColumn,
  scoped: { whereClause: string; params: unknown[] },
  metricKey: DashboardMetric,
): Promise<ChartData> {
  const { expr, join } = labelExpr(columnKey);
  const rows = await runRead<ProjectGroupRow>(
    `SELECT ${expr} AS label, pv.project_sent_date, pv.approval_date, pv.vendor_price, pv.vendor_revenue
     FROM project_vendors pv JOIN projects p ON p.id = pv.project_id ${join} ${scoped.whereClause}`,
    scoped.params,
  );

  const groups = new Map<string, LineAgg>();
  for (const r of rows) {
    const label = r.label ?? 'Unset';
    const g = groups.get(label) ?? { count: 0, sum: 0, agingSum: 0, agingCount: 0 };
    g.count++;
    if (metricKey === 'vendor_price' && r.vendor_price != null) g.sum += Number(r.vendor_price);
    else if (metricKey === 'vendor_revenue' && r.vendor_revenue != null) g.sum += Number(r.vendor_revenue);
    const aging = computeAging(r);
    if (aging != null) {
      g.agingSum += aging;
      g.agingCount++;
    }
    groups.set(label, g);
  }

  const entries = [...groups.entries()].map(([label, g]) => {
    const value =
      metricKey === 'avg_aging'
        ? g.agingCount > 0
          ? Math.round((g.agingSum / g.agingCount) * 100) / 100
          : 0
        : g.sum;
    return { label, value, present: g.count > 0 && (metricKey === 'avg_aging' ? g.agingCount > 0 : true) };
  });

  const visible = entries
    .filter((e) => e.present)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  return { labels: visible.map((e) => e.label), values: visible.map((e) => e.value) };
}

/**
 * Priority is derived per vendor line (never stored), so it can't be
 * aggregated with SQL — fetch the aging inputs + metric inputs and compute in
 * JS, identical to the grid's per-line priority.
 */
async function aggregateByPriority(
  scoped: { whereClause: string; params: unknown[] },
  metricKey: DashboardMetric,
): Promise<ChartData> {
  const thresholds = await resolveAgingThresholds();
  const rows = await runRead<ProjectGroupRow>(
    `SELECT pv.project_sent_date, pv.approval_date, pv.vendor_price, pv.vendor_revenue
     FROM project_vendors pv JOIN projects p ON p.id = pv.project_id ${scoped.whereClause}`,
    scoped.params,
  );

  const buckets = new Map<'low' | 'medium' | 'high', LineAgg>();
  for (const r of rows) {
    const priority = computePriority(computeAging(r), thresholds);
    if (!priority) continue;
    const g = buckets.get(priority) ?? { count: 0, sum: 0, agingSum: 0, agingCount: 0 };
    g.count++;
    if (metricKey === 'vendor_price' && r.vendor_price != null) g.sum += Number(r.vendor_price);
    else if (metricKey === 'vendor_revenue' && r.vendor_revenue != null) g.sum += Number(r.vendor_revenue);
    const aging = computeAging(r);
    if (aging != null) {
      g.agingSum += aging;
      g.agingCount++;
    }
    buckets.set(priority, g);
  }

  const labels = (['low', 'medium', 'high'] as const).filter((k) => {
    const g = buckets.get(k);
    if (!g || g.count === 0) return false;
    if (metricKey === 'avg_aging') return g.agingCount > 0;
    return true;
  });
  return {
    labels: labels.map((l) => l[0].toUpperCase() + l.slice(1)),
    values: labels.map((k) => {
      const g = buckets.get(k)!;
      if (metricKey === 'avg_aging') return Math.round((g.agingSum / g.agingCount) * 100) / 100;
      return metricKey === 'count' ? g.count : g.sum;
    }),
  };
}

/**
 * Returns the RBAC-scoped projects that fall under one chart slice/segment,
 * so clicking "Low" on a Priority pie or "Enterprise" on a market-segment bar
 * lists exactly the projects that slice counted. Applies the view's stage and
 * year filters too, so the drill-down never diverges from the chart. Must
 * reuse scopeClause so the drill-down can never diverge from the grid/chart
 * over what a STAFF user is allowed to see.
 *
 * For vendor-based columns (vendor_type / priority) one entry is returned per
 * matching vendor LINE with its vendor_name filled in; a project can appear
 * more than once. All other columns return one entry per project.
 */
export async function getDrillDown(
  user: AuthUser,
  columnKey: DashboardColumn,
  value: string,
  filters: ChartFilters,
): Promise<DrillDownResult> {
  if (!DASHBOARD_COLUMNS.includes(columnKey)) {
    throw new DashboardError('Unsupported column', 400);
  }
  if (!DASHBOARD_STAGE_FILTERS.includes(filters.stageFilter)) {
    throw new DashboardError('Unsupported stage filter', 400);
  }
  const scoped = applyChartFilters(scopeClause(user), filters);

  if (columnKey === 'priority') {
    // Derived per vendor line (never stored), so it can't be matched in SQL —
    // fetch the aging inputs for the scoped lines and compute the priority in
    // JS, identical to aggregateByPriority. Chart labels are capitalized
    // (Low/Medium/High) while computePriority returns lowercase, so match on
    // value.toLowerCase().
    const thresholds = await resolveAgingThresholds();
    const rows = await runRead<DrillDownRow>(
      `SELECT p.id, p.project_name, v.name AS vendor_name, pv.project_sent_date, pv.approval_date
       FROM project_vendors pv
       JOIN projects p ON p.id = pv.project_id
       LEFT JOIN vendors v ON v.id = pv.vendor_id
       ${scoped.whereClause}`,
      scoped.params,
    );
    const target = value.toLowerCase();
    return {
      projects: rows
        .filter((r) => computePriority(computeAging(r), thresholds) === target)
        .sort((a, b) => a.project_name.localeCompare(b.project_name) || (a.vendor_name ?? '').localeCompare(b.vendor_name ?? ''))
        .map((r) => ({ id: r.id, project_name: r.project_name, vendor_name: r.vendor_name ?? null })),
    };
  }

  // Match on the SAME derived label the chart produced, or clicking
  // "Unassigned" / "Unset" would return nothing.
  const isVendorBased = columnKey === 'vendor_type';
  const { expr, join } = labelExpr(columnKey);
  const criteria = `${expr} = ?`;
  const fromClause = isVendorBased
    ? `FROM project_vendors pv JOIN projects p ON p.id = pv.project_id LEFT JOIN vendors v ON v.id = pv.vendor_id`
    : `FROM projects p`;
  const whereFull = scoped.whereClause ? `${scoped.whereClause} AND ${criteria}` : `WHERE ${criteria}`;

  const vendorNameExpr = isVendorBased ? `v.name AS vendor_name` : `NULL AS vendor_name`;
  const rows = await runRead<DrillDownRow>(
    `SELECT p.id, p.project_name, ${vendorNameExpr}
     ${fromClause} ${join} ${whereFull}
     ORDER BY p.project_name ASC`,
    [...scoped.params, value],
  );

  const projects = isVendorBased
    ? rows
    : rows.map((r) => ({ id: r.id, project_name: r.project_name, vendor_name: null }));

  return { projects };
}