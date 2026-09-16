import { runRead, runWrite } from '../../db/connection.js';
import { resolveAgingThresholds } from '../settings/agingThresholdsCache.js';
import type { AuthUser } from '../../middleware/requireAuth.js';
import { exportSnapshots } from '../../db/export.js';
import { uuid } from '../../lib/uuid.js';
import { createProjectFolder } from '../drive/driveService.js';
import { isGoogleConfigured } from '../google/auth.js';
import { recordProjectUpdate } from '../project-updates/projectUpdatesService.js';
import { getLatestUpdateInfo } from '../project-updates/projectUpdatesService.js';
import { projectCreateSchema, projectUpdateSchema, computeAging, computePriority } from '@tracker/shared';
import type { Project, ProjectList, ProjectCreate, ProjectUpdate } from '@tracker/shared';

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
  updated_at: 'p.updated_at',
  created_at: 'p.created_at',
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
  const sortDir = query.sort_dir
    ? (query.sort_dir === 'asc' ? 'ASC' : 'DESC')
    : (query.sort_by ? 'DESC' : 'ASC');
  const offset = (page - 1) * pageSize;

  const { whereClause, params } = scopeClause(user);
  const thresholds = await resolveAgingThresholds();

  // Priority (from Aging + the current thresholds) for in-memory sorting.
  // Priority is never persisted — computed per request so it always tracks the
  // latest admin-configured aging thresholds. Update-progress info isn't a
  // sort criterion, so it's merged in the final enrich() below.
  const withPriority = (rows: ProjectRow[]) =>
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
    rows = withPriority(all)
      .sort((a, b) => compareDerived(a, b, sortKey, sortDir))
      .slice(offset, offset + pageSize);
  } else {
    // Real-column keys ORDER BY themselves; the two joined-name keys resolve to
    // the mapped expressions above and pin NULL (unassigned) rows last.
    const sortExpr = SORTABLE_COLUMNS[sortKey] ?? 'p.created_at';
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

  // Latest update-progress note + unread flag, queried only for the ids on the
  // current page (cheap at this app's scale).
  const updateInfo = await getLatestUpdateInfo(rows.map((r) => r.id));
  const enrich = (rowList: ProjectRow[]) =>
    rowList.map((r) => {
      const info = updateInfo.get(r.id);
      return {
        ...r,
        priority: computePriority(computeAging(r), thresholds),
        update_progress: info?.update_progress ?? null,
        has_unread_update: info?.has_unread_update ?? false,
      };
    });

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

export class ProjectWriteError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'ProjectWriteError';
  }
}

/** STAFF may only ever own/target their own projects, and can never reassign Sales. */
export function assertStaffOwnership(
  user: AuthUser,
  existing: { staff_assigned_id?: string | null } | null,
  payload: { staff_assigned_id?: string | null },
): void {
  if (user.role !== 'STAFF') return;
  if (existing && existing.staff_assigned_id !== user.id) {
    throw new ProjectWriteError('Cannot edit a project assigned to another staff member', 403);
  }
  if (payload.staff_assigned_id && payload.staff_assigned_id !== user.id) {
    throw new ProjectWriteError('Cannot assign or reassign a project to another staff member', 403);
  }
}

async function fetchProject(id: string): Promise<ProjectRow | null> {
  const rows = await runRead<ProjectRow>(
    `SELECT p.*, pic_user.name AS pic_name
     FROM projects p LEFT JOIN users pic_user ON pic_user.id = p.pic_id
     WHERE p.id = ?`,
    [id],
  );
  return rows[0] ?? null;
}

const PROJECT_COLUMNS: (keyof ProjectCreate)[] = [
  'folder_name',
  'project_name',
  'staff_assigned_id',
  'drive_folder_id',
  'customer_name',
  'market_segment',
  'service_or_goods',
  'date_customer_received_doc1',
  'date_customer_received_doc2',
  'doc2_number_id',
  'customer_price',
  'customer_start_contract',
  'customer_end_contract',
  'vendor_name',
  'vendor_revenue',
  'vendor_type',
  'project_sent_date',
  'project_finish_date',
  'vendor_project_id',
  'negotiation_date',
  'approval_date',
  'document_sent_date',
  'document_id',
  'vendor_price',
  'vendor_start_contract',
  'vendor_end_contract',
  'current_stage',
  'pic_id',
  'issues',
];

