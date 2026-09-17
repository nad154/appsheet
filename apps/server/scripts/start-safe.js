// start-safe.js
// Boots the built server after recovering from an unclean shutdown.
//
// Playwright (and any force-kill) can terminate the server without a graceful
// checkpoint, which leaves an un-replayed app.duckdb.wal behind. Replaying that
// stale WAL on the next boot makes DuckDB crash (internal WAL-replay failure),
// so this launcher moves it aside first. The main .duckdb file is already
// consistent after a checkpoint; only the tail of writes since the last
// checkpoint is lost, which for fixtures/e2e is regenerated on reseed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
const walPath = path.join(dataDir, 'app.duckdb.wal');

if (fs.existsSync(walPath)) {
  const crashed = path.join(dataDir, `app.duckdb.wal.crashed-${Date.now()}`);
  try {
    fs.renameSync(walPath, crashed);
    // eslint-disable-next-line no-console
    console.log(`[start-safe] moved stale WAL to ${path.basename(crashed)} (recovered from unclean shutdown)`);
  } catch (err) {
    // The WAL may be locked by a still-running server; let the real open attempt
    // surface the proper "database in use" error instead.
    // eslint-disable-next-line no-console
    console.error('[start-safe] could not move stale WAL, continuing:', err instanceof Error ? err.message : err);
  }
}

await import(pathToFileURL(path.resolve(__dirname, '../dist/server.js')).href);