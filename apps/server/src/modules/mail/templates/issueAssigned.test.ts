// The issue-assigned email is plain data: same input -> same subject/text/html.
// These cover the parts that protect recipients and readers — escaping, the
// optional link, and a single-line subject.
import { afterEach, describe, expect, it, vi } from 'vitest';

const MAIL_ENV = ['APP_BASE_URL', 'MAIL_DRIVER'];

async function loadTemplate(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const key of MAIL_ENV) vi.stubEnv(key, '');
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import('./issueAssigned.js');
}

const baseInput = {
  recipientName: 'Staff One',
  projectName: 'Website Revamp',
  issueText: 'Customer asked for a new landing page.',
  issueDate: '2026-10-29',
  assignedByName: 'Admin',
  otherAssignees: ['Budi'],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildIssueAssignedEmail', () => {
  it('builds the agreed subject, greeting, facts and no-reply footer', async () => {
    const { buildIssueAssignedEmail } = await loadTemplate();
    const built = buildIssueAssignedEmail(baseInput);

    expect(built.subject).toBe('[Project Tracker] Issue assigned: Website Revamp');
    expect(built.text).toContain('Hello Staff One,');
    expect(built.text).toContain('Project: Website Revamp');
    expect(built.text).toContain('Date: 2026-10-29');
    expect(built.text).toContain('Assigned by: Admin');
    expect(built.text).toContain('Also assigned: Budi');
    expect(built.text).toContain('Customer asked for a new landing page.');
    expect(built.text).toContain('please do not reply');
    // No APP_BASE_URL -> no link anywhere.
    expect(built.text).not.toContain('http');
    expect(built.html).not.toContain('<a ');
  });

  it('greets a recipient with no name generically and omits empty facts', async () => {
    const { buildIssueAssignedEmail } = await loadTemplate();
    const built = buildIssueAssignedEmail({
      recipientName: null,
      projectName: 'Website Revamp',
      issueText: 'Ping',
      issueDate: '2026-10-29',
      assignedByName: null,
      otherAssignees: [],
    });

    expect(built.text).toContain('Hello,');
    expect(built.text).not.toContain('Assigned by:');
    expect(built.text).not.toContain('Also assigned:');
  });

  it('adds the /grid link (trimming trailing slashes) when APP_BASE_URL is set', async () => {
    const { buildIssueAssignedEmail } = await loadTemplate({ APP_BASE_URL: 'https://tracker.example.com/' });
    const built = buildIssueAssignedEmail(baseInput);

    expect(built.text).toContain('https://tracker.example.com/grid');
    expect(built.text).not.toContain('https://tracker.example.com//grid');
    expect(built.html).toContain('href="https://tracker.example.com/grid"');
  });

  it('escapes HTML in every interpolated value', async () => {
    const { buildIssueAssignedEmail } = await loadTemplate();
    const built = buildIssueAssignedEmail({
      ...baseInput,
      recipientName: '<b>Staff</b>',
      projectName: 'A & B "Project"',
      issueText: '<script>alert("x")</script>\nsecond line',
      assignedByName: '<i>Admin</i>',
      otherAssignees: ['<b>Budi</b>'],
    });

    expect(built.html).not.toContain('<script>');
    expect(built.html).not.toContain('<b>Staff</b>');
    expect(built.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(built.html).toContain('A &amp; B &quot;Project&quot;');
    expect(built.html).toContain('&lt;i&gt;Admin&lt;/i&gt;');
    expect(built.html).toContain('&lt;b&gt;Budi&lt;/b&gt;');
    // Newlines become explicit breaks inside the pre-wrap paragraph.
    expect(built.html).toContain('<br />second line');
    // The text part stays human-readable (no HTML entities).
    expect(built.text).toContain('<script>alert("x")</script>');
  });

  it('keeps the subject on one line and caps its length', async () => {
    const { buildIssueAssignedEmail } = await loadTemplate();
    const spaced = buildIssueAssignedEmail({ ...baseInput, projectName: '  Multi\n   line\tname  ' });
    expect(spaced.subject).toBe('[Project Tracker] Issue assigned: Multi line name');

    const longName = 'X'.repeat(400);
    const capped = buildIssueAssignedEmail({ ...baseInput, projectName: longName });
    expect(capped.subject.length).toBeLessThanOrEqual(150);
    expect(capped.subject.endsWith('…')).toBe(true);
  });
});
