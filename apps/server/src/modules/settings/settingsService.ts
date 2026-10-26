import argon2 from 'argon2';
import { runWrite, runRead } from '../../db/connection.js';
import { uuid } from '../../lib/uuid.js';
import { exportSnapshots } from '../../db/export.js';
import { revokeAllSessionsForUser } from '../auth/authService.js';
import { invalidateAgingThresholdsCache } from './agingThresholdsCache.js';
import type { AuthUser } from '../../middleware/requireAuth.js';
import {
  agingThresholdsSchema,
  marketSegmentCreateSchema,
  marketSegmentUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
  DEFAULT_AGING_LOW_MAX_DAYS,
  DEFAULT_AGING_MEDIUM_MAX_DAYS,
} from '@tracker/shared';
import type {
  AgingThresholds,
  MarketSegment,
  MarketSegmentCreate,
  MarketSegmentUpdate,
  MarketSegmentUsage,
  PublicUser,
  User,
  UserCreate,
  UserUpdate,
  UserUsage,
} from '@tracker/shared';

export class SettingsError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'SettingsError';
  }
}

interface MarketSegmentRow extends MarketSegment {
  [key: string]: unknown;
}

interface UserRow extends User {
  [key: string]: unknown;
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    is_active: row.is_active,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Market segments (soft-delete via is_active — projects reference them by label)
// ---------------------------------------------------------------------------

export async function listMarketSegments(): Promise<MarketSegment[]> {
  const rows = await runRead<MarketSegmentRow>(
    `SELECT * FROM market_segments ORDER BY sort_order ASC, label ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    is_active: r.is_active,
    sort_order: r.sort_order,
  }));
}

export async function createMarketSegment(rawPayload: unknown): Promise<{ id: string }> {
  const payload = marketSegmentCreateSchema.parse(rawPayload);
  const id = uuid();

  await runWrite(async (ex) => {
    const existing = await ex<{ id: string }>(`SELECT id FROM market_segments WHERE label = ?`, [
      payload.label,
    ]);
    if (existing.length > 0) {
      throw new SettingsError('A market segment with this label already exists', 409);
    }
    const sortOrder = payload.sort_order ?? 0;
    await ex(
      `INSERT INTO market_segments (id, label, is_active, sort_order) VALUES (?, ?, true, ?)`,
      [id, payload.label, sortOrder],
    );
  });

  return { id };
}

export async function updateMarketSegment(id: string, rawPayload: unknown): Promise<void> {
  const payload = marketSegmentUpdateSchema.parse(rawPayload);
  if (Object.keys(payload).length === 0) {
    throw new SettingsError('No changes to apply', 400);
  }

  await runWrite(async (ex) => {
    const existing = await ex<MarketSegmentRow>(`SELECT * FROM market_segments WHERE id = ?`, [id]);
    if (existing.length === 0) {
      throw new SettingsError('Market segment not found', 404);
    }
    if (payload.label && payload.label !== existing[0].label) {
      const dup = await ex<{ id: string }>(`SELECT id FROM market_segments WHERE label = ? AND id != ?`, [
        payload.label,
        id,
      ]);
      if (dup.length > 0) {
        throw new SettingsError('A market segment with this label already exists', 409);
      }
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    if (payload.label !== undefined) {
      sets.push('label = ?');
      values.push(payload.label);
    }
    if (payload.is_active !== undefined) {
      sets.push('is_active = ?');
      values.push(payload.is_active);
    }
    if (payload.sort_order !== undefined) {
      sets.push('sort_order = ?');
      values.push(payload.sort_order);
    }
    values.push(id);
    await ex(`UPDATE market_segments SET ${sets.join(', ')} WHERE id = ?`, values);
  });
}

/**
 * Permanent delete for a market segment. Only allowed once the segment has been
 * deactivated (two-step gate, enforced here rather than only in the UI).
 *
 * Projects store the segment as plain text (`projects.market_segment` is a
 * VARCHAR with no FK), so deleting the lookup row never mutates project data —
 * existing rows keep their label, mirroring the customers/vendors orphan
 * convention. `getMarketSegmentUsage` reports how many projects carry it.
 */
export async function getMarketSegmentUsage(id: string): Promise<MarketSegmentUsage> {
  const rows = await runRead<{ label: string }>(
    `SELECT label FROM market_segments WHERE id = ?`,
    [id],
  );
  const segment = rows[0];
  if (!segment) {
    throw new SettingsError('Market segment not found', 404);
  }

  const [countRow] = await runRead<{ count: number | bigint }>(
    `SELECT count(*) AS count FROM projects WHERE market_segment = ?`,
    [segment.label],
  );
  return { projects: Number(countRow?.count ?? 0) };
}

export async function deleteMarketSegment(id: string): Promise<void> {
  await runWrite(async (ex) => {
    const existing = await ex<{ id: string; is_active: boolean }>(
      `SELECT id, is_active FROM market_segments WHERE id = ?`,
      [id],
    );
    if (existing.length === 0) {
      throw new SettingsError('Market segment not found', 404);
    }
    if (existing[0].is_active) {
      throw new SettingsError('Deactivate the market segment first, then delete it permanently', 409);
    }

    // market_segments is operational/config data — not exported to parquet.
    await ex(`DELETE FROM market_segments WHERE id = ?`, [id]);
  });
}

// ---------------------------------------------------------------------------
// Users (SUPER_ADMIN manages roles and active status)
// ---------------------------------------------------------------------------

export async function listUsers(): Promise<PublicUser[]> {
  const rows = await runRead<UserRow>(
    `SELECT id, name, email, role, is_active, created_at FROM users ORDER BY name ASC`,
  );
  return rows.map(toPublicUser);
}

export async function createUser(rawPayload: unknown): Promise<{ id: string }> {
  const payload: UserCreate = userCreateSchema.parse(rawPayload);
  const id = uuid();

  await runWrite(async (ex) => {
    const existing = await ex<{ id: string }>(`SELECT id FROM users WHERE lower(email) = lower(?)`, [
      payload.email,
    ]);
    if (existing.length > 0) {
      throw new SettingsError('A user with this email already exists', 409);
    }
    const passwordHash = await argon2.hash(payload.password);
    await ex(
      `INSERT INTO users (id, name, email, password_hash, role, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, true, current_timestamp)`,
      [id, payload.name, payload.email.toLowerCase(), passwordHash, payload.role],
    );
  });

  await exportSnapshots(['users']);
  return { id };
}

export async function updateUser(id: string, rawPayload: unknown, caller: AuthUser): Promise<void> {
  const payload: UserUpdate = userUpdateSchema.parse(rawPayload);
  if (Object.keys(payload).length === 0) {
    throw new SettingsError('No changes to apply', 400);
  }

  // An admin must not be able to lock themselves out by deactivating/demoting
  // their own account — there is no public recovery path.
  if (id === caller.id && payload.is_active === false) {
    throw new SettingsError('You cannot deactivate your own account', 400);
  }
  if (id === caller.id && payload.role && payload.role !== caller.role) {
    throw new SettingsError('You cannot change your own role', 400);
  }

  const wasActive = await runWrite(async (ex) => {
    const existing = await ex<UserRow>(
      `SELECT id, name, email, role, is_active, created_at FROM users WHERE id = ?`,
      [id],
    );
    if (existing.length === 0) {
      throw new SettingsError('User not found', 404);
    }
    const user = existing[0];

    if (payload.email && payload.email.toLowerCase() !== user.email.toLowerCase()) {
      const dup = await ex<{ id: string }>(
        `SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?`,
        [payload.email, id],
      );
      if (dup.length > 0) {
        throw new SettingsError('A user with this email already exists', 409);
      }
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    if (payload.name !== undefined) {
      sets.push('name = ?');
      values.push(payload.name);
    }
    if (payload.email !== undefined) {
      sets.push('email = ?');
      values.push(payload.email.toLowerCase());
    }
    if (payload.role !== undefined) {
      sets.push('role = ?');
      values.push(payload.role);
    }
    if (payload.is_active !== undefined) {
      sets.push('is_active = ?');
      values.push(payload.is_active);
    }
    values.push(id);
    await ex(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);

    return user.is_active;
  });

  // Deactivating a user must immediately revoke their refresh sessions so their
  // tokens stop working right away (spec: offboarding kills the session now).
  if (wasActive && payload.is_active === false) {
    await revokeAllSessionsForUser(id);
  }

  await exportSnapshots(['users']);
}

/**
 * Impact of permanently deleting a user: how many projects reference them as
 * the assigned staff member / PIC, plus how many logged issues name them as the
 * assignee. Shown in the Settings confirmation modal before the delete.
 */
export async function getUserUsage(id: string): Promise<UserUsage> {
  const existing = await runRead<{ id: string }>(`SELECT id FROM users WHERE id = ?`, [id]);
  if (existing.length === 0) {
    throw new SettingsError('User not found', 404);
  }

  const [row] = await runRead<{
    projects_assigned: number | bigint;
    projects_pic: number | bigint;
    issue_assignments: number | bigint;
  }>(
    `SELECT
       (SELECT count(*) FROM projects WHERE staff_assigned_id = ?) AS projects_assigned,
       (SELECT count(*) FROM projects WHERE pic_id = ?) AS projects_pic,
       (SELECT count(*) FROM project_issues WHERE assignee_id = ?) AS issue_assignments`,
    [id, id, id],
  );

  return {
    projects_assigned: Number(row?.projects_assigned ?? 0),
    projects_pic: Number(row?.projects_pic ?? 0),
    issue_assignments: Number(row?.issue_assignments ?? 0),
  };
}

/**
 * Permanent delete for a user. Only allowed once the user has been deactivated
 * (two-step gate, enforced here rather than only in the UI).
 *
 * Per-user operational rows are removed with the account. Project assignments
 * (`projects.staff_assigned_id` / `pic_id`) and the audit trail
 * (`project_updates` / `project_issues`) are intentionally left dangling: the
 * grid flags those rows as "(deleted user)" so a SUPER_ADMIN can reassign them,
 * and the history keeps its entries (joined LEFT, so the name is just null).
 */
export async function deleteUser(id: string, caller: AuthUser): Promise<void> {
  // Same lockout reasoning as self-deactivation: there is no recovery path, and
  // this delete is irreversible.
  if (id === caller.id) {
    throw new SettingsError('You cannot delete your own account', 400);
  }

  await runWrite(async (ex) => {
    const existing = await ex<{ id: string; is_active: boolean }>(
      `SELECT id, is_active FROM users WHERE id = ?`,
      [id],
    );
    if (existing.length === 0) {
      throw new SettingsError('User not found', 404);
    }
    if (existing[0].is_active) {
      throw new SettingsError('Deactivate the user first, then delete them permanently', 409);
    }

    await ex(`DELETE FROM sessions WHERE user_id = ?`, [id]);
    await ex(`DELETE FROM notifications WHERE recipient_id = ?`, [id]);
    await ex(`DELETE FROM dashboard_views WHERE user_id = ?`, [id]);
    await ex(`DELETE FROM user_preferences WHERE user_id = ?`, [id]);
    await ex(`DELETE FROM users WHERE id = ?`, [id]);
  });

  // users.parquet is exported from v_users_public (never the raw table, so no
  // password_hash can leak into the snapshot).
  await exportSnapshots(['users']);
}

// ---------------------------------------------------------------------------
// Aging thresholds (singleton row, SUPER_ADMIN only, not part of parquet export)
// ---------------------------------------------------------------------------

export async function getAgingThresholds(): Promise<AgingThresholds> {
  const rows = await runRead<{ low_max_days: number; medium_max_days: number }>(
    `SELECT low_max_days, medium_max_days FROM aging_thresholds WHERE id = 'default'`,
  );
  const row = rows[0];
  return row
    ? { low_max_days: row.low_max_days, medium_max_days: row.medium_max_days }
    : { low_max_days: DEFAULT_AGING_LOW_MAX_DAYS, medium_max_days: DEFAULT_AGING_MEDIUM_MAX_DAYS };
}

export async function updateAgingThresholds(rawPayload: unknown, caller: AuthUser): Promise<void> {
  const payload = agingThresholdsSchema.parse(rawPayload);
  await runWrite(async (ex) => {
    await ex(
      `UPDATE aging_thresholds SET low_max_days = ?, medium_max_days = ?, updated_by = ?, updated_at = current_timestamp
       WHERE id = 'default'`,
      [payload.low_max_days, payload.medium_max_days, caller.id],
    );
  });
  // Priority is computed from these thresholds on every project-list request;
  // drop the memoized value so the next read sees the new settings.
  invalidateAgingThresholdsCache();
}

export type { MarketSegmentCreate, MarketSegmentUpdate, UserCreate, UserUpdate };