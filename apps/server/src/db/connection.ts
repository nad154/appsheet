// apps/server/src/db/connection.ts
import duckdb from 'duckdb';
import { Mutex } from 'async-mutex';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = path.resolve(__dirname, '../../data');
export const PARQUET_DIR = path.join(DATA_DIR, 'parquet');
export const DB_PATH = path.join(DATA_DIR, 'app.duckdb');

fs.mkdirSync(PARQUET_DIR, { recursive: true });

const writeMutex = new Mutex();

export interface QueryResult {
  [key: string]: unknown;
}

let db: duckdb.Database;
let conn: duckdb.Connection;

const ready: Promise<void> = new Promise((resolve, reject) => {
  db = new duckdb.Database(DB_PATH, (err) => {
    if (err) {
      reject(
        new Error(
          `Failed to open DuckDB database at ${DB_PATH}: ${err.message}. ` +
            `DuckDB only allows one process to hold a read/write connection to ` +
            `a given file at a time — this almost always means another process ` +
            `("npm run dev:server", "npm run start", "npm run seed", a Playwright ` +
            `webServer, or a DB browser) already has it open. Stop that process ` +
            `and try again.`,
        ),
      );
      return;
    }
    try {
      conn = db.connect();
      resolve();
    } catch (connectErr) {
      reject(connectErr as Error);
    }
  });
});

async function execute<T extends QueryResult>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ready;
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

export async function runWrite<T>(
  worker: (exec: typeof execute) => Promise<T>,
): Promise<T> {
  await ready;
  return writeMutex.runExclusive(async () => {
    const result = await worker(execute);
    return result;
  });
}

export async function runRead<T extends QueryResult>(sql: string, params: unknown[] = []): Promise<T[]> {
  return execute<T>(sql, params);
}

// Checkpoint and close database safely
let closing = false;

// export async function closeDb(): Promise<void> {
//   if (closing) return;
//   closing = true;

//   if (!conn || !db) return;

//   await writeMutex.runExclusive(async () => {
//     // 1. Force DuckDB to commit WAL entries into app.duckdb and delete .wal
//     await execStatement('CHECKPOINT;').catch((err) => {
//       // eslint-disable-next-line no-console
//       console.error('Failed to run CHECKPOINT prior to shutdown:', err);
//     });

//     // 2. Close Connection
//     await new Promise<void>((resolve) => {
//       try {
//         conn.close(() => resolve());
//       } catch {
//         resolve();
//       }
//     });

//     // 3. Close Database
//     await new Promise<void>((resolve) => {
//       try {
//         db.close(() => resolve());
//       } catch {
//         resolve();
//       }
//     });
//   });
// }

export async function closeDb(): Promise<void> {
  if (closing) return;
  closing = true;

  await ready;

  if (!conn || !db) return;

  await writeMutex.runExclusive(async () => {
    console.log('Checkpointing DuckDB...');

    try {
      await execStatement('CHECKPOINT');
    } catch (err) {
      console.error('CHECKPOINT failed:', err);
    }

    console.log('Closing DuckDB connection...');

    await new Promise<void>((resolve) => {
      conn.close(() => {
        console.log('DuckDB connection closed.');
        resolve();
      });
    });

    console.log('Closing DuckDB database...');

    await new Promise<void>((resolve) => {
      db.close(() => {
        console.log('DuckDB database closed.');
        resolve();
      });
    });
  });
}

export { conn, db };