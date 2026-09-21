import { runRead, runWrite } from '../../db/connection.js';
import { resolveAgingThresholds } from '../settings/agingThresholdsCache.js';
import type { AuthUser } from '../../middleware/requireAuth.js';
import { exportSnapshots } from '../../db/export.js';
import { uuid } from '../../lib/uuid.js';
import { createProjectFolder } from '../drive/driveService.js';
import { isGoogleConfigured } from '../google/auth.js';
import { recordProjectUpdate, getLatestUpdateInfo } from '../project-updates/projectUpdatesService.js';
import { getLatestIssueMeta } from '../issues/issuesService.js';
import {
  projectCreateSchema,
  projectUpdateSchema,
  projectVendorCreateSchema,
  computeAging,
  computePriority,
  packIntoPages,
  totalLinesFor,
} from '@tracker/shared';
import type { Project, ProjectList, ProjectCreate, ProjectUpdate, ProjectVendorLine } from '@tracker/shared';

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
// UUID. customer_name joins through customers.c.name.
//
// Vendor-line fields and derived Aging/Priority are NOT sortable — they have
// no single value per project (planning_customers_vendors Phase 5 decision).
const SORTABLE_COLUMNS: Record<string, string> = {
  project_name: 'p.project_name',
  customer_name: 'c.name',
  customer_price: 'p.customer_price',
  customer_end_contract: 'p.customer_end_contract',
  current_stage: 'p.current_stage',
  updated_at: 'p.updated_at',
  created_at: 'p.created_at',
  pic_name: 'pic_user.name',
  pic_id: 'pic_user.name',
  staff_assigned_id: 'u.name',
};

// The joined-name sort keys order by a LEFT-JOINed user name, which is NULL
// when no PIC/Sales is assigned to a project. Append NULLS LAST so unassigned
// rows always sink to the end.
const NULLS_LAST_SORT_KEYS = new Set(['pic_name', 'pic_id', 'staff_assigned_id']);

export interface ProjectListQuery {
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
  /** Restrict results to projects created in the given calendar year. */
  year?: number;
}

/**
 * RBAC row-scoping shared by the projects grid AND the dashboard aggregation
 * (dashboardService.getChartData), so the two can never diverge over what a
 * STAFF user is allowed to see.
 */
export function scopeClause(user: AuthUser): { whereClause: string; params: unknown[] } {
  if (user.role === 'STAFF') return { whereClause: 'WHERE p.staff_assigned_id = ?', params: [user.id] };
  return { whereClause: '', params: [] };
}

/**
 * Distinct creation years within the caller's RBAC scope, newest first. Powers
 * the grid's dynamic year-filter dropdown so STAFF only sees years they have
 * projects in.
 */
export async function listProjectYears(user: AuthUser): Promise<number[]> {
  const { whereClause, params } = scopeClause(user);
  const rows = await runRead<{ year: number }>(
    `SELECT DISTINCT CAST(strftime(p.created_at, '%Y') AS INTEGER) AS year
     FROM projects p
     ${whereClause}
     ORDER BY year DESC`,
    params,
  );
  return rows.map((r) => Number(r.year));
}

/**
 * List projects with server-side RBAC filtering. STAFF only ever sees the
 * projects assigned to them — the WHERE clause is injected server-side from the
 * authenticated user, never from a client-supplied filter.
 *
 * Pagination uses the greedy pack from planning_customers_vendors §3.1: a
 * project's vendor lines always land together on one page, and page boundaries
 * are computed in application code (never evenly spaced), so `total_pages`
 * comes from the server rather than `ceil(total/page_size)`.
 */
