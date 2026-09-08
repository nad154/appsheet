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

/**
 * Groups & counts rows for one column, applying the SAME RBAC scoping as the
 * grid (scopeClause), so a STAFF user's charts only ever reflect the projects
 * they own.
 */
export async function getChartData(user: AuthUser, columnKey: DashboardColumn): Promise<ChartData> {
  if (!DASHBOARD_COLUMNS.includes(columnKey)) {
    throw new DashboardError('Unsupported column', 400);
  }
  const { whereClause, params } = scopeClause(user);

  // Priority is derived (not stored), so it can't be aggregated with SQL —
  // fetch the aging inputs and compute the counts in JS, identical to the grid.
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

  // columnKey is validated against the DASHBOARD_COLUMNS whitelist above —
  // never accept an arbitrary client-supplied column name into SQL here.
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