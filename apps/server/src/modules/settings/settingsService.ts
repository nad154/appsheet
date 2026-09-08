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
  PublicUser,
  User,
  UserCreate,
  UserUpdate,
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