import argon2 from 'argon2';
import { runWrite, runRead } from '../../db/connection.js';
import { uuid } from '../../lib/uuid.js';
import { authConfig } from './config.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from './tokens.js';
import type { Role, PublicUser } from '@tracker/shared';

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  [key: string]: unknown;
}

interface SessionData {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  expires_at: string;
  revoked: boolean;
  [key: string]: unknown;
}

export class AuthError extends Error {
  constructor(message: string, public statusCode = 401) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
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

export async function findUserById(id: string): Promise<UserRow | null> {
  const rows = await runRead<UserRow>(`SELECT * FROM users WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

export async function authenticate(email: string, password: string): Promise<AuthResult> {
  const rows = await runRead<UserRow>(
    `SELECT * FROM users WHERE lower(email) = lower(?)`,
    [email],
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    throw new AuthError('Invalid email or password');
  }

  let ok: boolean;
  try {
    ok = await argon2.verify(user.password_hash, password);
  } catch {
    throw new AuthError('Invalid email or password');
  }
  if (!ok) {
    throw new AuthError('Invalid email or password');
  }

  return issueSession(user);
}

async function issueSession(user: UserRow): Promise<AuthResult> {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + authConfig.refreshTtlMs).toISOString();
  const sessionId = uuid();

  await runWrite(async (ex) => {
    await ex(
      `INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, revoked)
       VALUES (?, ?, ?, ?, false)`,
      [sessionId, user.id, refreshTokenHash, expiresAt],
    );
  });

  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
  });

  return { accessToken, refreshToken, user: toPublicUser(user) };
}

export async function refresh(refreshToken: string): Promise<AuthResult> {
  const hash = hashRefreshToken(refreshToken);
  const rows = await runRead<SessionData>(
    `SELECT * FROM sessions WHERE refresh_token_hash = ?`,
    [hash],
  );
  const session = rows[0];
  if (!session || session.revoked) {
    throw new AuthError('Invalid refresh token');
  }
  if (new Date(session.expires_at).getTime() < Date.now()) {
    throw new AuthError('Refresh token expired');
  }

  const user = await findUserById(session.user_id);
  if (!user || !user.is_active) {
    throw new AuthError('Account unavailable');
  }

  // Rotate: revoke the used session and issue a fresh one.
  await runWrite(async (ex) => {
    await ex(`UPDATE sessions SET revoked = true WHERE id = ?`, [session.id]);
  });

  return issueSession(user);
}

export async function revokeSession(refreshToken: string): Promise<void> {
  const hash = hashRefreshToken(refreshToken);
  await runWrite(async (ex) => {
    await ex(`UPDATE sessions SET revoked = true WHERE refresh_token_hash = ?`, [hash]);
  });
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await runWrite(async (ex) => {
    await ex(`UPDATE sessions SET revoked = true WHERE user_id = ?`, [userId]);
  });
}
