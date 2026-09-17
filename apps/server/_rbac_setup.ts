import argon2 from 'argon2';
import { migrate } from './src/db/migrate.js';
import { runWrite, closeDb } from './src/db/connection.js';
import { uuid } from './src/lib/uuid.js';
import { exportSnapshots } from './src/db/export.js';

const STAFF_EMAIL = 'staff1@example.com';
const STAFF_ID = '11111111-1111-1111-1111-111111111111';

const NOW = '2026-08-01T10:00:00Z';
const SENT_30_DAYS_AGO = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

async function main(): Promise<void> {
  await migrate();

  await runWrite(async (ex) => {
    // Clear test data for deterministic assertions.
    await ex(`DELETE FROM project_vendors`);
    await ex(`DELETE FROM projects`);
    await ex(`DELETE FROM project_updates`);
    await ex(`DELETE FROM sessions`);
    await ex(`DELETE FROM users WHERE email = ?`, [STAFF_EMAIL]);
    await ex(`DELETE FROM customers`);
    await ex(`DELETE FROM vendors`);

    const adminRows = await ex<{ id: string }>(`SELECT id FROM users WHERE email = ?`, ['admin@example.com']);
    const ADMIN_ID = adminRows[0].id;

    // Create staff user.
    const pass = await argon2.hash('staff12345');
    await ex(`INSERT INTO users (id, name, email, password_hash, role, is_active, created_at)
              VALUES (?, 'Staff One', ?, ?, 'STAFF', true, ?)`, [STAFF_ID, STAFF_EMAIL, pass, NOW]);

    // Create a shared customer for the test fixtures.
    const customerId = uuid();
    await ex(`INSERT INTO customers (id, name, created_at) VALUES (?, 'Test Customer', ?)`, [customerId, NOW]);

    // Create a vendor for Staff Project A (so the priority spec can exercise
    // vendor-line fields via the modal).
    const vendorId = uuid();
    await ex(`INSERT INTO vendors (id, name, created_at) VALUES (?, 'Test Vendor', ?)`, [vendorId, NOW]);

    // Projects: 2 for admin, 2 for staff.
    const projects = [
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Admin Project A', staff: ADMIN_ID, price: 100, deadline: '2026-09-15', stage: 'on_progress', updated: '2026-08-10T09:00:00Z' },
      { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Admin Project B', staff: ADMIN_ID, price: 200, deadline: '2027-01-01', stage: 'finish', updated: '2026-07-20T09:00:00Z' },
      { id: 'bbbbbbbb-0000-0000-0000-000000000001', name: 'Staff Project A', staff: STAFF_ID, price: 300, deadline: '2026-08-25', stage: 'on_progress', updated: '2026-08-15T09:00:00Z', hasVendor: true },
      { id: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Staff Project B', staff: STAFF_ID, price: 50, deadline: '2026-12-05', stage: 'on_progress', updated: '2026-08-20T09:00:00Z' },
    ];
    for (const p of projects) {
      await ex(
        `INSERT INTO projects (id, project_name, staff_assigned_id, customer_id, customer_price, customer_end_contract, current_stage, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, p.name, p.staff, customerId, p.price, p.deadline, p.stage, NOW, p.updated],
      );
    }

    // Staff Project A gets a vendor line (for priority-spec vendor-field testing).
    const staffProjA = projects[2];
    if (staffProjA.hasVendor) {
      await ex(
        `INSERT INTO project_vendors (id, project_id, vendor_id, vendor_type, project_sent_date, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, 'service', ?, 0, ?, ?)`,
        [uuid(), staffProjA.id, vendorId, SENT_30_DAYS_AGO, NOW, NOW],
      );
    }
  });

  await exportSnapshots(['users', 'projects', 'customers', 'vendors', 'project_vendors']);
  console.log('Test data ready.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await closeDb(); });