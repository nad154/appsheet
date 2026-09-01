import duckdb from 'duckdb';
import { Mutex } from 'async-mutex';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// apps/server/data
export const DATA_DIR = path.resolve(__dirname, '../../data');
export const PARQUET_DIR = path.join(DATA_DIR, 'parquet');
export const DB_PATH = path.join(DATA_DIR, 'app.duckdb');

fs.mkdirSync(PARQUET_DIR, { recursive: true });

// Single shared connection for the whole process. DuckDB's Node bindings are
// safest with one writer at a time; all mutations go through runWrite() which
// serializes them behind a single in-process mutex. Reads share the same
// connection without locking (queries are fast at this scale).
const db = new duckdb.Database(DB_PATH);
const conn = db.connect();
const writeMutex = new Mutex();

export interface QueryResult {
  [key: string]: unknown;
}

// Core statement runner. Individual statements execute on the module-level
// connection; because writes are serialized by runWrite, a sequence of
// statements within one runWrite block behaves atomically (single connection,
// single writer).
// - Transaction control and DDL/DML without result rows use `exec`.
// - Queries that return rows use `all`.
async function execute<T extends QueryResult>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) {
    await execStatement(sql);
    return [];
  }
  return new Promise<T[]>((resolve, reject) => {
    (conn.all as (sql: string, ...args: unknown[]) => void)(sql, ...params, (err: Error | null, rows: T[]) => {
      if (err) reject(err);
      else resolve((rows ?? []) as T[]);
    });
  });
}

function execStatement(sql: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    (conn.exec as (sql: string, cb: (err: Error | null) => void) => void)(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Run a sequence of statements atomically (single writer). Every mutation in
 * the app must go through here. The worker receives an `exec` helper bound to
 * the shared connection; a worker may wrap statements in BEGIN/COMMIT.
 */
export async function runWrite<T>(
  worker: (exec: typeof execute) => Promise<T>,
): Promise<T> {
  return writeMutex.runExclusive(async () => {
    const result = await worker(execute);
    return result;
  });
}

/** Execute a read-only query without acquiring the write mutex. */
export async function runRead<T extends QueryResult>(sql: string, params: unknown[] = []): Promise<T[]> {
  return execute<T>(sql, params);
}

export { conn, db };
