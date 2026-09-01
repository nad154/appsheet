import { runWrite, runRead, PARQUET_DIR } from './connection.js';
import type { QueryResult } from './connection.js';
import path from 'node:path';

const parquetPath = (file: string) => path.join(PARQUET_DIR, file).replace(/\\/g, '/');

/**
 * Re-export the parquet snapshot(s) for the given tables. Must be called
 * inside (or after) the same runWrite block that committed a write, so the
 * portable snapshot never gets out of sync with the live DuckDB file.
 *
 * users.parquet is exported from v_users_public — a view that EXCLUDES
 * password_hash — never from the raw users table.
 */
export async function exportSnapshots(tables: Array<'projects' | 'pending_edits' | 'users'>): Promise<void> {
  const copyStatements: Record<string, string> = {
    projects: `COPY projects TO '${parquetPath('projects.parquet')}' (FORMAT PARQUET)`,
    pending_edits: `COPY pending_edits TO '${parquetPath('pending_edits.parquet')}' (FORMAT PARQUET)`,
    users: `COPY v_users_public TO '${parquetPath('users.parquet')}' (FORMAT PARQUET)`,
  };

  for (const table of tables) {
    const stmt = copyStatements[table];
    if (!stmt) continue;
    await runWrite(async (exec) => {
      await exec(stmt);
    });
  }
}

export async function readSnapshot<T extends QueryResult>(file: 'projects.parquet' | 'pending_edits.parquet' | 'users.parquet'): Promise<T[]> {
  const p = parquetPath(file);
  return runRead<T>(`SELECT * FROM read_parquet('${p}')`);
}
