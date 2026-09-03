import { runWrite, runRead, PARQUET_DIR } from './connection.js';
import { exportSnapshots } from './export.js';
import fs from 'node:fs';
import path from 'node:path';

// Schema DDL. All ids are app-generated UUID strings (DuckDB has no native
// uuid() default), provided explicitly on insert. No DEFAULT uuid() here.
const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  email VARCHAR NOT NULL UNIQUE,
  password_hash VARCHAR NOT NULL,
  role VARCHAR NOT NULL CHECK (role IN ('SUPER_ADMIN','STAFF')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS market_segments (
  id VARCHAR PRIMARY KEY,
  label VARCHAR NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR PRIMARY KEY,
  folder_name VARCHAR,
  project_name VARCHAR NOT NULL,
  staff_assigned_id VARCHAR REFERENCES users(id),
  drive_folder_id VARCHAR,

  -- Customer section
  customer_name VARCHAR,
  market_segment VARCHAR,
  service_or_goods VARCHAR CHECK (service_or_goods IN ('service','goods')),
  date_customer_received_doc1 DATE,
  date_customer_received_doc2 DATE,
  doc2_number_id VARCHAR,
  customer_price INTEGER,
  customer_start_contract DATE,
  customer_end_contract DATE,

  -- Vendor section
  vendor_name VARCHAR,
  vendor_revenue INTEGER,
  vendor_type VARCHAR CHECK (vendor_type IN ('service','goods')),
  project_sent_date DATE,
  project_finish_date DATE,
  vendor_project_id VARCHAR,
  negotiation_date DATE,
  approval_date DATE,
  document_sent_date DATE,
  document_id VARCHAR,
  vendor_price INTEGER,
  vendor_start_contract DATE,
  vendor_end_contract DATE,
  current_stage VARCHAR CHECK (current_stage IN ('on_progress','finish')) DEFAULT 'on_progress',

  -- PIC / Issues
  pic VARCHAR,
  issues VARCHAR,

  -- Metadata
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS pending_edits (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id),
  requested_by VARCHAR NOT NULL REFERENCES users(id),
  edit_type VARCHAR NOT NULL CHECK (edit_type IN ('CREATE','UPDATE')),
  changes_json VARCHAR NOT NULL,
  status VARCHAR NOT NULL CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
  reviewed_by VARCHAR REFERENCES users(id),
  review_note VARCHAR,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  reviewed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR PRIMARY KEY,
  user_id VARCHAR NOT NULL REFERENCES users(id),
  refresh_token_hash VARCHAR NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR PRIMARY KEY,
  recipient_id VARCHAR NOT NULL REFERENCES users(id),
  type VARCHAR NOT NULL CHECK (type IN ('NEW_APPROVAL','AGING_ALERT')),
  project_id VARCHAR REFERENCES projects(id),
  pending_edit_id VARCHAR REFERENCES pending_edits(id),
  message VARCHAR NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- users.parquet must never include password_hash; export from this view.
CREATE OR REPLACE VIEW v_users_public AS
  SELECT id, name, email, role, is_active, created_at FROM users;
`;

/**
 * Idempotent schema bootstrap. Safe to run on every startup: CREATE TABLE IF
 * NOT EXISTS is a no-op once the tables exist. Also imports legacy parquet
 * snapshots into the corresponding tables on first boot, when a table is
 * empty and a matching .parquet file exists in apps/server/data/parquet.
 */
export async function migrate(): Promise<void> {
  await runWrite(async (exec) => {
    await exec(DDL);
  });

  await migrateColumns();
  await importLegacySnapshots();
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await runRead<{ column_name: string }>(
    `SELECT column_name FROM duckdb_columns() WHERE table_name = ? AND column_name = ?`,
    [table, column],
  );
  return rows.length > 0;
}

async function migrateColumns(): Promise<void> {
  const additions: Array<{ table: string; column: string; type: string }> = [
    { table: 'projects', column: 'pic', type: 'VARCHAR' },
    { table: 'projects', column: 'issues', type: 'VARCHAR' },
  ];

  let altered = false;
  for (const { table, column, type } of additions) {
    if (!(await columnExists(table, column))) {
      await runWrite(async (exec) => {
        await exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      });
      altered = true;
    }
  }

  if (altered) {
    await exportSnapshots(['projects']);
  }
}

async function importLegacySnapshots(): Promise<void> {
  const mapping: Record<string, { table: string; transform?: string }> = {
    'projects.parquet': { table: 'projects' },
    'pending_edits.parquet': { table: 'pending_edits' },
    // users.parquet is exported from v_users_public which EXCLUDES password_hash.
    // Never import it — users must be created by the seed script with proper hashes.
  };

  for (const [file, { table, transform }] of Object.entries(mapping)) {
    const filePath = path.join(PARQUET_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    const [{ count }] = await runRead<{ count: number }>(
      `SELECT count(*) AS count FROM ${table}`,
    );
    if (count !== 0) continue;

    // Only import on first boot when the table is empty.
    await runWrite(async (exec) => {
      await exec(`INSERT INTO ${table} SELECT * FROM read_parquet('${filePath.replace(/\\/g, '/')}')`);
    });
  }
}

export async function tableExists(name: string): Promise<boolean> {
  const rows = await runRead<{ name: string }>(
    `SELECT name FROM duckdb_tables() WHERE name = ?`,
    [name],
  );
  return rows.length > 0;
}
