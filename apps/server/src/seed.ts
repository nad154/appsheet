import 'dotenv/config';
import argon2 from 'argon2';
import { migrate } from './db/migrate.js';
import { runWrite, runRead, conn } from './db/connection.js';
import { uuid } from './lib/uuid.js';
import { exportSnapshots } from './db/export.js';

// Read from env with sane defaults for local dev. Never accepts values from
// an open endpoint — this is a CLI-only bootstrap.
const adminName = process.env.SEED_ADMIN_NAME ?? 'Admin';
const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';

const DEFAULT_SEGMENTS = ['Government', 'Enterprise', 'SME', 'Individual'];

async function main(): Promise<void> {
  await migrate();

  await runWrite(async (exec) => {
    // Create the first SUPER_ADMIN if none exists.
    const existing = await exec<{ id: string }>(
      `SELECT id FROM users WHERE email = ?`,
      [adminEmail],
    );
    if (existing.length === 0) {
      const passwordHash = await argon2.hash(adminPassword);
      await exec(
        `INSERT INTO users (id, name, email, password_hash, role, is_active)
         VALUES (?, ?, ?, ?, 'SUPER_ADMIN', true)`,
        [uuid(), adminName, adminEmail, passwordHash],
      );
      // eslint-disable-next-line no-console
      console.log(`Created SUPER_ADMIN ${adminName} <${adminEmail}>`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`Admin ${adminEmail} already exists; skipping.`);
    }

    // Ensure default market segments exist.
    for (const [i, label] of DEFAULT_SEGMENTS.entries()) {
      const seg = await exec<{ id: string }>(`SELECT id FROM market_segments WHERE label = ?`, [label]);
      if (seg.length === 0) {
        await exec(
          `INSERT INTO market_segments (id, label, is_active, sort_order) VALUES (?, ?, true, ?)`,
          [uuid(), label, i],
        );
      }
    }
  });

  await exportSnapshots(['users']);
  // eslint-disable-next-line no-console
  console.log('Seed complete.');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    conn.close();
  });
