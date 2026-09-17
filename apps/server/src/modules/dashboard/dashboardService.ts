import { runRead, runWrite } from '../../db/connection.js';
import { uuid } from '../../lib/uuid.js';
import { scopeClause } from '../projects/projectsService.js';
import { resolveAgingThresholds } from '../settings/agingThresholdsCache.js';
import { computeAging, computePriority, DASHBOARD_COLUMNS } from '@tracker/shared';
import type { AuthUser } from '../../middleware/requireAuth.js';
import type {
  DashboardView,
  DashboardViewCreate,
  ChartData,
  DashboardColumn,
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

const VENDOR_BASED_COLUMNS = new Set<DashboardColumn>(['priority', 'vendor_type']);

/**
 * Groups & counts rows for one column, applying the SAME RBAC scoping as the
 * grid (scopeClause), so a STAFF user's charts only ever reflect the projects
 * they own.
 *
 * vendor_type and priority are VENDOR-BASED (planning_customers_vendors §3.3):
 * they aggregate over project_vendors lines joined to the scoped projects, not
 * over the projects table — a project contributes once per vendor line.
 */
export async function getChartData(user: AuthUser, columnKey: DashboardColumn): Promise<ChartData> {
  if (!DASHBOARD_COLUMNS.includes(columnKey)) {
    throw new DashboardError('Unsupported column', 400);
  }
  const { whereClause, params } = scopeClause(user);

  if (columnKey === 'priority') {
    // Derived per vendor line (never stored), so it can't be aggregated with
    // SQL — fetch the aging inputs and compute the counts in JS, identical to
    // the grid's per-line priority.
    const thresholds = await resolveAgingThresholds();
    const rows = await runRead<ProjectGroupRow>(
      `SELECT pv.project_sent_date, pv.approval_date
       FROM project_vendors pv JOIN projects p ON p.id = pv.project_id ${whereClause}`,
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

  // columnKey is validated against the DASHBOARD_COLUMNS whitelist above —
  // never accept an arbitrary client-supplied column name into SQL here.
  const isUserColumn = columnKey === 'staff_assigned_id' || columnKey === 'pic_id';
  const isVendorBased = columnKey === 'vendor_type';
  const fromClause = isVendorBased
    ? `FROM project_vendors pv JOIN projects p ON p.id = pv.project_id`
    : `FROM projects p`;
  const selectExpr = isUserColumn
    ? `COALESCE(u.name, 'Unassigned') AS label`
    : isVendorBased
      ? `COALESCE(pv.vendor_type::VARCHAR, 'Unset') AS label`
      : `COALESCE(p.${columnKey}::VARCHAR, 'Unset') AS label`;
  const joinClause = isUserColumn ? `LEFT JOIN users u ON u.id = p.${columnKey}` : '';

  const rows = await runRead<{ label: string; cnt: number | bigint }>(
    `SELECT ${selectExpr}, COUNT(*) AS cnt
     ${fromClause} ${joinClause} ${whereClause}
     GROUP BY label
     ORDER BY cnt DESC`,
    params,
  );
  return { labels: rows.map((r) => r.label), values: rows.map((r) => Number(r.cnt)) };
}

/**
 * Returns the RBAC-scoped projects that fall under one chart slice/segment,
 * so clicking "Low" on a Priority pie or "Enterprise" on a market-segment bar
 * lists exactly the projects that slice counted. Must reuse scopeClause so
 * the drill-down can never diverge from the grid/chart over what a STAFF user
 * is allowed to see.
 *
 * For vendor-based columns (vendor_type / priority) one entry is returned per
 * matching vendor LINE with its vendor_name filled in; a project can appear
 * more than once. All other columns return one entry per project.
 */
export async function getDrillDown(
  user: AuthUser,
  columnKey: DashboardColumn,
  value: string,
): Promise<DrillDownResult> {
  if (!DASHBOARD_COLUMNS.includes(columnKey)) {
    throw new DashboardError('Unsupported column', 400);
  }
  const { whereClause, params } = scopeClause(user);

  if (columnKey === 'priority') {
    // Derived per vendor line (never stored), so it can't be matched in SQL —
    // fetch the aging inputs for the scoped lines and compute the priority in
    // JS, identical to getChartData's priority branch. Chart labels are
    // capitalized (Low/Medium/High) while computePriority returns lowercase,
    // so match on value.toLowerCase().
    const thresholds = await resolveAgingThresholds();
    const rows = await runRead<DrillDownRow>(
      `SELECT p.id, p.project_name, v.name AS vendor_name, pv.project_sent_date, pv.approval_date
       FROM project_vendors pv
       JOIN projects p ON p.id = pv.project_id
       LEFT JOIN vendors v ON v.id = pv.vendor_id
       ${whereClause}`,
      params,
    );
    const target = value.toLowerCase();
    return {
      projects: rows
        .filter((r) => computePriority(computeAging(r), thresholds) === target)
        .sort((a, b) => a.project_name.localeCompare(b.project_name) || (a.vendor_name ?? '').localeCompare(b.vendor_name ?? ''))
        .map((r) => ({ id: r.id, project_name: r.project_name, vendor_name: r.vendor_name ?? null })),
    };
  }

  // User columns group by the joined display name; plain columns group by the
  // raw value with NULLs folded to 'Unset'. Match on the SAME derived label
  // getChartData produced, or clicking "Unassigned" / "Unset" would return
  // nothing. Vendor-type is groupable in SQL (it lives on the vendor line).
  const isUserColumn = columnKey === 'staff_assigned_id' || columnKey === 'pic_id';
  const isVendorBased = columnKey === 'vendor_type';
  const criteria = isUserColumn
    ? `COALESCE(u.name, 'Unassigned') = ?`
    : isVendorBased
      ? `COALESCE(pv.vendor_type::VARCHAR, 'Unset') = ?`
      : `COALESCE(p.${columnKey}::VARCHAR, 'Unset') = ?`;
  const fromClause = isVendorBased
    ? `FROM project_vendors pv JOIN projects p ON p.id = pv.project_id LEFT JOIN vendors v ON v.id = pv.vendor_id`
    : `FROM projects p`;
  const joinClause = isUserColumn ? `LEFT JOIN users u ON u.id = p.${columnKey}` : '';
  const whereFull = whereClause ? `${whereClause} AND ${criteria}` : `WHERE ${criteria}`;

  const vendorNameExpr = isVendorBased
    ? `v.name AS vendor_name`
    : `NULL AS vendor_name`;
  const rows = await runRead<DrillDownRow>(
    `SELECT p.id, p.project_name, ${vendorNameExpr}
     ${fromClause} ${joinClause} ${whereFull}
     ORDER BY p.project_name ASC`,
    [...params, value],
  );

  const projects = isVendorBased
    ? rows
    : rows.map((r) => ({ id: r.id, project_name: r.project_name, vendor_name: null }));

  return { projects };
}