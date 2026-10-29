// Unit tests for the issue-assignee rules: the pool is the project's Sales +
// PICs, every assignee must be active, duplicates collapse and the cap is 20.
// The DB and email layers are mocked so no DuckDB file is opened and nothing is
// ever sent.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runRead = vi.fn();

vi.mock('../../db/connection.js', () => ({
  runRead: (...args: unknown[]) => runRead(...args),
  runWrite: vi.fn(),
  PARQUET_DIR: 'C:/tmp/parquet',
}));

vi.mock('../../db/export.js', () => ({
  exportSnapshots: vi.fn(),
}));

vi.mock('../mail/issueNotifications.js', () => ({
  notifyIssueAssignees: vi.fn(),
}));

import { assertIssueAssignees, IssuesError } from './issuesService.js';
import { MAX_ISSUE_ASSIGNEES } from '@tracker/shared';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * Wire the three reads assertIssueAssignees performs, in order:
 * the project's Sales, its PIC users, then the active users among the ids.
 */
function mockDb(opts: {
  sales?: string | null;
  pics?: string[];
  active?: string[];
  projectExists?: boolean;
}) {
  const { sales = null, pics = [], active = [], projectExists = true } = opts;
  runRead.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM projects')) {
      return projectExists ? [{ staff_assigned_id: sales }] : [];
    }
    if (sql.includes('FROM project_pics')) {
      return pics.map((userId) => ({ user_id: userId }));
    }
    if (sql.includes('FROM users')) {
      return active.map((userId) => ({ id: userId }));
    }
    return [];
  });
}

beforeEach(() => {
  runRead.mockReset();
});

describe('assertIssueAssignees', () => {
  it('accepts no assignees without querying anything', async () => {
    await expect(assertIssueAssignees(id(100), [])).resolves.toEqual([]);
    expect(runRead).not.toHaveBeenCalled();
  });

  it('rejects more than 20 assignees before touching the database', async () => {
    const tooMany = Array.from({ length: MAX_ISSUE_ASSIGNEES + 1 }, (_, i) => id(i + 1));

    await expect(assertIssueAssignees(id(100), tooMany)).rejects.toMatchObject({
      message: `At most ${MAX_ISSUE_ASSIGNEES} assignees per issue`,
      statusCode: 400,
    });
    expect(runRead).not.toHaveBeenCalled();
  });

  it('de-duplicates while preserving caller order', async () => {
    mockDb({ sales: id(1), pics: [id(2)], active: [id(1), id(2)] });

    await expect(assertIssueAssignees(id(100), [id(2), id(1), id(2)])).resolves.toEqual([id(2), id(1)]);

    // The active-user lookup only receives the two unique ids.
    const usersCall = runRead.mock.calls.find(([sql]) => String(sql).includes('FROM users'));
    expect(usersCall?.[1]).toEqual([id(2), id(1)]);
  });

  it('allows both the Sales person and a PIC', async () => {
    mockDb({ sales: id(1), pics: [id(2)], active: [id(1), id(2)] });
    await expect(assertIssueAssignees(id(100), [id(1), id(2)])).resolves.toEqual([id(1), id(2)]);
  });

  it('rejects somebody who is neither the Sales nor a PIC', async () => {
    mockDb({ sales: id(1), pics: [id(2)], active: [id(1), id(2), id(3)] });

    await expect(assertIssueAssignees(id(100), [id(1), id(3)])).rejects.toMatchObject({
      message: 'Issue assignees must be the project’s Sales or PICs',
      statusCode: 400,
    });
  });

  it('rejects a Sales/PIC who has been deactivated', async () => {
    // id(2) is a PIC but is no longer in the active-user result.
    mockDb({ sales: id(1), pics: [id(2)], active: [id(1)] });

    await expect(assertIssueAssignees(id(100), [id(1), id(2)])).rejects.toMatchObject({
      message: 'Every issue assignee must be an active user',
      statusCode: 400,
    });
  });

  it('reports a missing project as 404', async () => {
    mockDb({ projectExists: false });

    await expect(assertIssueAssignees(id(100), [id(1)])).rejects.toBeInstanceOf(IssuesError);
    await expect(assertIssueAssignees(id(100), [id(1)])).rejects.toMatchObject({
      message: 'Project not found',
      statusCode: 404,
    });
  });
});
