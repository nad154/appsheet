import { runRead } from '../../db/connection.js';
import { resolveAgingThresholds } from '../settings/agingThresholdsCache.js';
import type { AuthUser } from '../../middleware/requireAuth.js';
import { computeAging, computePriority } from '@tracker/shared';
import type { Project, ProjectList } from '@tracker/shared';

interface ProjectRow extends Project {
  [key: string]: unknown;
}

// Whitelist of sortable columns. Never interpolate caller-provided column
// names into SQL directly — only these keys are allowed.
//
// `aging` and `priority` are NOT real columns: they are derived per request
// (aging from project dates against today, priority from aging + the current
// aging thresholds). They are allowed keys, but listProjects handles them as
// in-memory sorts rather than SQL ORDER BY expressions.
const SORTABLE_COLUMNS = new Set([
  'project_name',
  'customer_name',
  'vendor_name',
  'customer_price',
  'vendor_price',
  'customer_end_contract',
  'vendor_end_contract',
  'current_stage',
  'updated_at',
  'created_at',
  'aging',
  'priority',
]);

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
  const sortBy = SORTABLE_COLUMNS.has(query.sort_by ?? '') ? (query.sort_by as string) : 'updated_at';
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
  if (sortBy === 'aging' || sortBy === 'priority') {
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
      .sort((a, b) => compareDerived(a, b, sortBy, sortDir))
      .slice(offset, offset + pageSize);
  } else {
    rows = await runRead<ProjectRow>(
      `SELECT p.*, u.name AS staff_assigned_name, pic_user.name AS pic_name
      FROM projects p LEFT JOIN users u ON u.id = p.staff_assigned_id
       LEFT JOIN users pic_user ON pic_user.id = p.pic_id
       ${whereClause}
       ORDER BY ${sortBy} ${sortDir}
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
