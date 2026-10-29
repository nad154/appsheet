import { test, expect } from '@playwright/test';
import { scrollGridTo } from './helpers';

async function login(page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

// The add-form tests create fixed-name projects that the staff-scoping test
// later relies on. Delete leftovers from a previous run first so re-running the
// suite without a reseed does not accumulate duplicate rows (which would break
// the `getByText(name)` assertions below with a strict-mode violation).
async function deleteProjectsByName(page, names: string[]) {
  const token = await page.evaluate(() => localStorage.getItem('tracker.accessToken'));
  const headers = { Authorization: `Bearer ${token}` };
  const res = await page.request.get('/api/projects?page_size=500', { headers });
  expect(res.ok()).toBeTruthy();
  const rows = (await res.json()).rows as Array<{ id: string; project_name: string }>;
  for (const row of rows) {
    if (names.includes(row.project_name)) {
      const del = await page.request.delete(`/api/projects/${row.id}`, { headers });
      expect(del.ok()).toBeTruthy();
    }
  }
}

test('admin sees all projects and role-aware nav', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');

  await expect(page).toHaveURL(/\/grid/);
  await expect(page.getByRole('heading', { name: 'Project Grid' })).toBeVisible();
  await scrollGridTo(page, 'Admin Project A');
  await expect(page.getByText('Admin Project A', { exact: true })).toBeVisible();
  await scrollGridTo(page, 'Staff Project B');
  await expect(page.getByText('Staff Project B', { exact: true })).toBeVisible();

  // Role-aware nav: the Approvals link is gone (updates apply immediately);
  // SUPER_ADMIN keeps Settings, and the role badge is shown.
  await expect(page.getByRole('link', { name: 'Approvals' })).toHaveCount(0);
  // Removed: Drive Browser nav item (moved to UNUSED_DRIVE.md)
  await expect(page.getByRole('link', { name: 'Drive Browser' })).toHaveCount(0);
  await expect(page.getByTestId('user-role-badge')).toHaveText('(SUPER_ADMIN)');
});

test('admin can see PIC, Issues and Aging columns in the grid', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');
  await expect(page).toHaveURL(/\/grid/);

  await expect(page.getByRole('columnheader', { name: 'Responsible PIC' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Action' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Aging' })).toBeVisible();
});

test('admin can create a project with Sales and PIC via the add form', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');
  await expect(page).toHaveURL(/\/grid/);
  await deleteProjectsByName(page, ['E2E PIC Issues Project', 'E2E PIC Only Project']);

  await page.getByRole('button', { name: 'Add project' }).click();

  await page.getByLabel(/Project Name/).fill('E2E PIC Issues Project');
  await page.getByLabel(/Sales/).selectOption({ label: 'Staff One' });
  await page
    .getByRole('group', { name: 'Responsible PIC' })
    .getByRole('checkbox', { name: 'Staff One' })
    .check();

  // Issues is no longer part of the add form — it's logged exclusively through
  // the SUPER_ADMIN-only Issues modal (add endpoint), never via create/update.
  await expect(page.getByLabel(/Action/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByText('Project created.', { exact: true })).toBeVisible();
  await scrollGridTo(page, 'E2E PIC Issues Project');
  await expect(page.getByText('E2E PIC Issues Project', { exact: true })).toBeVisible();
});

test('admin can create a project with only a Responsible PIC', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');
  await expect(page).toHaveURL(/\/grid/);
  await deleteProjectsByName(page, ['E2E PIC Only Project']);

  await page.getByRole('button', { name: 'Add project' }).click();

  // Sales intentionally left unassigned — the PIC alone must grant the staff
  // member visibility on the project.
  await page.getByLabel(/Project Name/).fill('E2E PIC Only Project');
  await page
    .getByRole('group', { name: 'Responsible PIC' })
    .getByRole('checkbox', { name: 'Staff One' })
    .check();
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByText('Project created.', { exact: true })).toBeVisible();
  await scrollGridTo(page, 'E2E PIC Only Project');
  await expect(page.getByText('E2E PIC Only Project', { exact: true })).toBeVisible();
});

test('admin can change the assigned Sales for an existing project inline', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');
  await expect(page).toHaveURL(/\/grid/);

  const adminRow = page.getByText('Admin Project A', { exact: true });
  await scrollGridTo(page, 'Admin Project A');
  await expect(adminRow).toBeVisible();

  const row = adminRow.locator('xpath=ancestor::div[@role="row"]');
  const salesButton = row.locator('button[title="Edit staff_assigned_id"]');
  await salesButton.click();
  await page.getByLabel('Edit staff_assigned_id').selectOption({ label: 'Staff One' });
  await page.getByLabel('Edit staff_assigned_id').press('Enter');

  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await expect(row.getByText('Staff One', { exact: true })).toBeVisible();

  // Reassign it back to the admin so the staff-scoping test below still holds
  // (STAFF must not see projects owned by the admin).
  await row.locator('button[title="Edit staff_assigned_id"]').click();
  await page.getByLabel('Edit staff_assigned_id').selectOption({ label: 'Admin' });
  await page.getByLabel('Edit staff_assigned_id').press('Enter');
  await expect(row.getByText('Admin', { exact: true })).toBeVisible();
});

test('staff sees a read-only Sales cell with no dropdown affordance', async ({ page }) => {
  await login(page, 'staff1@example.com', 'staff12345');
  await expect(page).toHaveURL(/\/grid/);

  const staffRow = page.getByText('Staff Project A', { exact: true });
  const row = staffRow.locator('xpath=ancestor::div[@role="row"]');
  await expect(row.locator('button[title="Edit staff_assigned_id"]')).toHaveCount(0);
});

test('staff sees only their assigned projects and no approvals nav', async ({ page }) => {
  await login(page, 'staff1@example.com', 'staff12345');

  await expect(page).toHaveURL(/\/grid/);
  await expect(page.getByText('Staff Project A', { exact: true })).toBeVisible();
  await expect(page.getByText('Staff Project B', { exact: true })).toBeVisible();
  // Projects where the staff member is only the Responsible PIC are visible too.
  await expect(page.getByText('E2E PIC Only Project', { exact: true })).toBeVisible();

  // STAFF must NOT see projects assigned to the admin.
  await expect(page.getByText('Admin Project A', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Admin Project B', { exact: true })).toHaveCount(0);

  // STAFF must NOT see the SUPER_ADMIN-only nav links.
  await expect(page.getByRole('link', { name: 'Approvals' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
});

test('login with wrong password shows an error and stays on login', async ({ page }) => {
  await login(page, 'admin@example.com', 'wrong-password');
  await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
