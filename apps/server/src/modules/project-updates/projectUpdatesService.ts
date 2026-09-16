import { runRead, runWrite } from '../../db/connection.js';
import type { QueryResult } from '../../db/connection.js';
import { uuid } from '../../lib/uuid.js';
import type { ProjectUpdateEntry, ProjectUpdateHistory } from '@tracker/shared';

export class ProjectUpdatesError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'ProjectUpdatesError';
  }
}

interface ProjectUpdateRow extends QueryResult {
  id: string;
  project_id: string;
  staff_id: string;
  staff_name: string;
  changes_json: string;
  update_progress: string;
  is_read: boolean;
  created_at: string;
}

function toEntry(row: ProjectUpdateRow): ProjectUpdateEntry {
  let changes: Record<string, { old: unknown; new: unknown }> = {};
  try { changes = JSON.parse(row.changes_json); } catch { /* leave empty */ }
  return {
    id: row.id,
    project_id: row.project_id,
    staff_id: row.staff_id,
    staff_name: row.staff_name,
    changes,
    update_progress: row.update_progress,
    is_read: row.is_read,
    created_at: row.created_at,
  };
}

/**
 * Insert one history row inside an already-open write transaction (pass the
 * `ex` executor from the caller's runWrite block — this must never open its
 * own mutex, or it will deadlock against the caller's).
 */
export async function recordProjectUpdate(
  ex: (sql: string, params?: unknown[]) => Promise<QueryResult[]>,
  input: {
    projectId: string;
    staffId: string;
    changes: Record<string, { old: unknown; new: unknown }>;
    updateProgress: string;
  },
): Promise<void> {
  await ex(
    `INSERT INTO project_updates (id, project_id, staff_id, changes_json, update_progress, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, false, current_timestamp)`,
    [uuid(), input.projectId, input.staffId, JSON.stringify(input.changes), input.updateProgress],
  );
}

/**
 * SUPER_ADMIN-only. Fetches full history newest-first AND marks every entry
 * for this project as read, atomically, so opening the modal is what clears
 * the grid's yellow dot.
 */
export async function getHistoryAndMarkRead(projectId: string): Promise<ProjectUpdateHistory> {
  const projectRows = await runRead<{ id: string; project_name: string }>(
    `SELECT id, project_name FROM projects WHERE id = ?`,
    [projectId],
  );
  const project = projectRows[0];
  if (!project) throw new ProjectUpdatesError('Project not found', 404);

  return runWrite(async (ex) => {
    const rows = (await ex(
      `SELECT pu.*, u.name AS staff_name
       FROM project_updates pu JOIN users u ON u.id = pu.staff_id
       WHERE pu.project_id = ?
       ORDER BY pu.created_at DESC`,
      [projectId],
    )) as ProjectUpdateRow[];

    await ex(`UPDATE project_updates SET is_read = true WHERE project_id = ?`, [projectId]);

    return {
      project_id: project.id,
      project_name: project.project_name,
      entries: rows.map(toEntry),
    };
  });
}

/**
 * Batch lookup used by the grid list query: latest update_progress + whether
 * any unread entry exists, per project id. Only queries the ids on the
 * current page — cheap at this app's scale.
 */
export async function getLatestUpdateInfo(
  projectIds: string[],
): Promise<Map<string, { update_progress: string; has_unread_update: boolean }>> {
  const result = new Map<string, { update_progress: string; has_unread_update: boolean }>();
  if (projectIds.length === 0) return result;

  const placeholders = projectIds.map(() => '?').join(', ');
  const rows = await runRead<{ project_id: string; update_progress: string; is_read: boolean; created_at: string }>(
    `SELECT project_id, update_progress, is_read, created_at
     FROM project_updates
     WHERE project_id IN (${placeholders})
     ORDER BY created_at DESC`,
    projectIds,
  );

  for (const row of rows) {
    const existing = result.get(row.project_id);
    if (!existing) {
      result.set(row.project_id, { update_progress: row.update_progress, has_unread_update: !row.is_read });
    } else if (!row.is_read) {
      existing.has_unread_update = true; // any unread entry flips it, not just the latest
    }
  }
  return result;
}