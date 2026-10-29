// Email is best-effort: it runs after the issue has committed, so a mail
// failure (or a bad recipient) must never throw and must never stop the other
// recipients from being notified. Each failure is logged on one line.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runReadMock, sendMailMock, isMailEnabledMock } = vi.hoisted(() => ({
  runReadMock: vi.fn(),
  sendMailMock: vi.fn(),
  isMailEnabledMock: vi.fn(),
}));

vi.mock('../../db/connection.js', () => ({
  runRead: (...args: unknown[]) => runReadMock(...args),
  runWrite: vi.fn(),
  PARQUET_DIR: 'C:/tmp/parquet',
}));

vi.mock('./mailer.js', () => ({
  sendMail: (...args: unknown[]) => sendMailMock(...args),
}));

vi.mock('./config.js', () => ({
  isMailEnabled: () => isMailEnabledMock(),
  // The template reads appBaseUrl; empty = no "open tracker" link.
  mailConfig: { appBaseUrl: '' },
}));

import { notifyIssueAssignees } from './issueNotifications.js';

const input = {
  issueId: 'issue-1',
  projectName: 'Website Revamp',
  issueText: 'Customer asked for a new landing page.',
  issueDate: '2026-10-29',
  assigneeIds: ['u1', 'u2'],
  assignedByName: 'Admin',
};

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  runReadMock.mockReset();
  sendMailMock.mockReset();
  isMailEnabledMock.mockReset();
  isMailEnabledMock.mockReturnValue(true);
  sendMailMock.mockResolvedValue(true);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('notifyIssueAssignees', () => {
  it('does nothing when email is disabled', async () => {
    isMailEnabledMock.mockReturnValue(false);

    await notifyIssueAssignees(input);

    expect(runReadMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('does nothing when the issue has no assignees', async () => {
    await notifyIssueAssignees({ ...input, assigneeIds: [] });

    expect(runReadMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('emails each active recipient, skips blank addresses, and names the other assignees', async () => {
    runReadMock.mockResolvedValue([
      { id: 'u1', name: 'Staff One', email: 'staff1@example.com' },
      { id: 'u2', name: 'Budi', email: 'budi@example.com' },
      { id: 'u3', name: 'No Email', email: '  ' },
    ]);

    await notifyIssueAssignees(input);

    expect(sendMailMock).toHaveBeenCalledTimes(2);
    const first = sendMailMock.mock.calls[0][0];
    expect(first.to).toBe('staff1@example.com');
    expect(first.subject).toBe('[Project Tracker] Issue assigned: Website Revamp');
    expect(first.text).toContain('Hello Staff One,');
    expect(first.text).toContain('Also assigned: Budi, No Email');
    expect(first.text).toContain('Assigned by: Admin');

    const second = sendMailMock.mock.calls[1][0];
    expect(second.to).toBe('budi@example.com');
    expect(second.text).toContain('Also assigned: Staff One, No Email');
    // Never list the recipient as "also assigned".
    expect(second.text).not.toContain('Also assigned: Budi');
  });

  it('keeps sending after one recipient fails and logs the failure', async () => {
    runReadMock.mockResolvedValue([
      { id: 'u1', name: 'Staff One', email: 'staff1@example.com' },
      { id: 'u2', name: 'Budi', email: 'budi@example.com' },
    ]);
    sendMailMock.mockRejectedValueOnce(new Error('relay refused')).mockResolvedValueOnce(true);

    await expect(notifyIssueAssignees(input)).resolves.toBeUndefined();

    expect(sendMailMock).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toBe(
      'issue-email failed issue=issue-1 to=staff1@example.com reason=relay refused',
    );
  });

  it('logs and returns when the recipient lookup fails', async () => {
    runReadMock.mockRejectedValue(new Error('db closed'));

    await expect(notifyIssueAssignees(input)).resolves.toBeUndefined();

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(String(errorSpy.mock.calls[0][0])).toBe(
      'issue-email failed issue=issue-1 to=<lookup> reason=db closed',
    );
  });
});