export async function listProjects(user: AuthUser, query: ProjectListQuery): Promise<ProjectList> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, query.page_size ?? 50));
  const sortKey = query.sort_by ?? '';
  const sortDir = query.sort_dir
    ? (query.sort_dir === 'asc' ? 'ASC' : 'DESC')
    : (query.sort_by ? 'DESC' : 'ASC');

  let { whereClause, params } = scopeClause(user);
  const thresholds = await resolveAgingThresholds();

  // Composite year filter: created_at is a TIMESTAMP, so match the [year-01-01,
  // year+1-01-01) half-open range rather than strftime (avoids casting each row
  // and composes cleanly with the RBAC scope clause).
  if (query.year) {
    const yearClause = whereClause ? `${whereClause} AND ` : 'WHERE ';
    const start = `${query.year}-01-01`;
    const end = `${query.year + 1}-01-01`;
    params.push(start, end);
    whereClause = `${yearClause}p.created_at >= ? AND p.created_at < ?`;
  }

  // Step 1 — one lightweight query for the WHOLE scoped set: id + vendor-line
  // count + the sort key. The scoped set is ≤500 projects at this app's scale,
  // so this is cheap and drives the pack with exactly the order the user sees.
  const sortExpr = SORTABLE_COLUMNS[sortKey] ?? 'p.created_at';
  const nullsLast = NULLS_LAST_SORT_KEYS.has(sortKey) ? ' NULLS LAST' : '';
  const scoped = await runRead<{ id: string; line_count: number }>(
    `SELECT p.id,
            (SELECT COUNT(*) FROM project_vendors pv WHERE pv.project_id = p.id) AS line_count
     FROM projects p
     LEFT JOIN users u ON u.id = p.staff_assigned_id
     LEFT JOIN users pic_user ON pic_user.id = p.pic_id
     LEFT JOIN customers c ON c.id = p.customer_id
     ${whereClause}
     ORDER BY ${sortExpr} ${sortDir}${nullsLast}`,
    params,
  );

  // Step 2 — greedy pack into pages of display rows (never split a project's
  // vendor lines across a page). Same pure function the frontend uses for the
  // drill-down locator, so page boundaries can never diverge.
  const pages = packIntoPages(
    scoped.map((r) => ({ id: r.id, lineCount: Number(r.line_count) })),
    pageSize,
  );
  const total = scoped.length;
  const total_pages = pages.length;
  const total_lines = totalLinesFor(scoped.map((r) => ({ id: r.id, lineCount: Number(r.line_count) })));

  // Step 3 — full rows + vendor lines only for the requested page's project ids.
  const pageIds = pages[page - 1] ?? [];
  if (pageIds.length === 0) {
    return { rows: [], total, total_pages, total_lines, page, page_size: pageSize };
  }

  const idIn = pageIds.map(() => '?').join(', ');
  const rowRows = await runRead<ProjectRow>(
    `SELECT p.*, u.name AS staff_assigned_name, pic_user.name AS pic_name, c.name AS customer_name
     FROM projects p
     LEFT JOIN users u ON u.id = p.staff_assigned_id
     LEFT JOIN users pic_user ON pic_user.id = p.pic_id
     LEFT JOIN customers c ON c.id = p.customer_id
     WHERE p.id IN (${idIn})`,
    pageIds,
  );

  const vendorRows = await runRead<ProjectVendorLine>(
    `SELECT pv.*, v.name AS vendor_name
     FROM project_vendors pv
     LEFT JOIN vendors v ON v.id = pv.vendor_id
     WHERE pv.project_id IN (${idIn})
     ORDER BY pv.project_id ASC, pv.sort_order ASC, pv.created_at ASC, pv.id ASC`,
    pageIds,
  );

  const vendorsByProject = new Map<string, ProjectVendorLine[]>();
  for (const line of vendorRows) {
    const withPriority = {
      ...line,
      priority: computePriority(computeAging(line), thresholds),
    };
    const list = vendorsByProject.get(line.project_id) ?? [];
    list.push(withPriority);
    vendorsByProject.set(line.project_id, list);
  }

  // Re-attach in pack order (IN (...) does not preserve order).
  const byId = new Map(rowRows.map((r) => [r.id, r]));
  const orderedRows = pageIds.map((id) => byId.get(id)).filter((r): r is ProjectRow => r !== undefined);

  // Latest update-progress note + unread flag for the ids on this page.
  const updateInfo = await getLatestUpdateInfo(orderedRows.map((r) => r.id));
  // Latest logged issue's date + assignee for the ids on this page (the issue
  // TEXT itself is the denormalized projects.issues column).
  const issueMeta = await getLatestIssueMeta(orderedRows.map((r) => r.id));
  const rows: Project[] = orderedRows.map((r) => ({
    ...r,
    vendors: vendorsByProject.get(r.id) ?? [],
    update_progress: updateInfo.get(r.id)?.update_progress ?? null,
    has_unread_update: updateInfo.get(r.id)?.has_unread_update ?? false,
    latest_issue_date: issueMeta.get(r.id)?.issue_date ?? null,
    latest_issue_assignee: issueMeta.get(r.id)?.assignee_name ?? null,
  }));

  return { rows, total, total_pages, total_lines, page, page_size: pageSize };
}

