// start-safe.js
// Boots the built server after recovering from an unclean shutdown.
//
// Playwright (and any force-kill) can terminate the server without a graceful
// checkpoint, leaving app.duckdb.wal behind. Most WALs replay fine, but DuckDB
// 1.4.x cannot replay one containing ALTER TABLE entries and aborts the native
// binding. wal-guard.js probes the WAL in a child process and quarantines it
// only when it is genuinely un-replayable, so a normal WAL is still replayed
// instead of being discarded.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { recoverStaleWal } from './wal-guard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

recoverStaleWal();

await import(pathToFileURL(path.resolve(__dirname, '../dist/server.js')).href);
