import { test, expect } from '@playwright/test';

// The Issues column is SUPER_ADMIN-only for adding/logging: admins open a modal
// (add + full history), STAFF see only the latest issue (text + date +
// assignee) in the row and can't click it. Issues are never submittable through
// the create/update forms.
//
// Fixtures go through the admin API on a dedicated project assigned to the
// seeded staff user, so this spec never fights update-progress/edit-modal for
// shared project rows, and cleanup is by-name idempotent.

const PROJECT_NAME = 'E2E Issues Project';
const STAFF_EMAIL = 'staff1@example.com';

async function login(page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/grid/, { timeout: 15000 });
}

async function adminApiLogin(page) {
  const res = await page.request.post('/api/auth/login', { data: { email: 'admin@example.com', password: 'admin12345' } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).accessToken as string;
}

// Fetches a grid row by project name.
function row(page, projectName: string) {
  const nameCell = page.getByText(projectName, { exact: true });
  return nameCell.locator('xpath=ancestor::div[@role="row"]');
}

test('SUPER_ADMIN adds issues with date/assignee and sees the full history', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');
  const token = await page.evaluate(() => localStorage.getItem('tracker.accessToken'));
  expect(token).toBeTruthy();
  const headers = { Authorization: `Bearer ${token}` };

  // Idempotent setup: clear the dedicated project, then create it on the
  // seeded staff user so the STAFF-facing test below can find its row.
  const listRes = await page.request.get('/api/projects?page_size=500&sort_by=project_name&sort_dir=asc', { headers });
  const existing = (await listRes.json()).rows;
  for (const p of existing) {
    if (p.project_name === PROJECT_NAME) await page.request.delete(`/api/projects/${p.id}`, { headers });
  }
  const users = await (await page.request.get('/api/projects/users', { headers })).json();
  const staff = users.find((u) => u.role === 'STAFF');
  const created = await page.request.post('/api/projects', {
    headers,
    data: { project_name: PROJECT_NAME, staff_assigned_id: staff.id, current_stage: 'on_progress' },
  });
  expect(created.ok()).toBeTruthy();

  // Reload so the grid picks the new project up.
  await page.reload();
  await expect(page.getByText(PROJECT_NAME, { exact: true })).toBeVisible();

  const projectRow = row(page, PROJECT_NAME);

  // Admin: the Issues cell is a clickable button opening the modal.
  await projectRow.getByTitle('View issues').click();
  const dialog = page.getByRole('dialog', { name: `Issues — ${PROJECT_NAME}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('No issues recorded for this project yet.')).toBeVisible();

  const bText = `E2E Issues B ${Date.now()}`;
  await dialog.getByLabel('Issue text').fill(bText);
  await dialog.getByLabel('Issue date').fill('2026-08-01');
  await dialog.getByRole('button', { name: 'Add issue' }).click();

  // The new entry shows immediately, with the explicit date and no assignee.
  await expect(dialog.getByText(bText, { exact: true })).toBeVisible();
  await expect(dialog.getByText('1 Aug 2026', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Assigned to: —', { exact: true })).toBeVisible();

  // Second issue: default date (today) + assign to the staff user.
  const aText = `E2E Issues A ${Date.now()}`;
  await dialog.getByLabel('Issue text').fill(aText);
  await dialog.getByLabel('Assign to staff').selectOption({ label: staff.name });
  await dialog.getByRole('button', { name: 'Add issue' }).click();

  await expect(dialog.getByText(aText, { exact: true })).toBeVisible();
  await expect(dialog.getByText('Assigned to: ' + staff.name, { exact: true })).toBeVisible();

  // Full history is kept — both entries, newest first (A on top).
  await expect(dialog.getByText(bText, { exact: true })).toBeVisible();
  await expect(dialog.getByText('Assigned to: —', { exact: true })).toBeVisible();

  // Close: the grid cell now surfaces only the LATEST issue plus its meta.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(projectRow.getByText(aText, { exact: true })).toBeVisible();
  await expect(projectRow.getByText(new RegExp('· ' + staff.name))).toBeVisible();
  await expect(projectRow.getByText(bText, { exact: true })).toHaveCount(0);

  // Reopen: the history is still complete after a fresh fetch.
  await projectRow.getByTitle('View issues').click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(aText, { exact: true })).toBeVisible();
  await expect(dialog.getByText(bText, { exact: true })).toBeVisible();
});

test('STAFF sees only the latest issue and cannot click into history', async ({ page }) => {
  await login(page, STAFF_EMAIL, 'staff12345');

  // The dedicated project was assigned to staff in the admin test above.
  await expect(page.getByText(PROJECT_NAME, { exact: true })).toBeVisible();
  const projectRow = row(page, PROJECT_NAME);

  // Only the most recent issue (A, with its assignee) is shown in the cell.
  await expect(projectRow.getByText(new RegExp('E2E Issues A \\d+'))).toBeVisible();
  await expect(projectRow.getByText(new RegExp('· Staff One'))).toBeVisible();
  await expect(projectRow.getByText(new RegExp('E2E Issues B \\d+'))).toHaveCount(0);

  // STAFF sees a plain read-only cell — no clickable View issues button.
  await expect(projectRow.getByTitle('View issues')).toHaveCount(0);

  // Cleanup through the admin API.
  const token = await adminApiLogin(page);
  const headers = { Authorization: `Bearer ${token}` };
  const listRes = await page.request.get('/api/projects?page_size=500&sort_by=project_name&sort_dir=asc', { headers });
  const rows = (await listRes.json()).rows;
  for (const p of rows) {
    if (p.project_name === PROJECT_NAME) await page.request.delete(`/api/projects/${p.id}`, { headers });
  }
});