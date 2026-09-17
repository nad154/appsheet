import { runRead, runWrite } from '../../db/connection.js';
import { uuid } from '../../lib/uuid.js';
import { exportSnapshots } from '../../db/export.js';
import { resolveAgingThresholds } from '../settings/agingThresholdsCache.js';
import {
  projectVendorCreateSchema,
  projectVendorUpdateSchema,
  computePriority,
  computeAging,
} from '@tracker/shared';
import type { ProjectVendorLine, ProjectVendorCreate, ProjectVendorUpdate } from '@tracker/shared';
import type { AuthUser } from '../../middleware/requireAuth.js';

export class ProjectVendorError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'ProjectVendorError';
  }
}

interface ProjectVendorRow extends ProjectVendorLine {
  [key: string]: unknown;
}

async function resolvePriority(row: ProjectVendorRow): Promise<ProjectVendorLine> {
  const thresholds = await resolveAgingThresholds();
  const { priority: _drop, ...rest } = row;
  return {
    ...(rest as unknown as ProjectVendorLine),
    priority: computePriority(computeAging(row), thresholds),
  };
}

async function findProjectOr404(projectId: string): Promise<{ staff_assigned_id: string | null }> {
  const rows = await runRead<{ staff_assigned_id: string | null }>(
    `SELECT staff_assigned_id FROM projects WHERE id = ?`,
    [projectId],
  );
  if (rows.length === 0) throw new ProjectVendorError('Project not found', 404);
  return rows[0];
}

async function findLineOr404(lineId: string): Promise<{ id: string; project_id: string; vendor_id: string }> {
  const rows = await runRead<{ id: string; project_id: string; vendor_id: string }>(
    `SELECT id, project_id, vendor_id FROM project_vendors WHERE id = ?`,
    [lineId],
  );
  if (rows.length === 0) throw new ProjectVendorError('Vendor line not found', 404);
  return rows[0];
}

// A STAFF member edits vendor lines only on projects they own. SUPER_ADMIN can
// edit any line. Mirrors assertStaffOwnership's rule for project-level edits.
function assertLineOwnership(user: AuthUser, project: { staff_assigned_id: string | null }): void {
  if (user.role !== 'STAFF') return;
  if (project.staff_assigned_id !== user.id) {
    throw new ProjectVendorError('Cannot edit vendor lines on a project assigned to another staff member', 403);
  }
}

export async function listForProject(projectId: string): Promise<ProjectVendorLine[]> {
  if (!(await findProjectOr404(projectId))) return [];
  const rows = await runRead<ProjectVendorRow>(
    `SELECT pv.*, v.name AS vendor_name
     FROM project_vendors pv
     LEFT JOIN vendors v ON v.id = pv.vendor_id
     WHERE pv.project_id = ?
     ORDER BY pv.sort_order ASC, pv.created_at ASC, pv.id ASC`,
    [projectId],
  );
  return Promise.all(rows.map(resolvePriority));
}

export async function addVendorLine(
  user: AuthUser,
  projectId: string,
  rawPayload: unknown,
): Promise<{ id: string }> {
  const payload = projectVendorCreateSchema.parse(rawPayload) as ProjectVendorCreate;
  const project = await findProjectOr404(projectId);
  assertLineOwnership(user, project);

  const id = uuid();
  await runWrite(async (ex) => {
    let sortOrder = payload.sort_order;
    if (sortOrder === undefined) {
      const [maxRow] = await ex<{ maxSort: number }>(
        `SELECT COALESCE(MAX(sort_order), -1) AS maxSort FROM project_vendors WHERE project_id = ?`,
        [projectId],
      );
      sortOrder = Number(maxRow?.maxSort ?? -1) + 1;
    }
    await ex(
      `INSERT INTO project_vendors (
        id, project_id, vendor_id, vendor_type, vendor_revenue,
        project_sent_date, project_finish_date, vendor_project_id,
        negotiation_date, approval_date, document_sent_date, document_id,
        vendor_price, vendor_start_contract, vendor_end_contract,
        sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp, current_timestamp)`,
      [
        id, projectId, payload.vendor_id, payload.vendor_type ?? null,
        payload.vendor_revenue ?? null, payload.project_sent_date ?? null,
        payload.project_finish_date ?? null, payload.vendor_project_id ?? null,
        payload.negotiation_date ?? null, payload.approval_date ?? null,
        payload.document_sent_date ?? null, payload.document_id ?? null,
        payload.vendor_price ?? null, payload.vendor_start_contract ?? null,
        payload.vendor_end_contract ?? null, sortOrder,
      ],
    );
  });
  await exportSnapshots(['project_vendors']);
  return { id };
}

export async function updateVendorLine(
  user: AuthUser,
  lineId: string,
  rawPayload: unknown,
): Promise<void> {
  const payload = projectVendorUpdateSchema.parse(rawPayload) as ProjectVendorUpdate;
  if (Object.keys(payload).length === 0) throw new ProjectVendorError('No changes to apply', 400);

  const line = await findLineOr404(lineId);
  const project = await findProjectOr404(line.project_id);
  assertLineOwnership(user, project);

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const field of Object.keys(payload) as (keyof ProjectVendorUpdate)[]) {
    const value = payload[field];
    if (value === undefined) continue;
    sets.push(`${field} = ?`);
    values.push(value === '' ? null : value);
  }
  sets.push('updated_at = current_timestamp');
  values.push(lineId);

  await runWrite(async (ex) => {
    await ex(`UPDATE project_vendors SET ${sets.join(', ')} WHERE id = ?`, values);
  });
  await exportSnapshots(['project_vendors']);
}

export async function removeVendorLine(user: AuthUser, lineId: string): Promise<void> {
  const line = await findLineOr404(lineId);
  const project = await findProjectOr404(line.project_id);
  assertLineOwnership(user, project);

  await runWrite(async (ex) => {
    await ex(`DELETE FROM project_vendors WHERE id = ?`, [lineId]);
  });
  await exportSnapshots(['project_vendors']);
}