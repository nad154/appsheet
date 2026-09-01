import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolves .env relative to THIS file's directory, ignoring process.cwd()
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value === 'change-me' || value === 'change-me-password') {
    throw new Error(`Missing/invalid required env: ${name}. Copy .env.example to .env and set a real value.`);
  }
  return value;
}

export const NODE_ENV = process.env.NODE_ENV ?? 'development';

export const authConfig = {
  accessSecret: requireEnv('JWT_ACCESS_SECRET'),
  refreshSecret: requireEnv('JWT_REFRESH_SECRET'),
  accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  refreshTtlMs: Number(process.env.JWT_REFRESH_TTL_MS ?? 1000 * 60 * 60 * 24 * 30),
};
