import { mailConfig } from '../config.js';

export interface IssueAssignedEmailInput {
  recipientName?: string | null;
  projectName: string;
  issueText: string;
  issueDate: string;
  assignedByName?: string | null;
  otherAssignees?: string[];
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

const SUBJECT_MAX = 150;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Collapse whitespace/newlines and cap length for a one-line subject. */
function toSubjectLine(value: string): string {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > SUBJECT_MAX ? `${line.slice(0, SUBJECT_MAX - 1)}…` : line;
}

/**
 * Build the "you were assigned an issue" email as both text and HTML. Every
 * interpolated value is escaped for the HTML body; the optional project link is
 * omitted entirely when APP_BASE_URL is not configured.
 */
export function buildIssueAssignedEmail(input: IssueAssignedEmailInput): BuiltEmail {
  const projectName = input.projectName.trim();
  const subject = toSubjectLine(`[Project Tracker] Issue assigned: ${projectName}`);
  const greeting = input.recipientName?.trim() ? `Hello ${input.recipientName.trim()},` : 'Hello,';
  const otherAssignees = (input.otherAssignees ?? []).filter(Boolean);

  const projectUrl = mailConfig.appBaseUrl
    ? `${mailConfig.appBaseUrl.replace(/\/+$/, '')}/grid`
    : '';

  const textLines = [greeting, '', 'You were assigned a new issue.', '', `Project: ${projectName}`, `Date: ${input.issueDate}`];
  if (input.assignedByName) textLines.push(`Assigned by: ${input.assignedByName}`);
  if (otherAssignees.length > 0) textLines.push(`Also assigned: ${otherAssignees.join(', ')}`);
  textLines.push('', input.issueText);
  if (projectUrl) {
    textLines.push('', `Open the project tracker: ${projectUrl}`);
  }
  textLines.push('', '— Project Tracker (automated message, please do not reply)');

  const safeGreeting = escapeHtml(greeting);
  const safeProject = escapeHtml(projectName);
  const safeDate = escapeHtml(input.issueDate);
  const safeText = escapeHtml(input.issueText).replace(/\r?\n/g, '<br />');
  const assignedByRow = input.assignedByName
    ? `<tr><td style="padding:2px 12px 2px 0"><strong>Assigned by</strong></td><td>${escapeHtml(input.assignedByName)}</td></tr>`
    : '';
  const alsoRow =
    otherAssignees.length > 0
      ? `<tr><td style="padding:2px 12px 2px 0"><strong>Also assigned</strong></td><td>${escapeHtml(otherAssignees.join(', '))}</td></tr>`
      : '';
  const linkLine = projectUrl
    ? `<p><a href="${escapeHtml(projectUrl)}">Open the project tracker</a></p>`
    : '';

  const html = [
    `<p>${safeGreeting}</p>`,
    '<p>You were assigned a new issue.</p>',
    '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">',
    `<tr><td style="padding:2px 12px 2px 0"><strong>Project</strong></td><td>${safeProject}</td></tr>`,
    `<tr><td style="padding:2px 12px 2px 0"><strong>Date</strong></td><td>${safeDate}</td></tr>`,
    assignedByRow,
    alsoRow,
    '</table>',
    `<p style="white-space:pre-wrap">${safeText}</p>`,
    linkLine,
    '<p style="color:#666;font-size:12px">Project Tracker — automated message, please do not reply.</p>',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, text: textLines.join('\n'), html };
}

// Exposed for unit tests.
export const __test = { escapeHtml, toSubjectLine };
