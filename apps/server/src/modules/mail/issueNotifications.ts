import { runRead } from '../../db/connection.js';
import type { QueryResult } from '../../db/connection.js';
import { isMailEnabled } from './config.js';
import { sendMail } from './mailer.js';
import { buildIssueAssignedEmail } from './templates/issueAssigned.js';

export interface IssueAssignmentEmailInput {
  issueId: string;
  projectName: string;
  issueText: string;
  issueDate: string;
  assigneeIds: string[];
  /** Display name of the admin who logged the issue (optional). */
  assignedByName?: string | null;
}

interface RecipientRow extends QueryResult {
  id: string;
  name: string | null;
  email: string | null;
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Best-effort email to an issue's assignees. Never throws: a mail failure must
 * not fail (or roll back) the issue that already committed. Failures are logged
 * as `issue-email failed issue=<id> to=<email> reason=<msg>`; recipients with no
 * email address are skipped. Callers invoke this fire-and-forget, after the
 * write transaction.
 */
export async function notifyIssueAssignees(input: IssueAssignmentEmailInput): Promise<void> {
  if (!isMailEnabled() || input.assigneeIds.length === 0) return;

  let rows: RecipientRow[];
  try {
    const placeholders = input.assigneeIds.map(() => '?').join(', ');
    rows = await runRead<RecipientRow>(
      `SELECT id, name, email FROM users WHERE is_active = true AND id IN (${placeholders})`,
      input.assigneeIds,
    );
  } catch (err) {
    console.error(`issue-email failed issue=${input.issueId} to=<lookup> reason=${reasonOf(err)}`);
    return;
  }

  for (const recipient of rows) {
    const email = recipient.email?.trim();
    if (!email) continue;
    try {
      const mail = buildIssueAssignedEmail({
        recipientName: recipient.name,
        projectName: input.projectName,
        issueText: input.issueText,
        issueDate: input.issueDate,
        assignedByName: input.assignedByName ?? null,
        otherAssignees: rows
          .filter((r) => r.id !== recipient.id)
          .map((r) => r.name)
          .filter((n): n is string => !!n),
      });
      await sendMail({ to: email, ...mail });
    } catch (err) {
      console.error(`issue-email failed issue=${input.issueId} to=${email} reason=${reasonOf(err)}`);
    }
  }
}
