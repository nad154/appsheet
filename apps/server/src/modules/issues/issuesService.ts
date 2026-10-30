import { runRead, runWrite } from '../../db/connection.js';
import type { QueryResult } from '../../db/connection.js';
import { exportSnapshots } from '../../db/export.js';
import { uuid } from '../../lib/uuid.js';
import type { AuthUser } from '../../middleware/requireAuth.js';
import { issueCreateSchema, MAX_ISSUE_ASSIGNEES } from '@tracker/shared';
import type { IssueAssignee, ProjectIssueEntry, ProjectIssueHistory } from '@tracker/shared';
import { notifyIssueAssignees } from '../mail/issueNotifications.js';

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

function toEntry(row: IssueRow, assignees: IssueAssignee[]): ProjectIssueEntry {
  return {
    id: row.id,
    project_id: row.project_id,
    issue_text: row.issue_text,
    issue_date: dateOnly(row.issue_date),
    assignees,
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
 * Batched assignee load for a set of issue ids (one query). A dangling user id
 * (permanently deleted user) is preserved with a null name so the UI can flag it.
 * Ordered by name, then id for stability.
 */
export async function loadIssueAssignees(
  issueIds: string[],
): Promise<Map<string, IssueAssignee[]>> {
  const byIssue = new Map<string, IssueAssignee[]>();
  if (issueIds.length === 0) return byIssue;

  const placeholders = issueIds.map(() => '?').join(', ');
  const rows = await runRead<{ issue_id: string; id: string; name: string | null }>(
    `SELECT ia.issue_id, ia.user_id AS id, u.name
     FROM project_issue_assignees ia
     LEFT JOIN users u ON u.id = ia.user_id
     WHERE ia.issue_id IN (${placeholders})
     ORDER BY ia.issue_id ASC, u.name ASC NULLS LAST, ia.user_id ASC`,
    issueIds,
  );
  for (const row of rows) {
    const list = byIssue.get(row.issue_id) ?? [];
    list.push({ id: row.id, name: row.name });
    byIssue.set(row.issue_id, list);
  }
  return byIssue;
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
    `SELECT pi.*, cb.name AS created_by_name
     FROM project_issues pi
     LEFT JOIN users cb ON cb.id = pi.created_by
     WHERE pi.project_id = ?
     ORDER BY pi.created_at DESC, pi.id DESC`,
    [projectId],
  );

  const assigneesByIssue = await loadIssueAssignees(rows.map((r) => r.id));
  return {
    project_id: project.id,
    project_name: project.project_name,
    entries: rows.map((row) => toEntry(row, assigneesByIssue.get(row.id) ?? [])),
  };
}

/**
 * A project's allowed issue-assignee pool: its assigned Sales plus every PIC,
 * de-duplicated. This is the ONLY source of valid assignees — the admin logging
 * an issue cannot assign somebody outside it.
 */
async function loadAssigneePool(projectId: string): Promise<Set<string>> {
  const projectRows = await runRead<{ staff_assigned_id: string | null }>(
    `SELECT staff_assigned_id FROM projects WHERE id = ?`,
    [projectId],
  );
  const project = projectRows[0];
  if (!project) throw new IssuesError('Project not found', 404);

  const picRows = await runRead<{ user_id: string }>(
    `SELECT user_id FROM project_pics WHERE project_id = ?`,
    [projectId],
  );

  const pool = new Set<string>(picRows.map((r) => r.user_id));
  if (project.staff_assigned_id) pool.add(project.staff_assigned_id);
  return pool;
}

/**
 * Validate a proposed assignee set: de-duplicated, capped at 20, every id in the
 * project's Sales+PIC pool, and every user still active. Returns the
 * de-duplicated ids in caller order.
 */
export async function assertIssueAssignees(projectId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length > MAX_ISSUE_ASSIGNEES) {
    throw new IssuesError(`At most ${MAX_ISSUE_ASSIGNEES} assignees per issue`, 400);
  }
  if (unique.length === 0) return unique;

  const pool = await loadAssigneePool(projectId);
  if (unique.some((id) => !pool.has(id))) {
    throw new IssuesError('Issue assignees must be the project’s Sales or PICs', 400);
  }

  const inClause = unique.map(() => '?').join(', ');
  const rows = await runRead<{ id: string }>(
    `SELECT id FROM users WHERE is_active = true AND id IN (${inClause})`,
    unique,
  );
  const active = new Set(rows.map((r) => r.id));
  if (unique.some((id) => !active.has(id))) {
    throw new IssuesError('Every issue assignee must be an active user', 400);
  }
  return unique;
}

