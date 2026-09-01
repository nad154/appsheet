import { runWrite, runRead } from '../../db/connection.js';
import { uuid } from '../../lib/uuid.js';
import { exportSnapshots } from '../../db/export.js';
import type { AuthUser } from '../../middleware/requireAuth.js';
import {
  projectCreateSchema,
  projectUpdateSchema,
  PENDING_EDIT_STATUSES,
} from '@tracker/shared';
import type {
  PendingEditType,
  PendingEditStatus,
  PendingEditDiff,
  Project,
  ProjectCreate,
  ProjectUpdate,
} from '@tracker/shared';

interface PendingEditRow {
  id: string;
  project_id: string | null;
  requested_by: string;
  edit_type: PendingEditType;
  changes_json: string;
  status: PendingEditStatus;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  [key: string]: unknown;
}

interface ProjectRow extends Project {
  [key: string]: unknown;
}

export class PendingEditError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'PendingEditError';
  }
}

function parseChanges(row: PendingEditRow): Record<string, unknown> {
  try {
    return JSON.parse(row.changes_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toPendingEdit(row: PendingEditRow) {
  const { changes_json, ...rest } = row;
  return { ...rest, changes_json: parseChanges(row) };
}

/**
 * STAFF proposes a new project. Stored as a pending edit (edit_type=CREATE,
 * project_id=NULL). The caller can never create a project for another staff
 * member — staff_assigned_id must be their own.
 */
export async function submitCreate(
  user: AuthUser,
  rawPayload: unknown,
): Promise<{ id: string }> {
  const payload = projectCreateSchema.parse(rawPayload);

  // A STAFF member can never create a project for another staff member — the
  // project is always owned by the caller.
  if (user.role === 'STAFF' && payload.staff_assigned_id && payload.staff_assigned_id !== user.id) {
    throw new PendingEditError('Cannot assign a project to another staff member', 403);
  }

  const stored: ProjectCreate = { ...payload };
  if (user.role === 'STAFF') {
    stored.staff_assigned_id = user.id;
  }

  const id = uuid();
  await runWrite(async (ex) => {
    await ex(
      `INSERT INTO pending_edits (id, project_id, requested_by, edit_type, changes_json, status, created_at)
       VALUES (?, NULL, ?, 'CREATE', ?, 'pending', current_timestamp)`,
      [id, user.id, JSON.stringify(stored)],
    );
  });
  return { id };
}

/**
 * STAFF proposes changes to an existing project. Only the fields that actually
 * differ from the current row are stored (per pending-edit invariant). A STAFF
 * user may not change a project they are not assigned to.
 */
export async function submitUpdate(
  user: AuthUser,
  projectId: string,
  rawPayload: unknown,
): Promise<{ id: string }> {
  const payload = projectUpdateSchema.parse(rawPayload);

  const project = await fetchProject(projectId);
  if (!project) throw new PendingEditError('Project not found', 404);
  if (user.role === 'STAFF' && project.staff_assigned_id !== user.id) {
    throw new PendingEditError('Cannot edit a project assigned to another staff member', 403);
  }
  // A STAFF user may never move a project to another staff member.
  if (user.role === 'STAFF' && payload.staff_assigned_id && payload.staff_assigned_id !== user.id) {
    throw new PendingEditError('Cannot reassign a project to another staff member', 403);
  }

  const current: ProjectRow = project;
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) {
      const currentValue = current[key];
      if (JSON.stringify(currentValue) !== JSON.stringify(value)) {
        changes[key] = value;
      }
    }
  }

  if (Object.keys(changes).length === 0) {
    throw new PendingEditError('No changes to submit', 400);
  }

  const id = uuid();
  await runWrite(async (ex) => {
    await ex(
      `INSERT INTO pending_edits (id, project_id, requested_by, edit_type, changes_json, status, created_at)
       VALUES (?, ?, ?, 'UPDATE', ?, 'pending', current_timestamp)`,
      [id, projectId, user.id, JSON.stringify(changes)],
    );
  });
  return { id };
}

/** SUPER_ADMIN writes a project directly. */
export async function createDirect(
  user: AuthUser,
  rawPayload: unknown,
): Promise<{ id: string }> {
  if (user.role !== 'SUPER_ADMIN') {
    throw new PendingEditError('Only SUPER_ADMIN can create projects directly', 403);
  }
  const payload = projectCreateSchema.parse(rawPayload);
  const id = uuid();
  await runWrite(async (ex) => {
    await ex(insertProjectSql(), buildInsertValues(id, payload));
  });
  await exportSnapshots(['projects']);
  return { id };
}

/** SUPER_ADMIN updates a project directly. */
export async function updateDirect(
  user: AuthUser,
  projectId: string,
  rawPayload: unknown,
): Promise<void> {
  if (user.role !== 'SUPER_ADMIN') {
    throw new PendingEditError('Only SUPER_ADMIN can update projects directly', 403);
  }
  const payload = projectUpdateSchema.parse(rawPayload);
  const project = await fetchProject(projectId);
  if (!project) throw new PendingEditError('Project not found', 404);

  const sets = Object.keys(payload)
    .filter((k) => payload[k as keyof ProjectUpdate] !== undefined)
    .map((k) => `${k} = ?`);
  sets.push('updated_at = current_timestamp');

  if (sets.length === 1) {
    throw new PendingEditError('No changes to apply', 400);
  }

  const values = Object.entries(payload)
    .filter(([, v]) => v !== undefined)
    .map(([, v]) => v);

  await runWrite(async (ex) => {
    await ex(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, [...values, projectId]);
  });
  await exportSnapshots(['projects']);
}

/** SUPER_ADMIN deletes a project directly. */
export async function deleteProject(user: AuthUser, projectId: string): Promise<void> {
  if (user.role !== 'SUPER_ADMIN') {
    throw new PendingEditError('Only SUPER_ADMIN can delete projects', 403);
  }
  await runWrite(async (ex) => {
    await ex(`DELETE FROM pending_edits WHERE project_id = ?`, [projectId]);
    await ex(`DELETE FROM projects WHERE id = ?`, [projectId]);
  });
  await exportSnapshots(['projects', 'pending_edits']);
}

export async function listPendingEdits(status?: PendingEditStatus) {
  const where = status ? 'WHERE status = ?' : '';
  const params = status ? [status] : [];
  const rows = await runRead<PendingEditRow>(
    `SELECT * FROM pending_edits ${where} ORDER BY created_at ASC`,
    params,
  );
  return rows.map(toPendingEdit);
}

export async function listMine(userId: string) {
  const rows = await runRead<PendingEditRow>(
    `SELECT * FROM pending_edits WHERE requested_by = ? ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(toPendingEdit);
}

export async function getPendingEdit(id: string): Promise<PendingEditRow | null> {
  const rows = await runRead<PendingEditRow>(`SELECT * FROM pending_edits WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

/**
 * Compute the diff for a pending edit: current live row (or null for CREATE),
 * proposed target state, changed field names, and any conflicting pending
 * edits that also modify the same field on the same project.
 */
export async function getDiff(id: string): Promise<PendingEditDiff> {
  const edit = await getPendingEdit(id);
  if (!edit) throw new PendingEditError('Pending edit not found', 404);
  if (edit.status !== 'pending') {
    throw new PendingEditError('Only pending edits can be diffed', 400);
  }

  const changes = parseChanges(edit);

  let current: ProjectRow | null = null;
  if (edit.project_id) {
    current = await fetchProject(edit.project_id);
  }

  let proposed: Record<string, unknown>;
  if (edit.edit_type === 'CREATE') {
    proposed = changes;
  } else {
    proposed = { ...(current as Record<string, unknown>) };
    for (const [k, v] of Object.entries(changes)) proposed[k] = v;
  }

  let conflicts: { field: string; pendingEditId: string }[] = [];
  if (edit.project_id && edit.edit_type === 'UPDATE') {
    const others = await runRead<{ id: string; changes_json: string }>(
      `SELECT id, changes_json FROM pending_edits
       WHERE project_id = ? AND status = 'pending' AND id != ?
       ORDER BY created_at ASC`,
      [edit.project_id, id],
    );
    const editFields = new Set(Object.keys(changes));
    for (const other of others) {
      let otherChanges: Record<string, unknown> = {};
      try {
        otherChanges = JSON.parse(other.changes_json);
      } catch {}
      for (const field of editFields) {
        if (field in otherChanges) {
          conflicts.push({ field, pendingEditId: other.id });
        }
      }
    }
  }

  return {
    editId: edit.id,
    editType: edit.edit_type,
    current: current as Record<string, unknown> | null,
    proposed,
    changedFields: Object.keys(changes),
    conflicts,
  };
}

/**
 * Approve a pending edit. Re-reads the current project state inside the write
 * mutex, applies the change, marks the edit approved, and exports the affected
 * Parquet snapshots — all atomically. This re-read guards against acting on a
 * stale diff (e.g., if another admin approved a conflicting edit first).
 */
export async function approve(id: string, admin: AuthUser): Promise<void> {
  const edit = await getPendingEdit(id);
  if (!edit) throw new PendingEditError('Pending edit not found', 404);
  if (edit.status !== 'pending') {
    throw new PendingEditError(`Edit is already ${edit.status}`, 400);
  }
  const changes = parseChanges(edit);

  await runWrite(async (ex) => {
    // Re-read the current project row inside the transaction.
    let current: ProjectRow | null = null;
    if (edit.project_id) {
      const rows = await ex<ProjectRow>(`SELECT * FROM projects WHERE id = ?`, [edit.project_id]);
      current = rows[0] ?? null;
      if (!current) throw new PendingEditError('Project no longer exists', 409);
    }

    if (edit.edit_type === 'CREATE') {
      const clean: Record<string, unknown> = { ...changes };
      clean.id = uuid();
      clean.created_at = 'current_timestamp';
      clean.updated_at = 'current_timestamp';
      if (!clean.project_name) throw new PendingEditError('project_name is required', 400);
      await ex(insertProjectSql(), buildInsertValues(String(clean.id), clean));
    } else {
      if (!current) throw new PendingEditError('Project not found', 404);
      const sets: string[] = [];
      const values: unknown[] = [];
      for (const [field, value] of Object.entries(changes)) {
        sets.push(`${field} = ?`);
        values.push(value);
      }
      sets.push('updated_at = current_timestamp');
      values.push(current.id);
      await ex(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, values);
    }

    await ex(
      `UPDATE pending_edits SET status = 'approved', reviewed_by = ?, reviewed_at = current_timestamp WHERE id = ?`,
      [admin.id, id],
    );
  });

  await exportSnapshots(['projects', 'pending_edits']);
}

export async function reject(id: string, admin: AuthUser, note?: string): Promise<void> {
  const edit = await getPendingEdit(id);
  if (!edit) throw new PendingEditError('Pending edit not found', 404);
  if (edit.status !== 'pending') throw new PendingEditError(`Edit is already ${edit.status}`, 400);

  await runWrite(async (ex) => {
    await ex(
      `UPDATE pending_edits SET status = 'rejected', reviewed_by = ?, review_note = ?, reviewed_at = current_timestamp WHERE id = ?`,
      [admin.id, note ?? null, id],
    );
  });
  await exportSnapshots(['pending_edits']);
}

async function fetchProject(id: string): Promise<ProjectRow | null> {
  const rows = await runRead<ProjectRow>(`SELECT * FROM projects WHERE id = ?`, [id]);
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

export { PENDING_EDIT_STATUSES };
