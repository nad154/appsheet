import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { authConfig } from './config.js';
import type { Role } from '@tracker/shared';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  email: string;
  name: string;
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, authConfig.accessSecret, {
    expiresIn: authConfig.accessTtl as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, authConfig.accessSecret) as unknown as AccessTokenPayload;
}
