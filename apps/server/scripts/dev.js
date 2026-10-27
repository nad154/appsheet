// dev.js
// Entry point for `npm run dev`.
//
// Recovers from an un-replayable DuckDB WAL (see wal-guard.js) and then boots
// the TypeScript server. Run through tsx so the .ts import below is transpiled.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { recoverStaleWal } from './wal-guard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

recoverStaleWal();

await import(pathToFileURL(path.resolve(__dirname, '../src/server.ts')).href);