// Active users that may be assigned as a project's PIC. The settings users
// endpoints are SUPER_ADMIN-only; the grid needs this for both roles. role is
// included so the frontend can offer a STAFF-only list (e.g. issue assignees).
export async function listAssignableUsers(): Promise<{ id: string; name: string; role: string }[]> {
  return runRead<{ id: string; name: string; role: string }>(
    `SELECT id, name, role FROM users WHERE is_active = true ORDER BY name ASC`,
  );
}

export class ProjectWriteError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'ProjectWriteError';
  }
}

/**
 * Single project — same shape as one listProjects row (vendors, latest
 * update-progress + issue meta attached). RBAC-scoped: STAFF may only fetch
 * projects assigned to them.
 */
export async function getProject(user: AuthUser, projectId: string): Promise<Project> {
  const rows = await runRead<ProjectRow>(
    `SELECT p.*, u.name AS staff_assigned_name, pic_user.name AS pic_name, c.name AS customer_name
     FROM projects p
     LEFT JOIN users u ON u.id = p.staff_assigned_id
     LEFT JOIN users pic_user ON pic_user.id = p.pic_id
     LEFT JOIN customers c ON c.id = p.customer_id
     WHERE p.id = ?`,
    [projectId],
  );
  const row = rows[0];
  if (!row) throw new ProjectWriteError('Project not found', 404);
  if (user.role === 'STAFF' && row.staff_assigned_id !== user.id) {
    throw new ProjectWriteError('Cannot view a project assigned to another staff member', 403);
  }

  const vendorRows = await runRead<ProjectVendorLine>(
    `SELECT pv.*, v.name AS vendor_name
     FROM project_vendors pv
     LEFT JOIN vendors v ON v.id = pv.vendor_id
     WHERE pv.project_id = ?
     ORDER BY pv.sort_order ASC, pv.created_at ASC, pv.id ASC`,
    [projectId],
  );
  const thresholds = await resolveAgingThresholds();
  const vendors = vendorRows.map((line) => ({
    ...line,
    priority: computePriority(computeAging(line), thresholds),
  }));

  const updateInfo = await getLatestUpdateInfo([projectId]);
  const issueMeta = await getLatestIssueMeta([projectId]);
  return {
    ...row,
    vendors,
    update_progress: updateInfo.get(projectId)?.update_progress ?? null,
    has_unread_update: updateInfo.get(projectId)?.has_unread_update ?? false,
    latest_issue_date: issueMeta.get(projectId)?.issue_date ?? null,
    latest_issue_assignee: issueMeta.get(projectId)?.assignee_name ?? null,
  };
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
    `SELECT p.*, pic_user.name AS pic_name, c.name AS customer_name
     FROM projects p
     LEFT JOIN users pic_user ON pic_user.id = p.pic_id
     LEFT JOIN customers c ON c.id = p.customer_id
     WHERE p.id = ?`,
    [id],
  );
  return rows[0] ?? null;
}

