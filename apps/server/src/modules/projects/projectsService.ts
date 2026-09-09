import { runRead } from '../../db/connection.js';
import { resolveAgingThresholds } from '../settings/agingThresholdsCache.js';
import type { AuthUser } from '../../middleware/requireAuth.js';
import { computeAging, computePriority } from '@tracker/shared';
import type { Project, ProjectList } from '@tracker/shared';

interface ProjectRow extends Project {
  [key: string]: unknown;
}

// Whitelist of sortable columns: each allowed client-provided sort key maps to
// the exact SQL ORDER BY expression to use. Never interpolate caller-provided
// column names into SQL directly — only these keys are allowed.
//
// The Sales and PIC columns sort by their JOINed display names: the grid sends
// `pic_name` and `staff_assigned_id` as sort keys, and they order by
// `pic_user.name` / `u.name` (the display names), never by the stored user
// UUID.
//
// `aging` and `priority` are NOT in this map: they are derived per request
// (aging from project dates against today, priority from aging + the current
// aging thresholds) and listProjects handles them as in-memory sorts rather
// than SQL ORDER BY expressions.
const SORTABLE_COLUMNS: Record<string, string> = {
  project_name: 'project_name',
  customer_name: 'customer_name',
  vendor_name: 'vendor_name',
  customer_price: 'customer_price',
  vendor_price: 'vendor_price',
  customer_end_contract: 'customer_end_contract',
  vendor_end_contract: 'vendor_end_contract',
  current_stage: 'current_stage',
  updated_at: 'updated_at',
  created_at: 'created_at',
  pic_name: 'pic_user.name',
  staff_assigned_id: 'u.name',
};

// The joined-name sort keys order by a LEFT-JOINed user name, which is NULL
// when no PIC/Sales is assigned to a project. Append NULLS LAST so unassigned
// rows always sink to the end, matching the nulls-last behavior of the
// in-memory derived sorts above.
const NULLS_LAST_SORT_KEYS = new Set(['pic_name', 'staff_assigned_id']);

// Rank used for in-memory priority ordering. Null priority (no aging) always
// sorts last regardless of direction, so rows without aging never crowd out
// actionable projects.
const PRIORITY_RANK: Record<NonNullable<Project['priority']>, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

type DerivedSortKey = 'aging' | 'priority';

/**
 * In-memory comparator for the derived (non-SQL) sort keys. Values are
 * computed per row; null values sort last in both directions.
 */
function compareDerived(
  a: ProjectRow,
  b: ProjectRow,
  key: DerivedSortKey,
  dir: 'ASC' | 'DESC',
): number {
  const sign = dir === 'ASC' ? 1 : -1;
  const aVal = key === 'aging' ? computeAging(a) : (a.priority ? PRIORITY_RANK[a.priority] : null);
  const bVal = key === 'aging' ? computeAging(b) : (b.priority ? PRIORITY_RANK[b.priority] : null);

  if (aVal === null && bVal === null) return 0;
  if (aVal === null) return 1; // nulls last
  if (bVal === null) return -1;
  return (aVal - bVal) * sign;
}

export interface ProjectListQuery {
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
}

/**
 * RBAC row-scoping shared by the projects grid AND the dashboard aggregation
 * (dashboardService.getChartData), so the two can never diverge over what a
 * STAFF user is allowed to see.
 *
 * NOTE: this was extracted out of listProjects when the dashboard chart-data
 * endpoint was added (planning_ex9 Phase 3.1) — the dashboard groups over the
 * SAME scoped rows as the grid. Keep it as the single source of truth for
 * row-level scoping.
 */
export function scopeClause(user: AuthUser): { whereClause: string; params: unknown[] } {
  if (user.role === 'STAFF') return { whereClause: 'WHERE p.staff_assigned_id = ?', params: [user.id] };
  return { whereClause: '', params: [] };
}

/**
 * List projects with server-side RBAC filtering. STAFF only ever sees the
 * projects assigned to them — the WHERE clause is injected server-side from the
 * authenticated user, never from a client-supplied filter. Pagination and sort
 * use a whitelisted set of columns.
 */
export async function listProjects(user: AuthUser, query: ProjectListQuery): Promise<ProjectList> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, query.page_size ?? 50));
  const sortKey = query.sort_by ?? '';
  const sortDir = query.sort_dir === 'asc' ? 'ASC' : 'DESC';
  const offset = (page - 1) * pageSize;

  const { whereClause, params } = scopeClause(user);
  const thresholds = await resolveAgingThresholds();

  // Attach the derived Priority to each row (from Aging + the current
  // thresholds). Priority is never persisted — computed per request so it
  // always tracks the latest admin-configured aging thresholds.
  const enrich = (rows: ProjectRow[]) =>
    rows.map((r) => ({
      ...r,
      priority: computePriority(computeAging(r), thresholds),
    }));

  let rows: ProjectRow[];
  if (sortKey === 'aging' || sortKey === 'priority') {
    // Derived keys can't be expressed in SQL ORDER BY. The scoped result set
    // is small (≤500 rows), so fetch it whole, sort in memory, then paginate.
    const all = await runRead<ProjectRow>(
      `SELECT p.*, u.name AS staff_assigned_name, pic_user.name AS pic_name
      FROM projects p LEFT JOIN users u ON u.id = p.staff_assigned_id
       LEFT JOIN users pic_user ON pic_user.id = p.pic_id
       ${whereClause}`,
      params,
    );
    rows = enrich(all)
      .sort((a, b) => compareDerived(a, b, sortKey, sortDir))
      .slice(offset, offset + pageSize);
  } else {
    // Real-column keys ORDER BY themselves; the two joined-name keys resolve to
    // the mapped expressions above and pin NULL (unassigned) rows last.
    const sortExpr = SORTABLE_COLUMNS[sortKey] ?? 'updated_at';
    const nullsLast = NULLS_LAST_SORT_KEYS.has(sortKey) ? ' NULLS LAST' : '';
    rows = await runRead<ProjectRow>(
      `SELECT p.*, u.name AS staff_assigned_name, pic_user.name AS pic_name
      FROM projects p LEFT JOIN users u ON u.id = p.staff_assigned_id
       LEFT JOIN users pic_user ON pic_user.id = p.pic_id
       ${whereClause}
       ORDER BY ${sortExpr} ${sortDir}${nullsLast}
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
  }

  const countRows = await runRead<{ total: number }>(
    `SELECT count(*) AS total FROM projects p ${whereClause}`,
    params,
  );
  const total = Number(countRows[0]?.total ?? 0);

  return { rows: enrich(rows), total, page, page_size: pageSize };
}

// Active users that may be assigned as a project's PIC. The settings users
// endpoints are SUPER_ADMIN-only; the grid needs this for both roles.
export async function listAssignableUsers(): Promise<{ id: string; name: string }[]> {
  return runRead<{ id: string; name: string }>(
    `SELECT id, name FROM users WHERE is_active = true ORDER BY name ASC`,
  );
}
