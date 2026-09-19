import { runWrite, runRead, PARQUET_DIR } from './connection.js';
import type { QueryResult } from './connection.js';
import path from 'node:path';

const parquetPath = (file: string) => path.join(PARQUET_DIR, file).replace(/\\/g, '/');

type ExportableTable =
  | 'projects'
  | 'project_updates'
  | 'project_issues'
  | 'users'
  | 'customers'
  | 'vendors'
  | 'project_vendors';

/**
 * Re-export the parquet snapshot(s) for the given tables. Must be called
 * inside (or after) the same runWrite block that committed a write, so the
 * portable snapshot never gets out of sync with the live DuckDB file.
 *
 * users.parquet is exported from v_users_public — a view that EXCLUDES
 * password_hash — never from the raw users table.
 */
export async function exportSnapshots(tables: ExportableTable[]): Promise<void> {
  const copyStatements: Record<ExportableTable, string> = {
    projects: `COPY projects TO '${parquetPath('projects.parquet')}' (FORMAT PARQUET)`,
    project_updates: `COPY project_updates TO '${parquetPath('project_updates.parquet')}' (FORMAT PARQUET)`,
    project_issues: `COPY project_issues TO '${parquetPath('project_issues.parquet')}' (FORMAT PARQUET)`,
    users: `COPY v_users_public TO '${parquetPath('users.parquet')}' (FORMAT PARQUET)`,
    customers: `COPY customers TO '${parquetPath('customers.parquet')}' (FORMAT PARQUET)`,
    vendors: `COPY vendors TO '${parquetPath('vendors.parquet')}' (FORMAT PARQUET)`,
    project_vendors: `COPY project_vendors TO '${parquetPath('project_vendors.parquet')}' (FORMAT PARQUET)`,
  };

  for (const table of tables) {
    const stmt = copyStatements[table];
    if (!stmt) continue;
    await runWrite(async (exec) => {
      await exec(stmt);
    });
  }
}

export async function readSnapshot<T extends QueryResult>(
  file: 'projects.parquet' | 'project_updates.parquet' | 'project_issues.parquet' | 'users.parquet' | 'customers.parquet' | 'vendors.parquet' | 'project_vendors.parquet',
): Promise<T[]> {
  const p = parquetPath(file);
  return runRead<T>(`SELECT * FROM read_parquet('${p}')`);
}