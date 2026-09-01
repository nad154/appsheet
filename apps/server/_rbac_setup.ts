import argon2 from 'argon2';
import { migrate } from './src/db/migrate.js';
import { runWrite, conn } from './src/db/connection.js';
import { uuid } from './src/lib/uuid.js';
import { exportSnapshots } from './src/db/export.js';

const STAFF_EMAIL = 'staff1@example.com';
const STAFF_ID = '11111111-1111-1111-1111-111111111111';

const NOW = '2026-08-01T10:00:00Z';

async function main(): Promise<void> {
  await migrate();

  await runWrite(async (ex) => {
    // Clear test data for deterministic assertions.
    await ex(`DELETE FROM projects`);
    await ex(`DELETE FROM pending_edits`);
    await ex(`DELETE FROM sessions`);
    await ex(`DELETE FROM users WHERE email = ?`, [STAFF_EMAIL]);

    const adminRows = await ex<{ id: string }>(`SELECT id FROM users WHERE email = ?`, ['admin@example.com']);
    const ADMIN_ID = adminRows[0].id;

    // Create staff user.
    const pass = await argon2.hash('staff12345');
    await ex(`INSERT INTO users (id, name, email, password_hash, role, is_active, created_at)
              VALUES (?, 'Staff One', ?, ?, 'STAFF', true, ?)`, [STAFF_ID, STAFF_EMAIL, pass, NOW]);

    // Projects: 2 for admin, 2 for staff.
    const projects = [
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Admin Project A', staff: ADMIN_ID, price: 100, deadline: '2026-09-15', stage: 'on_progress', updated: '2026-08-10T09:00:00Z' },
      { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Admin Project B', staff: ADMIN_ID, price: 200, deadline: '2027-01-01', stage: 'finish', updated: '2026-07-20T09:00:00Z' },
      { id: 'bbbbbbbb-0000-0000-0000-000000000001', name: 'Staff Project A', staff: STAFF_ID, price: 300, deadline: '2026-08-25', stage: 'on_progress', updated: '2026-08-15T09:00:00Z' },
      { id: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Staff Project B', staff: STAFF_ID, price: 50, deadline: '2026-12-05', stage: 'on_progress', updated: '2026-08-20T09:00:00Z' },
    ];
    for (const p of projects) {
      await ex(
        `INSERT INTO projects (id, project_name, staff_assigned_id, customer_price, customer_end_contract, current_stage, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, p.name, p.staff, p.price, p.deadline, p.stage, NOW, p.updated],
      );
    }
  });

  await exportSnapshots(['users', 'projects']);
  console.log('Test data ready.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => conn.close());