function insertProjectSql(): string {
  return `INSERT INTO projects (${[...PROJECT_COLUMNS, 'id', 'created_at', 'updated_at'].join(', ')})
          VALUES (${[...PROJECT_COLUMNS, 'id'].map(() => '?').join(', ')}, current_timestamp, current_timestamp)`;
}

function buildInsertValues(id: string, payload: ProjectCreate | Record<string, unknown>): unknown[] {
  const values: unknown[] = [];
  for (const col of PROJECT_COLUMNS) {
    values.push((payload as Record<string, unknown>)[col] ?? null);
  }
  values.push(id);
  return values;
}

/**
 * Create a project. Runs for both roles — STAFF writes apply immediately, just
 * like SUPER_ADMIN; there is no approval queue anymore. A STAFF caller can
 * never assign the project to another staff member (their id is defaulted in).
 */
export async function createProject(user: AuthUser, rawPayload: unknown): Promise<{ id: string }> {
  const payload = projectCreateSchema.parse(rawPayload);
  assertStaffOwnership(user, null, payload);
  const stored: ProjectCreate = { ...payload };
  if (user.role === 'STAFF') {
    stored.staff_assigned_id = user.id;
  }

  const id = uuid();
  await runWrite(async (ex) => {
    // Create the 1:1 Drive folder (when Drive is configured) before inserting,
    // so a Drive failure rolls back the whole write — no orphaned project.
    let driveFolderId: string | null = stored.drive_folder_id ?? null;
    if (isGoogleConfigured() && !driveFolderId) {
      driveFolderId = await createProjectFolder(stored.project_name);
    }
    const values = buildInsertValues(id, { ...stored, drive_folder_id: driveFolderId });
    await ex(insertProjectSql(), values);
  });
  await exportSnapshots(['projects']);
  return { id };
}

/**
 * Update an existing project. For STAFF this applies immediately AND writes a
 * project_updates history row (old/new diff + update-progress text) inside the
 * same runWrite transaction, so the change and its log commit atomically.
 */
export async function updateProject(
  user: AuthUser,
  projectId: string,
  rawPayload: unknown,
  updateProgress?: string,
): Promise<void> {
  const payload = projectUpdateSchema.parse(rawPayload);
  const project = await fetchProject(projectId);
  if (!project) throw new ProjectWriteError('Project not found', 404);

  assertStaffOwnership(user, project, payload);

  const sets = Object.keys(payload)
    .filter((k) => payload[k as keyof ProjectUpdate] !== undefined)
    .map((k) => `${k} = ?`);
  sets.push('updated_at = current_timestamp');

  if (sets.length === 1) {
    throw new ProjectWriteError('No changes to apply', 400);
  }

  const values = Object.entries(payload)
    .filter(([, v]) => v !== undefined)
    .map(([, v]) => v);

  const isStaff = user.role === 'STAFF';
  if (isStaff && !updateProgress) {
    // The route enforces update_progress via Zod; this is defence-in-depth.
    throw new ProjectWriteError('Update progress is required', 400);
  }

  await runWrite(async (ex) => {
    await ex(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, [...values, projectId]);
    if (isStaff) {
      const changes: Record<string, { old: unknown; new: unknown }> = {};
      for (const field of Object.keys(payload)) {
        const value = payload[field as keyof ProjectUpdate];
        if (value !== undefined) {
          changes[field] = { old: (project as Record<string, unknown>)[field] ?? null, new: value };
        }
      }
      await recordProjectUpdate(ex, {
        projectId,
        staffId: user.id,
        changes,
        updateProgress: updateProgress!,
      });
    }
  });
  await exportSnapshots(['projects']);
}

/** Delete a project. SUPER_ADMIN only. */
export async function deleteProject(user: AuthUser, projectId: string): Promise<void> {
  if (user.role !== 'SUPER_ADMIN') {
    throw new ProjectWriteError('Only SUPER_ADMIN can delete projects', 403);
  }
  await runWrite(async (ex) => {
    await ex(`DELETE FROM projects WHERE id = ?`, [projectId]);
  });
  await exportSnapshots(['projects']);
}