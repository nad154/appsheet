import { test, expect } from '@playwright/test';

async function login(page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

test('admin sees all projects and role-aware nav', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');

  await expect(page).toHaveURL(/\/grid/);
  await expect(page.getByRole('heading', { name: 'Project Grid' })).toBeVisible();
  await expect(page.getByText('Admin Project A', { exact: true })).toBeVisible();
  await expect(page.getByText('Staff Project B', { exact: true })).toBeVisible();

  // Role-aware nav: the Approvals link is gone (updates apply immediately);
  // SUPER_ADMIN keeps Settings + Drive Browser, and the role badge is shown.
  await expect(page.getByRole('link', { name: 'Approvals' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Drive Browser' })).toBeVisible();
  await expect(page.getByTestId('user-role-badge')).toHaveText('(SUPER_ADMIN)');
});

test('admin can see PIC, Issues and Aging columns in the grid', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');
  await expect(page).toHaveURL(/\/grid/);

  await expect(page.getByRole('columnheader', { name: 'PIC' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Issues' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Aging' })).toBeVisible();
});

test('admin can create a project with Sales and PIC via the add form', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');
  await expect(page).toHaveURL(/\/grid/);

  await page.getByRole('button', { name: 'Add project' }).click();

  await page.getByLabel(/Project name/).fill('E2E PIC Issues Project');
  await page.getByLabel(/Sales/).selectOption({ label: 'Staff One' });
  await page.getByLabel(/PIC/).selectOption({ label: 'Staff One' });

  // Issues is no longer part of the add form — it's logged exclusively through
  // the SUPER_ADMIN-only Issues modal (add endpoint), never via create/update.
  await expect(page.getByLabel(/Issues/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByText('Project created.', { exact: true })).toBeVisible();
  await expect(page.getByText('E2E PIC Issues Project', { exact: true })).toBeVisible();
});

test('admin can change the assigned Sales for an existing project inline', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');
  await expect(page).toHaveURL(/\/grid/);

  const adminRow = page.getByText('Admin Project A', { exact: true });
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
