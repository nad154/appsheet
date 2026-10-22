import { test, expect } from '@playwright/test';
import { scrollGridTo } from './helpers';

// Deleting a project is a SUPER_ADMIN-only hard delete: the project plus its
// vendor lines, update history and logged issues all go away, and the linked
// Drive folder stays. The UI entry point is the Delete button in the Edit
// Project modal, guarded by a confirmation modal.
//
// Fixtures go through the admin API on a dedicated project assigned to the
// seeded staff user, so this spec never touches shared project rows and
// cleanup is by-name idempotent.

const PROJECT_NAME = 'E2E Delete Project';
const STAFF_EMAIL = 'staff1@example.com';

async function login(page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/grid/, { timeout: 15000 });
}

async function adminHeaders(page) {
  const token = await page.evaluate(() => localStorage.getItem('tracker.accessToken'));
  expect(token).toBeTruthy();
  return { Authorization: `Bearer ${token}` };
}

// Idempotent setup: drop any leftover copy of the fixture, then recreate it
// assigned to the seeded staff user so the STAFF-facing test can find its row.
async function ensureProject(page) {
  const headers = await adminHeaders(page);
  const listRes = await page.request.get('/api/projects?page_size=500&sort_by=project_name&sort_dir=asc', { headers });
  const existing = (await listRes.json()).rows;
  for (const p of existing) {
    if (p.project_name === PROJECT_NAME) await page.request.delete(`/api/projects/${p.id}`, { headers });
  }
  const users = await (await page.request.get('/api/settings/users', { headers })).json();
  const staff = users.find((u: { email: string; role: string }) => u.role === 'STAFF' && u.email === STAFF_EMAIL);
  const created = await page.request.post('/api/projects', {
    headers,
    data: { project_name: PROJECT_NAME, staff_assigned_id: staff.id, current_stage: 'on_progress' },
  });
  expect(created.ok()).toBeTruthy();
}

async function openRowModal(page, projectName: string) {
  await scrollGridTo(page, projectName);
  const nameCell = page.getByText(projectName, { exact: true });
  await expect(nameCell).toBeVisible();
  await nameCell.hover();

  const pencil = nameCell
    .locator('xpath=ancestor::div[@role="row"]')
    .locator('button[title="Edit project"]');
  await expect(pencil).toBeVisible();
  await pencil.click();

  const dialog = page.getByRole('dialog', { name: `Edit ${projectName}` });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('admin can delete a project from the edit modal', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');
  await ensureProject(page);
  await page.reload();

  const dialog = await openRowModal(page, PROJECT_NAME);
  await expect(dialog.getByTestId('delete-project')).toBeVisible();

  await dialog.getByTestId('delete-project').click();

  const confirm = page.getByRole('dialog', { name: 'Confirm delete project' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText(PROJECT_NAME)).toBeVisible();

  await confirm.getByTestId('confirm-delete-project').click();

  await expect(page.getByText('Project deleted.', { exact: true })).toBeVisible();
  // Both modals are gone.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The row is no longer in the grid.
  await expect(page.getByText(PROJECT_NAME, { exact: true })).toHaveCount(0);
});

test('cancelling the delete confirmation keeps the project', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');
  await ensureProject(page);
  await page.reload();

  const dialog = await openRowModal(page, PROJECT_NAME);
  await dialog.getByTestId('delete-project').click();

  const confirm = page.getByRole('dialog', { name: 'Confirm delete project' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();

  await expect(confirm).toHaveCount(0);
  // The edit modal underneath stays open — the stacked confirm modal must not
  // take it down with it.
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(PROJECT_NAME, { exact: true }).first()).toBeVisible();
});

test('staff never sees the delete button', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');
  await ensureProject(page);

  await login(page, 'staff1@example.com', 'staff12345');
  const dialog = await openRowModal(page, PROJECT_NAME);

  await expect(dialog.getByTestId('delete-project')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
});
