const fs = require('fs');
const path = require('path');
const dir = 'C:/user/storage file/opencode2/apps/server/data/parquet';
try {
  const files = fs.readdirSync(dir);
  console.log(files.join('\n'));
  for (const f of files) {
    const p = path.join(dir, f);
    const s = fs.statSync(p);
    console.log(f + ': ' + s.size);
  }
} catch (e) {
  console.log('ERR', e.message);
}