/**
 * SUPER_ADMIN only. Validates the payload (assignees must be active Sales/PICs
 * on this project), logs a new project_issues row + its assignee rows AND syncs
 * the denormalized projects.issues text to it inside the same write
 * transaction, so the two can never drift. issue_date defaults to today;
 * assignee_ids defaults to none. When send_email is true the assignees are
 * emailed best-effort AFTER the commit (never inside the mutex).
 */
export async function addIssue(user: AuthUser, projectId: string, rawPayload: unknown): Promise<{ id: string }> {
  const payload = issueCreateSchema.parse(rawPayload);
  const projectRows = await runRead<{ id: string; project_name: string }>(
    `SELECT id, project_name FROM projects WHERE id = ?`,
    [projectId],
  );
  const project = projectRows[0];
  if (!project) throw new IssuesError('Project not found', 404);

  const assigneeIds = await assertIssueAssignees(projectId, payload.assignee_ids);

  const issueDate = payload.issue_date ?? todayIso();
  const id = uuid();

  await runWrite(async (ex) => {
    await ex(
      `INSERT INTO project_issues (id, project_id, issue_text, issue_date, assignee_id, created_by, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, current_timestamp)`,
      [id, projectId, payload.issue_text, issueDate, user.id],
    );
    for (const assigneeId of assigneeIds) {
      await ex(`INSERT INTO project_issue_assignees (issue_id, user_id) VALUES (?, ?)`, [id, assigneeId]);
    }
    await ex(`UPDATE projects SET issues = ?, updated_at = current_timestamp WHERE id = ?`, [
      payload.issue_text,
      projectId,
    ]);
  });

  await exportSnapshots(['projects', 'project_issues', 'project_issue_assignees']);

  // Fire-and-forget: a mail failure must never fail (or roll back) the issue.
  // notifyIssueAssignees catches its own errors and logs per recipient.
  if (payload.send_email && assigneeIds.length > 0) {
    void notifyIssueAssignees({
      issueId: id,
      projectId,
      projectName: project.project_name,
      issueText: payload.issue_text,
      issueDate,
      assigneeIds,
      assignedByName: user.name,
    });
  }

  return { id };
}

/**
 * Batch lookup used by the grid list query: the latest issue's date + assignees
 * per project id (the latest issue TEXT is on projects.issues). Only queries the
 * ids on the current page. Mirrors getLatestUpdateInfo.
 */
export async function getLatestIssueMeta(
  projectIds: string[],
): Promise<Map<string, { issue_date: string; assignees: IssueAssignee[] }>> {
  const result = new Map<string, { issue_date: string; assignees: IssueAssignee[] }>();
  if (projectIds.length === 0) return result;

  const placeholders = projectIds.map(() => '?').join(', ');
  const rows = await runRead<{ id: string; project_id: string; issue_date: string }>(
    `SELECT pi.id, pi.project_id, pi.issue_date
     FROM project_issues pi
     WHERE pi.project_id IN (${placeholders})
     ORDER BY pi.created_at DESC, pi.id DESC`,
    projectIds,
  );

  // Rows arrive newest-first; keep only the first (latest) issue per project.
  const latest = new Map<string, { id: string; issue_date: string }>();
  for (const row of rows) {
    if (!latest.has(row.project_id)) {
      latest.set(row.project_id, { id: row.id, issue_date: dateOnly(row.issue_date) });
    }
  }

  const assigneesByIssue = await loadIssueAssignees([...latest.values()].map((r) => r.id));
  for (const [projectId, row] of latest) {
    result.set(projectId, {
      issue_date: row.issue_date,
      assignees: assigneesByIssue.get(row.id) ?? [],
    });
  }
  return result;
}
