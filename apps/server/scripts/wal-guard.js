// wal-guard.js
// Startup guard for app.duckdb's write-ahead log.
//
// DuckDB 1.4.x cannot replay a WAL that contains ALTER TABLE entries — opening
// the database then fails with:
//
//   INTERNAL Error: Failure while replaying WAL file "...": Calling
//   DatabaseManager::GetDefaultDatabase with no default database set
//
// and the native binding aborts the process (0xC0000005 on Windows) instead of
// surfacing a JS error. A single crash during a migration therefore makes the
// database unopenable on every later boot.
//
// The fix has two halves, and this is the second one:
//   1. db/migrate.ts ends with CHECKPOINT, so ALTER TABLE never survives in the
//      WAL once the app is up.
//   2. This guard probes the DB in a child process before the server opens it.
//      If the WAL is replayable it is left alone (DuckDB replays it normally).
//      If it is un-replayable it is quarantined as app.duckdb.wal.crashed-<ts>
//      so the app can still boot. Only writes since the last checkpoint are
//      lost — the .duckdb file itself is consistent.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const dataDir = path.resolve(__dirname, '../data');
export const dbPath = path.join(dataDir, 'app.duckdb');
export const walPath = path.join(dataDir, 'app.duckdb.wal');
const probePath = path.join(__dirname, 'wal-probe.cjs');

const PROBE_TIMEOUT_MS = 60_000;
const CRASHED_WAL_PREFIX = 'app.duckdb.wal.crashed-';
const KEEP_CRASHED_WALS = 5;

/** Failure modes that mean the WAL itself is un-replayable. */
const UNREPLAYABLE = [
  /replaying WAL file/i,
  /GetDefaultDatabase with no default database set/i,
  // node-duckdb sometimes surfaces a failed WAL replay as an empty
  // "Invalid Error: " instead of the INTERNAL error above.
  /^invalid error:/i,
];

/** Failure modes that mean another process owns the database. */
const LOCKED = [
  /Could not set lock/i,
  /Conflicting lock/i,
  /being used by another process/i,
  /database is locked/i,
];

function probe(dbFile) {
  // The probe can die without producing output (native crash), so treat a null
  // status or a crash exit code as "un-replayable", not as "fine".
  const result = spawnSync(process.execPath, [probePath, dbFile], {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
  });
  let payload;
  try {
    payload = JSON.parse(result.stdout || '{}');
  } catch {
    payload = {};
  }
  return { status: result.status, signal: result.signal, payload };
}

function quarantineWal() {
  const crashed = path.join(dataDir, `${CRASHED_WAL_PREFIX}${Date.now()}`);
  fs.renameSync(walPath, crashed);
  return crashed;
}

function pruneCrashedWals() {
  try {
    const files = fs
      .readdirSync(dataDir)
      .filter((f) => f.startsWith(CRASHED_WAL_PREFIX) || f.startsWith('app.duckdb.wal.probe-'))
      .sort();
    for (const stale of files.slice(0, Math.max(0, files.length - KEEP_CRASHED_WALS))) {
      fs.rmSync(path.join(dataDir, stale), { force: true });
    }
  } catch {
    // Best effort — never block startup on cleanup.
  }
}

/**
 * Make sure app.duckdb can be opened, recovering from an un-replayable WAL.
 * Exits the process with a clear message when the database is genuinely in use.
 */
export function recoverStaleWal() {
  fs.mkdirSync(path.join(dataDir, 'parquet'), { recursive: true });
  pruneCrashedWals();

  if (!fs.existsSync(walPath)) return;

  // A WAL without its database cannot be replayed into anything — park it and
  // let the next open create a fresh database.
  if (!fs.existsSync(dbPath)) {
    const crashed = quarantineWal();
    console.warn(
      `[wal-guard] Found ${path.basename(walPath)} without app.duckdb; moved it to ` +
        `${path.basename(crashed)} and starting from a fresh database.`,
    );
    return;
  }

  const { status, payload } = probe(dbPath);

  if (status === 0) {
    console.log('[wal-guard] app.duckdb.wal is replayable; leaving it in place.');
    return;
  }

  const message = payload && payload.message ? String(payload.message) : '';

  if (LOCKED.some((re) => re.test(message))) {
    console.error(
      `[wal-guard] Cannot start: another process already holds ${dbPath}.\n` +
        `Stop it (another "npm run dev:server", "npm run start", "npm run seed", ` +
        `a Playwright webServer, or a DB browser) and try again.`,
    );
    process.exit(1);
  }

  const walUnreadable = !message || UNREPLAYABLE.some((re) => re.test(message));
  if (!walUnreadable) {
    console.error(`[wal-guard] Cannot open ${dbPath}: ${message}`);
    process.exit(1);
  }

  const crashed = quarantineWal();
  console.warn(
    `[wal-guard] app.duckdb.wal could not be replayed (${message || 'native crash during replay'}).\n` +
      `[wal-guard] Moved it to ${path.basename(crashed)}; writes since the last checkpoint are lost, ` +
      `the database file itself is intact.`,
  );
}
