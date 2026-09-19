import { runRead, runWrite } from '../../db/connection.js';
import type { QueryResult } from '../../db/connection.js';
import { exportSnapshots } from '../../db/export.js';
import { uuid } from '../../lib/uuid.js';
import type { AuthUser } from '../../middleware/requireAuth.js';
import { issueCreateSchema } from '@tracker/shared';
import type { ProjectIssueEntry, ProjectIssueHistory } from '@tracker/shared';

export class IssuesError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'IssuesError';
  }
}

interface IssueRow extends QueryResult {
  id: string;
  project_id: string;
  issue_text: string;
  issue_date: string;
  assignee_id: string | null;
  assignee_name: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

// DuckDB's DATE driver values arrive as ISO timestamps (string or Date object).
// The API contract is YYYY-MM-DD — normalize before returning to callers.
function dateOnly(v: unknown): string {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function toEntry(row: IssueRow): ProjectIssueEntry {
  return {
    id: row.id,
    project_id: row.project_id,
    issue_text: row.issue_text,
    issue_date: dateOnly(row.issue_date),
    assignee_id: row.assignee_id,
    assignee_name: row.assignee_name,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    created_at: row.created_at,
  };
}

function todayIso(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/**
 * SUPER_ADMIN-only full history of a project's logged issues, newest first.
 * STAFF never needs this — they only see the latest issue in the grid.
 */
export async function getIssueHistory(projectId: string): Promise<ProjectIssueHistory> {
  const projectRows = await runRead<{ id: string; project_name: string }>(
    `SELECT id, project_name FROM projects WHERE id = ?`,
    [projectId],
  );
  const project = projectRows[0];
  if (!project) throw new IssuesError('Project not found', 404);

  const rows = await runRead<IssueRow>(
    `SELECT pi.*, a.name AS assignee_name, cb.name AS created_by_name
     FROM project_issues pi
     LEFT JOIN users a ON a.id = pi.assignee_id
     LEFT JOIN users cb ON cb.id = pi.created_by
     WHERE pi.project_id = ?
     ORDER BY pi.created_at DESC, pi.id DESC`,
    [projectId],
  );

  return {
    project_id: project.id,
    project_name: project.project_name,
    entries: rows.map(toEntry),
  };
}

/**
 * SUPER_ADMIN only. Validates the payload (assignee must be an active STAFF
 * user), logs a new project_issues row AND syncs the denormalized
 * projects.issues text to it inside the same write transaction, so the two can
 * never drift. issue_date defaults to today; assignee_id defaults to null.
 */
export async function addIssue(user: AuthUser, projectId: string, rawPayload: unknown): Promise<{ id: string }> {
  const payload = issueCreateSchema.parse(rawPayload);
  const projectRows = await runRead<{ id: string }>(`SELECT id FROM projects WHERE id = ?`, [projectId]);
  if (projectRows.length === 0) throw new IssuesError('Project not found', 404);

  let assigneeId: string | null = payload.assignee_id ?? null;
  if (assigneeId) {
    const userRows = await runRead<{ role: string; is_active: boolean }>(
      `SELECT role, is_active FROM users WHERE id = ?`,
      [assigneeId],
    );
    const target = userRows[0];
    if (!target || !target.is_active || target.role !== 'STAFF') {
      throw new IssuesError('Assigned staff must be an active STAFF user', 400);
    }
  }

  const issueDate = payload.issue_date ?? todayIso();
  const id = uuid();

  await runWrite(async (ex) => {
    await ex(
      `INSERT INTO project_issues (id, project_id, issue_text, issue_date, assignee_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, current_timestamp)`,
      [id, projectId, payload.issue_text, issueDate, assigneeId, user.id],
    );
    await ex(`UPDATE projects SET issues = ?, updated_at = current_timestamp WHERE id = ?`, [
      payload.issue_text,
      projectId,
    ]);
  });

  await exportSnapshots(['projects', 'project_issues']);
  return { id };
}

/**
 * Batch lookup used by the grid list query: the latest issue's date + assignee
 * per project id (the latest issue TEXT is on projects.issues). Only queries
 * the ids on the current page. Mirrors getLatestUpdateInfo.
 */
export async function getLatestIssueMeta(
  projectIds: string[],
): Promise<Map<string, { issue_date: string; assignee_name: string | null }>> {
  const result = new Map<string, { issue_date: string; assignee_name: string | null }>();
  if (projectIds.length === 0) return result;

  const placeholders = projectIds.map(() => '?').join(', ');
  const rows = await runRead<{
    project_id: string;
    issue_date: string;
    assignee_name: string | null;
    created_at: string;
  }>(
    `SELECT pi.project_id, pi.issue_date, a.name AS assignee_name, pi.created_at
     FROM project_issues pi
     LEFT JOIN users a ON a.id = pi.assignee_id
     WHERE pi.project_id IN (${placeholders})
     ORDER BY pi.created_at DESC, pi.id DESC`,
    projectIds,
  );

  for (const row of rows) {
    if (!result.has(row.project_id)) {
      result.set(row.project_id, { issue_date: dateOnly(row.issue_date), assignee_name: row.assignee_name });
    }
  }
  return result;
}