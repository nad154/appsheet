import { runRead } from '../../db/connection.js';
import type { AuthUser } from '../../middleware/requireAuth.js';
import type { Project, ProjectList } from '@tracker/shared';

interface ProjectRow extends Project {
  [key: string]: unknown;
}

// Whitelist of sortable columns. Never interpolate caller-provided column
// names into SQL directly — only these keys are allowed.
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
]);

export interface ProjectListQuery {
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
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

  const isStaff = user.role === 'STAFF';
  const whereClause = isStaff ? 'WHERE p.staff_assigned_id = ?' : '';

  const params: unknown[] = [];
  if (isStaff) params.push(user.id);

  const rows = await runRead<ProjectRow>(
    `SELECT p.*, u.name AS staff_assigned_name 
    FROM projects p LEFT JOIN users u ON u.id = p.staff_assigned_id
     ${whereClause}
     ORDER BY ${sortBy} ${sortDir}
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );

  const countRows = await runRead<{ total: number }>(
    `SELECT count(*) AS total FROM projects p ${whereClause}`,
    params,
  );
  const total = Number(countRows[0]?.total ?? 0);

  return { rows, total, page, page_size: pageSize };
}
