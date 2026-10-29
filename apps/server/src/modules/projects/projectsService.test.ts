// Unit tests for the PIC rules. The DB and parquet layers are mocked: these
// assert the validation contract (dedupe, cap, active-user requirement) that
// the API relies on, without opening app.duckdb.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runRead = vi.fn();

vi.mock('../../db/connection.js', () => ({
  runRead: (...args: unknown[]) => runRead(...args),
  runWrite: vi.fn(),
  // export.ts builds its COPY statements at module load from this constant.
  PARQUET_DIR: 'C:/tmp/parquet',
}));

vi.mock('../../db/export.js', () => ({
  exportSnapshots: vi.fn(),
}));

import { assertStaffOwnership, assertValidPics, ProjectWriteError } from './projectsService.js';
import type { AuthUser } from '../../middleware/requireAuth.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeEach(() => {
  runRead.mockReset();
});

describe('assertValidPics', () => {
  it('accepts an empty set without querying users', async () => {
    await expect(assertValidPics([])).resolves.toEqual([]);
    expect(runRead).not.toHaveBeenCalled();
  });

  it('de-duplicates while preserving caller order and queries only active staff/admins', async () => {
    runRead.mockResolvedValue([{ id: id(2) }, { id: id(1) }]);

    await expect(assertValidPics([id(1), id(2), id(1)])).resolves.toEqual([id(1), id(2)]);

    expect(runRead).toHaveBeenCalledTimes(1);
    const [sql, params] = runRead.mock.calls[0];
    expect(sql).toContain('is_active = true');
    expect(sql).toContain("role IN ('STAFF','SUPER_ADMIN')");
    // Duplicates are collapsed before hitting the DB.
    expect(params).toEqual([id(1), id(2)]);
  });

  it('rejects more than 20 PICs before touching the database', async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => id(i + 1));

    await expect(assertValidPics(tooMany)).rejects.toMatchObject({
      message: 'At most 20 PICs per project',
      statusCode: 400,
    });
    expect(runRead).not.toHaveBeenCalled();
  });

  it('allows exactly 20 PICs', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => id(i + 1));
    runRead.mockResolvedValue(twenty.map((picId) => ({ id: picId })));

    await expect(assertValidPics(twenty)).resolves.toEqual(twenty);
  });

  it('rejects a PIC that is not an active STAFF/SUPER_ADMIN user', async () => {
    // The detail query only returns the active ids, so id(2) is inactive,
    // deleted, or not a user at all.
    runRead.mockResolvedValue([{ id: id(1) }]);

    await expect(assertValidPics([id(1), id(2)])).rejects.toBeInstanceOf(ProjectWriteError);
    await expect(assertValidPics([id(1), id(2)])).rejects.toMatchObject({
      message: 'Every Responsible PIC must be an active user',
      statusCode: 400,
    });
  });
});

describe('assertStaffOwnership', () => {
  const staff = { id: id(9), role: 'STAFF' } as unknown as AuthUser;
  const admin = { id: id(9), role: 'SUPER_ADMIN' } as unknown as AuthUser;

  it('lets a STAFF member edit a project where they are the Sales', () => {
    expect(() => assertStaffOwnership(staff, { staff_assigned_id: id(9) }, {})).not.toThrow();
  });

  it('lets a STAFF member edit a project where they are one of the PICs', () => {
    expect(() =>
      assertStaffOwnership(staff, { staff_assigned_id: id(1), pics: [{ id: id(2) }, { id: id(9) }] }, {}),
    ).not.toThrow();
  });

  it('rejects a STAFF member who is neither Sales nor a PIC', () => {
    expect(() =>
      assertStaffOwnership(staff, { staff_assigned_id: id(1), pics: [{ id: id(2) }] }, {}),
    ).toThrow(/not assigned to/);
  });

  it('rejects a STAFF member reassigning Sales to someone else', () => {
    expect(() =>
      assertStaffOwnership(staff, { staff_assigned_id: id(9), pics: [] }, { staff_assigned_id: id(1) }),
    ).toThrow(/reassign/);
  });

  it('never restricts SUPER_ADMIN', () => {
    expect(() =>
      assertStaffOwnership(admin, { staff_assigned_id: id(1), pics: [] }, { staff_assigned_id: id(2) }),
    ).not.toThrow();
  });
});
