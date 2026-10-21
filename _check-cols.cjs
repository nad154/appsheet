// Probe: report the live money-column types without disturbing the running
// server's WAL. Opens a COPY of the main .duckdb file (no .wal) read-only.
const duckdb = require('duckdb');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const src = 'apps/server/data/app.duckdb';
const copy = path.join(os.tmpdir(), `opencode-probe-${Date.now()}.duckdb`);
fs.copyFileSync(src, copy);

const db = new duckdb.Database(copy, { access_mode: 'READ_ONLY' });
db.all(
  "SELECT table_name, column_name, data_type FROM duckdb_columns() WHERE column_name IN ('customer_price','vendor_revenue','vendor_price') ORDER BY table_name, column_name",
  (e, r) => {
    if (e) {
      console.error('ERR', e.message);
      process.exit(1);
    }
    console.log(JSON.stringify(r));
    db.close(() => {
      try { fs.unlinkSync(copy); } catch {}
      process.exit(0);
    });
  },
);
