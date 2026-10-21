// One-shot: run migrations against the live DB then checkpoint+close cleanly,
// so the BIGINT widening is committed without leaving a WAL behind.
process.env.MOVE_WAL = '1';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, 'apps/server/data');
const wal = path.join(dataDir, 'app.duckdb.wal');
if (fs.existsSync(wal)) {
  fs.renameSync(wal, path.join(dataDir, `app.duckdb.wal.probe-${Date.now()}`));
  console.log('[probe] moved stale WAL');
}

const { migrate } = await import('./apps/server/dist/db/migrate.js');
const { closeDb, runRead } = await import('./apps/server/dist/db/connection.js');

await migrate();

const cols = await runRead(
  "SELECT table_name, column_name, data_type FROM duckdb_columns() WHERE column_name IN ('customer_price','vendor_revenue','vendor_price') ORDER BY table_name, column_name",
);
console.log('COLS', JSON.stringify(cols));

await closeDb();
process.exit(0);