// Columns insertable on a project row. Vendor-line fields no longer live here
// — they go to project_vendors (planning_customers_vendors §2).
const PROJECT_COLUMNS: (keyof ProjectCreate)[] = [
  'folder_name',
  'project_name',
  'staff_assigned_id',
  'drive_folder_id',
  'customer_id',
  'market_segment',
  'service_or_goods',
  'date_customer_received_doc1',
  'date_customer_received_doc2',
  'doc2_number_id',
  'customer_price',
  'customer_start_contract',
  'customer_end_contract',
  'current_stage',
  'pic_id',
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

const VENDOR_LINE_COLUMNS = [
  'vendor_type',
  'vendor_revenue',
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
] as const;

function insertVendorLineSql(): string {
  // id, project_id, vendor_id, the line columns and sort_order are the 16
  // bound values; created_at/updated_at are literal current_timestamp. Mirrors
  // the inline INSERT in projectVendorsService so the two can never diverge.
  const placeholders = [...VENDOR_LINE_COLUMNS.map(() => '?'), '?', '?', '?', '?'].join(', ');
  return `INSERT INTO project_vendors (
    id, project_id, vendor_id, ${VENDOR_LINE_COLUMNS.join(', ')}, sort_order, created_at, updated_at
  ) VALUES (${placeholders}, current_timestamp, current_timestamp)`;
}

function vendorLineValues(
  lineId: string,
  projectId: string,
  line: { vendor_id: string; sort_order?: number } & Record<string, unknown>,
  sortOrder: number,
): unknown[] {
  const values: unknown[] = [lineId, projectId, line.vendor_id];
  for (const col of VENDOR_LINE_COLUMNS) {
    values.push(line[col] ?? null);
  }
  values.push(sortOrder);
  return values;
}

/**
 * Create a project. Runs for both roles — STAFF writes apply immediately, just
 * like SUPER_ADMIN. A STAFF caller can never assign the project to another
 * staff member (their id is defaulted in). An optional embedded `vendors`
 * array creates the vendor lines in the same transaction, so the "Add project"
 * form still works in a single submit.
 */
export async function createProject(user: AuthUser, rawPayload: unknown): Promise<{ id: string }> {
  const payload = projectCreateSchema.parse(rawPayload);
  assertStaffOwnership(user, null, payload);
  const stored: ProjectCreate = { ...payload };
  if (user.role === 'STAFF') {
    stored.staff_assigned_id = user.id;
    // Only SUPER_ADMIN may set the stage — STAFF-created projects always start
    // on_progress (a project can never be reopened once finished).
    stored.current_stage = 'on_progress';
  }

  const embeddedVendors =
    rawPayload && typeof rawPayload === 'object' && 'vendors' in (rawPayload as Record<string, unknown>)
      ? projectVendorCreateSchema.array().parse((rawPayload as Record<string, unknown>).vendors)
      : [];

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

    for (const [i, line] of embeddedVendors.entries()) {
      const lineId = uuid();
      await ex(
        insertVendorLineSql(),
        vendorLineValues(lineId, id, line as { vendor_id: string } & Record<string, unknown>, i),
      );
    }
  });
  await exportSnapshots(['projects', 'project_vendors']);
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

  if (payload.created_at !== undefined && user.role !== 'SUPER_ADMIN') {
    throw new ProjectWriteError('Only SUPER_ADMIN can change created_at', 403);
  }

  // Stage is SUPER_ADMIN-only (defence-in-depth — the shared update schema
  // accepts it for both roles), and once a project is finished it can never be
  // set back to on_progress.
  if (payload.current_stage !== undefined && user.role !== 'SUPER_ADMIN') {
    throw new ProjectWriteError('Only SUPER_ADMIN can change the stage', 403);
  }
  if (payload.current_stage === 'on_progress' && project.current_stage === 'finish') {
    throw new ProjectWriteError('A finished project cannot be reopened', 400);
  }

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

/** Delete a project. SUPER_ADMIN only. Its vendor lines, updates and issues go with it. */
export async function deleteProject(user: AuthUser, projectId: string): Promise<void> {
  if (user.role !== 'SUPER_ADMIN') {
    throw new ProjectWriteError('Only SUPER_ADMIN can delete projects', 403);
  }
  await runWrite(async (ex) => {
    await ex(`DELETE FROM project_vendors WHERE project_id = ?`, [projectId]);
    await ex(`DELETE FROM project_updates WHERE project_id = ?`, [projectId]);
    await ex(`DELETE FROM project_issues WHERE project_id = ?`, [projectId]);
    await ex(`DELETE FROM projects WHERE id = ?`, [projectId]);
  });
  await exportSnapshots(['projects', 'project_vendors', 'project_updates', 'project_issues']);
}