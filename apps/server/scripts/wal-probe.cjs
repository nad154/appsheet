// wal-probe.cjs
// Child-process probe used by wal-guard.js.
//
// It opens the DuckDB database (which makes DuckDB replay app.duckdb.wal) and
// reports the result as JSON on stdout. This MUST run out of process: when the
// WAL cannot be replayed the native binding aborts with an access violation
// (0xC0000005 on Windows) instead of throwing a catchable JS error.
const duckdb = require('duckdb');

const dbPath = process.argv[2];

function report(payload, code) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(code);
}

try {
  const db = new duckdb.Database(dbPath, (err) => {
    if (err) {
      report({ ok: false, message: err.message }, 1);
      return;
    }
    report({ ok: true }, 0);
  });
} catch (err) {
  report({ ok: false, message: err instanceof Error ? err.message : String(err) }, 1);
}
