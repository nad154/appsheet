const { spawn } = require('node:child_process');
const fs = require('node:fs');

const out = fs.openSync('C:/Users/Asus/AppData/Local/Temp/opencode/boot-out.log', 'w');
const err = fs.openSync('C:/Users/Asus/AppData/Local/Temp/opencode/boot-err.log', 'w');

const child = spawn(process.execPath, ['apps/server/scripts/start-safe.js'], {
  cwd: 'C:/user/storage file/opencode2',
  stdio: ['ignore', out, err],
});

// Give the server time to run migrations, then request a graceful shutdown so
// DuckDB checkpoints (committing the BIGINT alter) instead of leaving a WAL.
setTimeout(() => {
  child.kill('SIGINT');
}, 20000);

child.on('exit', (code, signal) => {
  console.log(`server exited code=${code} signal=${signal}`);
});
