import { runWrite, runRead, PARQUET_DIR } from './connection.js';
import { exportSnapshots } from './export.js';
import { DEFAULT_AGING_LOW_MAX_DAYS, DEFAULT_AGING_MEDIUM_MAX_DAYS } from '@tracker/shared';
import fs from 'node:fs';
import path from 'node:path';
import { uuid } from '../lib/uuid.js';

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

-- Customer lookup table. Referenced by id from projects.customer_id.
-- Real DELETE is allowed — orphans resolve to NULL via LEFT JOIN (plan §3.4).
CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Vendor lookup table. Referenced by id from project_vendors.vendor_id.
-- Real DELETE is allowed — same orphan convention as customers.
CREATE TABLE IF NOT EXISTS vendors (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR PRIMARY KEY,
  folder_name VARCHAR,
  project_name VARCHAR NOT NULL,
  staff_assigned_id VARCHAR,          -- FK dropped: DuckDB can't UPDATE FK-target tables
  drive_folder_id VARCHAR,
  customer_id VARCHAR,                -- references customers.id (no FK constraint — DuckDB UPDATE limitation)
  market_segment VARCHAR,
  service_or_goods VARCHAR CHECK (service_or_goods IN ('service','goods')),
  date_customer_received_doc1 DATE,
  date_customer_received_doc2 DATE,
  doc2_number_id VARCHAR,
  customer_price INTEGER,
  customer_start_contract DATE,
  customer_end_contract DATE,
  current_stage VARCHAR CHECK (current_stage IN ('on_progress','finish')) DEFAULT 'on_progress',
  pic_id VARCHAR,
  issues VARCHAR,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- One row per vendor line on a project. All "Vendor Section" fields moved here
-- from projects during the one-time migration (plan §4).
CREATE TABLE IF NOT EXISTS project_vendors (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL,
  vendor_id VARCHAR NOT NULL,
  vendor_type VARCHAR CHECK (vendor_type IN ('service','goods')),
  vendor_revenue INTEGER,
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
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS project_updates (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL,        -- FK dropped, same convention as other tables
  staff_id VARCHAR NOT NULL,          -- FK dropped
  changes_json VARCHAR NOT NULL,      -- JSON: { [field]: { old: unknown, new: unknown } }
  update_progress VARCHAR NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Logged issues, one row per issue. projects.issues keeps the latest issue
-- text denormalized (single writer — the add-issue endpoint — so it never
-- drifts). created_by is the SUPER_ADMIN who logged it; NULL only for legacy
-- backfilled rows. assignee_id is the STAFF the issue is attached to.
CREATE TABLE IF NOT EXISTS project_issues (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL,        -- FK dropped, same convention as other tables
  issue_text VARCHAR NOT NULL,
  issue_date DATE NOT NULL,
  assignee_id VARCHAR,                -- FK dropped
  created_by VARCHAR,                 -- FK dropped
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR PRIMARY KEY,
  user_id VARCHAR NOT NULL,           -- FK dropped
  refresh_token_hash VARCHAR NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR PRIMARY KEY,
  recipient_id VARCHAR NOT NULL,      -- FK dropped
  type VARCHAR NOT NULL CHECK (type IN ('NEW_APPROVAL','AGING_ALERT')),
  project_id VARCHAR,                 -- FK dropped
  pending_edit_id VARCHAR,            -- FK dropped
  message VARCHAR NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Per-user dashboard views. Operational/config data — NEVER exported to parquet.
-- metric_key / stage_filter / year_filter defaults keep existing rows
-- (created before this migration) displaying as plain "all"/count charts.
CREATE TABLE IF NOT EXISTS dashboard_views (
  id VARCHAR PRIMARY KEY,
  user_id VARCHAR NOT NULL,           -- FK dropped, DuckDB UPDATE limitation
  chart_type VARCHAR NOT NULL CHECK (chart_type IN ('pie','bar')),
  column_key VARCHAR NOT NULL,
  metric_key VARCHAR NOT NULL DEFAULT 'count',
  stage_filter VARCHAR NOT NULL DEFAULT 'all',
  year_filter INTEGER,                -- NULL = all creation years
  label VARCHAR NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

-- Singleton aging→priority thresholds row (id is always 'default').
-- Operational/config data — NEVER exported to parquet.
CREATE TABLE IF NOT EXISTS aging_thresholds (
  id VARCHAR PRIMARY KEY,
  low_max_days INTEGER NOT NULL,
  medium_max_days INTEGER NOT NULL,
  updated_by VARCHAR,                 -- FK dropped
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

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
  await migrateDashboardViewColumns();
  await dropPendingEdits();
  await seedAgingThresholds();
  await importLegacySnapshots();
  await dropUploadedDocColumns();
  await migrateCustomersAndVendors();
  await migrateProjectIssues();
}

/**
 * One-time migration: the pending_edits approval queue no longer exists.
 * Safe to run on every startup — a no-op once the table is gone.
 */
async function dropPendingEdits(): Promise<void> {
  if (await tableExists('pending_edits')) {
    await runWrite(async (exec) => {
      await exec(`DROP TABLE pending_edits`);
    });
  }
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await runRead<{ column_name: string }>(
    `SELECT column_name FROM duckdb_columns() WHERE table_name = ? AND column_name = ?`,
    [table, column],
  );
  return rows.length > 0;
}

/**
 * The uploaded-document feature was removed entirely. Drop the two now-unused
 * projects columns (data loss of the stored drive references is intended).
 * Runs AFTER importLegacySnapshots so a fresh boot importing a legacy parquet
 * that still contains these columns matches the table shape; the additive
 * migration above then gets cleaned up here. Safe on every startup — no-op
 * once the columns are gone.
 */
async function dropUploadedDocColumns(): Promise<void> {
  let altered = false;
  for (const column of ['uploaded_doc_id', 'uploaded_doc_name']) {
    if (await columnExists('projects', column)) {
      await runWrite(async (exec) => {
        await exec(`ALTER TABLE projects DROP COLUMN ${column}`);
      });
      altered = true;
    }
  }
  if (altered) {
    await exportSnapshots(['projects']);
  }
}

async function migrateColumns(): Promise<void> {
  const additions: Array<{ table: string; column: string; type: string }> = [
    // customer_id links to the customers lookup table. Added additively here so
    // a pre-existing projects table (where CREATE TABLE IF NOT EXISTS is a
    // no-op) gets the column before migrateCustomersAndVendors fills it.
    { table: 'projects', column: 'customer_id', type: 'VARCHAR' },
    { table: 'projects', column: 'pic_id', type: 'VARCHAR' },
    { table: 'projects', column: 'issues', type: 'VARCHAR' },
    { table: 'projects', column: 'uploaded_doc_id', type: 'VARCHAR' },
    { table: 'projects', column: 'uploaded_doc_name', type: 'VARCHAR' },
  ];

  // PIC used to be a free-text string. Migrate it to pic_id (a user UUID) by
  // renaming the column and clearing old values — a free-text name cannot be
  // mapped to a user deterministically.
  const hasPic = await columnExists('projects', 'pic');
  const hasPicId = await columnExists('projects', 'pic_id');
  if (hasPic && !hasPicId) {
    await runWrite(async (exec) => {
      await exec(`ALTER TABLE projects RENAME COLUMN pic TO pic_id`);
      await exec(`UPDATE projects SET pic_id = NULL`);
    });
  }

  let altered = hasPic;
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

/**
 * Additive migration for dashboard_views: bar-chart metric, stage filter and
 * year filter. dashboard_views is operational/config data that is NEVER
 * exported to parquet, so no exportSnapshots call here. Safe on every startup.
 *
 * NOTE: DuckDB can't express `ADD COLUMN … NOT NULL DEFAULT …` (it parses the
 * constraint but won't apply additive columns with constraints), so the new
 * columns are plain VARCHAR/INTEGER. The service normalises NULL → default
 * ('count' / 'all' / null) at read time, so legacy rows behave identically.
 */
async function migrateDashboardViewColumns(): Promise<void> {
  const additions: Array<{ column: string; type: string }> = [
    { column: 'metric_key', type: 'VARCHAR' },
    { column: 'stage_filter', type: 'VARCHAR' },
    { column: 'year_filter', type: 'INTEGER' },
  ];
  for (const { column, type } of additions) {
    if (!(await columnExists('dashboard_views', column))) {
      await runWrite(async (exec) => {
        await exec(`ALTER TABLE dashboard_views ADD COLUMN ${column} ${type}`);
      });
    }
  }
}

/**
 * Seed the singleton aging_thresholds row ('default') with the shared default
 * constants on first boot. No-op once the row exists so admin edits persist.
 * Not part of the parquet export contract.
 */
async function seedAgingThresholds(): Promise<void> {
  const rows = await runRead<{ id: string }>(`SELECT id FROM aging_thresholds WHERE id = 'default'`);
  if (rows.length === 0) {
    await runWrite(async (exec) => {
      await exec(
        `INSERT INTO aging_thresholds (id, low_max_days, medium_max_days, updated_at)
         VALUES ('default', ?, ?, current_timestamp)`,
        [DEFAULT_AGING_LOW_MAX_DAYS, DEFAULT_AGING_MEDIUM_MAX_DAYS],
      );
    });
  }
}

async function importLegacySnapshots(): Promise<void> {
  const mapping: Record<string, { table: string; transform?: string }> = {
    'projects.parquet': { table: 'projects' },
    'project_updates.parquet': { table: 'project_updates' },
    'project_issues.parquet': { table: 'project_issues' },
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

/**
 * One-time migration: extract customers and vendors from free-text fields on
 * projects into their own lookup tables, and move the vendor section fields
 * into project_vendors (planning_customers_vendors §4).
 *
 * Guarded the same way migrateColumns guards its PIC rename: check whether
 * projects.customer_name still exists. If so, run the migration and drop the
 * old columns; if not, this is a no-op. Data is moved idempotently — re-
 * running won't duplicate rows or lose data.
 */
async function migrateCustomersAndVendors(): Promise<void> {
  const hasCustomerName = await columnExists('projects', 'customer_name');
  if (!hasCustomerName) return; // already migrated

  console.log('Migrating customers and vendors from free-text to lookup tables…');

  // Customer name → id map (dedupe by name)
  const customerNameToId = new Map<string, string>();
  // Vendor name → id map (dedupe by name)
  const vendorNameToId = new Map<string, string>();

  await runWrite(async (exec) => {
    // 1. Collect distinct non-null customer names
    const custRows = await exec<{ customer_name: string }>(
      `SELECT DISTINCT customer_name FROM projects WHERE customer_name IS NOT NULL AND customer_name != ''`,
    );
    for (const row of custRows) {
      const id = uuid();
      customerNameToId.set(row.customer_name, id);
      await exec(
        `INSERT INTO customers (id, name, created_at) VALUES (?, ?, current_timestamp)`,
        [id, row.customer_name],
      );
    }

    // 2. Collect distinct non-null vendor names
    const vendRows = await exec<{ vendor_name: string }>(
      `SELECT DISTINCT vendor_name FROM projects WHERE vendor_name IS NOT NULL AND vendor_name != ''`,
    );
    for (const row of vendRows) {
      const id = uuid();
      vendorNameToId.set(row.vendor_name, id);
      await exec(
        `INSERT INTO vendors (id, name, created_at) VALUES (?, ?, current_timestamp)`,
        [id, row.vendor_name],
      );
    }

    // 3. For each project row: set customer_id, insert a project_vendors row
    //    if vendor_name was non-null, then drop the old columns.
    const projectRows = await exec<{ id: string; customer_name: string | null; vendor_name: string | null }>(
      `SELECT id, customer_name, vendor_name FROM projects`,
    );

    for (const p of projectRows) {
      const sets: string[] = [];
      const values: unknown[] = [];

      // Set customer_id from map (skip null/empty)
      if (p.customer_name && customerNameToId.has(p.customer_name)) {
        sets.push('customer_id = ?');
        values.push(customerNameToId.get(p.customer_name));
      }

      if (sets.length > 0) {
        values.push(p.id);
        await exec(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, values);
      }

      // Insert a project_vendors row if there was a vendor name
      if (p.vendor_name && vendorNameToId.has(p.vendor_name)) {
        await exec(
          `INSERT INTO project_vendors (
            id, project_id, vendor_id, vendor_type, vendor_revenue,
            project_sent_date, project_finish_date, vendor_project_id,
            negotiation_date, approval_date, document_sent_date, document_id,
            vendor_price, vendor_start_contract, vendor_end_contract,
            sort_order, created_at, updated_at
          ) SELECT ?, p.id, ?, p.vendor_type, p.vendor_revenue,
                   p.project_sent_date, p.project_finish_date, p.vendor_project_id,
                   p.negotiation_date, p.approval_date, p.document_sent_date, p.document_id,
                   p.vendor_price, p.vendor_start_contract, p.vendor_end_contract,
                   0, p.created_at, p.updated_at
            FROM projects p WHERE p.id = ?`,
          [uuid(), vendorNameToId.get(p.vendor_name), p.id],
        );
      }
    }

    // 4. Drop the migrated columns from projects
    const colsToDrop = [
      'customer_name', 'vendor_name', 'vendor_revenue', 'vendor_type',
      'project_sent_date', 'project_finish_date', 'vendor_project_id',
      'negotiation_date', 'approval_date', 'document_sent_date', 'document_id',
      'vendor_price', 'vendor_start_contract', 'vendor_end_contract',
    ];
    for (const col of colsToDrop) {
      if (await columnExists('projects', col)) {
        await exec(`ALTER TABLE projects DROP COLUMN ${col}`);
      }
    }
  });

  await exportSnapshots(['projects', 'customers', 'vendors', 'project_vendors']);
  console.log('Customer/vendor migration complete.');
}

/**
 * One-time backfill: seed project_issues from the legacy projects.issues
 * column so pre-feature issue text is preserved in history. Runs AFTER
 * importLegacySnapshots (so a legacy projects.parquet is loaded first) and
 * after migrateCustomersAndVendors. Idempotent — a project only gets a row
 * when it has a non-empty issues value AND no project_issues row yet. The
 * projects.issues column stays as the always-synced "latest issue text",
 * written by the issues module.
 */
async function migrateProjectIssues(): Promise<void> {
  // DuckDB's driver returns TIMESTAMP columns as Date objects (or ISO strings)
  // depending on the row path — normalize defensively before slicing the date.
  const toDateIso = (v: unknown): string =>
    v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

  const legacy = await runRead<{ id: string; issues: string | null; created_at: unknown }>(
    `SELECT id, issues, created_at FROM projects
     WHERE issues IS NOT NULL AND issues != ''
       AND id NOT IN (SELECT DISTINCT project_id FROM project_issues)`,
  );
  if (legacy.length === 0) return;

  await runWrite(async (exec) => {
    for (const row of legacy) {
      await exec(
        `INSERT INTO project_issues (id, project_id, issue_text, issue_date, assignee_id, created_by, created_at)
         VALUES (?, ?, ?, ?, NULL, NULL, current_timestamp)`,
        // The issue date is the DATE column — pass the YYYY-MM-DD slice of created_at.
        [uuid(), row.id, row.issues, toDateIso(row.created_at)],
      );
    }
  });
  await exportSnapshots(['project_issues']);
}

export async function tableExists(name: string): Promise<boolean> {
  const rows = await runRead<{ table_name: string }>(
    `SELECT table_name FROM duckdb_tables() WHERE table_name = ?`,
    [name],
  );
  return rows.length > 0;
}