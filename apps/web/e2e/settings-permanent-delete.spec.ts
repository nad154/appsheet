import { test, expect } from '@playwright/test';
import { scrollGridTo } from './helpers';

// Permanent delete from the Settings page. A row must be deactivated first
// (two-step gate, enforced server-side with a 409); the confirmation modal
// shows the impact counts. Deleting a user leaves project assignments pointing
// at the removed id so the grid can flag them as "(deleted user)" until the
// SUPER_ADMIN reassigns. Deleting a market segment leaves the project's text
// label untouched.

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'admin12345';

let seq = 0;
function uniqueName(prefix: string) {
  seq += 1;
  return `${prefix} ${Date.now()}-${seq}`;
}

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

async function createStaff(page, headers, name: string) {
  const email = `${name.replace(/[^a-z0-9]+/gi, '.').toLowerCase()}@example.com`;
  const password = 'e2e-delete-12345';
  const res = await page.request.post('/api/settings/users', {
    headers,
    data: { name, email, password, role: 'STAFF' },
  });
  expect(res.ok()).toBeTruthy();
  const { id } = await res.json();
  return { id, email, password, name };
}

// Deactivate + delete, ignoring failures — used for fixtures the test did not
// already delete.
async function deleteStaffQuietly(page, headers, id: string) {
  await page.request.patch(`/api/settings/users/${id}`, { headers, data: { is_active: false } });
  await page.request.delete(`/api/settings/users/${id}`, { headers });
}

test('admin deactivates then permanently deletes a user, warning about linked projects', async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const headers = await adminHeaders(page);

  const staff = await createStaff(page, headers, uniqueName('E2E Delete User'));
  const projectName = uniqueName('E2E Deleted User Project');
  const projectRes = await page.request.post('/api/projects', {
    headers,
    data: { project_name: projectName, staff_assigned_id: staff.id, current_stage: 'on_progress' },
  });
  expect(projectRes.ok()).toBeTruthy();
  const projectId = (await projectRes.json()).id;

  await page.goto('/settings');
  const row = page.getByRole('row').filter({ hasText: staff.name });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Deactivate' }).click();
  const deleteButton = row.getByRole('button', { name: 'Delete permanently' });
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();

  const dialog = page.getByRole('dialog', { name: 'Confirm permanent delete' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/1 project still lists this user as Sales/)).toBeVisible();
  await expect(dialog.getByText(/cannot be undone/i)).toBeVisible();

  await dialog.getByTestId('confirm-permanent-delete').click();
  await expect(page.getByText('User permanently deleted.', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);

  // Gone from the API.
  const users = await (await page.request.get('/api/settings/users', { headers })).json();
  expect(users.some((u: { id: string }) => u.id === staff.id)).toBe(false);

  // The project keeps the id but the grid flags it for reassignment.
  await page.goto('/grid');
  await scrollGridTo(page, projectName);
  const projectRow = page.getByRole('row').filter({ hasText: projectName });
  await expect(projectRow.getByText('(deleted user)')).toBeVisible();

  await page.request.delete(`/api/projects/${projectId}`, { headers });
});

test('an active user cannot be permanently deleted (409)', async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const headers = await adminHeaders(page);
  const staff = await createStaff(page, headers, uniqueName('E2E Active User'));

  const res = await page.request.delete(`/api/settings/users/${staff.id}`, { headers });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toMatch(/Deactivate the user first/i);

  await deleteStaffQuietly(page, headers, staff.id);
});

test('admin cannot permanently delete their own account', async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const headers = await adminHeaders(page);
  const me = await (await page.request.get('/api/auth/me', { headers })).json();

  const res = await page.request.delete(`/api/settings/users/${me.id}`, { headers });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toMatch(/cannot delete your own account/i);
});

test('admin deactivates then permanently deletes a market segment', async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const headers = await adminHeaders(page);

  const label = uniqueName('E2E Segment');
  const createRes = await page.request.post('/api/settings/market-segments', {
    headers,
    data: { label, sort_order: 99 },
  });
  expect(createRes.ok()).toBeTruthy();
  const { id } = await createRes.json();

  const projectName = uniqueName('E2E Segment Project');
  const projectRes = await page.request.post('/api/projects', {
    headers,
    data: { project_name: projectName, market_segment: label, current_stage: 'on_progress' },
  });
  expect(projectRes.ok()).toBeTruthy();
  const projectId = (await projectRes.json()).id;

  await page.goto('/settings');
  const row = page.getByRole('row').filter({ hasText: label });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Deactivate' }).click();
  const deleteButton = row.getByRole('button', { name: 'Delete permanently' });
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();

  const dialog = page.getByRole('dialog', { name: 'Confirm permanent delete' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/1 project still carries this label/)).toBeVisible();

  await dialog.getByTestId('confirm-permanent-delete').click();
  await expect(page.getByText('Market segment permanently deleted.', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);

  // Gone from the API, but the project keeps the label text.
  const segments = await (await page.request.get('/api/settings/market-segments', { headers })).json();
  expect(segments.some((s: { id: string }) => s.id === id)).toBe(false);

  const projects = await (
    await page.request.get('/api/projects?page_size=500&sort_by=project_name&sort_dir=asc', { headers })
  ).json();
  const project = projects.rows.find((p: { id: string }) => p.id === projectId);
  expect(project.market_segment).toBe(label);

  await page.request.delete(`/api/projects/${projectId}`, { headers });
});

test('staff cannot reach the permanent-delete endpoints (403)', async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const headers = await adminHeaders(page);
  const staff = await createStaff(page, headers, uniqueName('E2E Staff Guard'));

  const staffLogin = await page.request.post('/api/auth/login', {
    data: { email: staff.email, password: staff.password },
  });
  expect(staffLogin.ok()).toBeTruthy();
  const staffToken = (await staffLogin.json()).accessToken;
  const staffHeaders = { Authorization: `Bearer ${staffToken}` };

  const usage = await page.request.get(`/api/settings/users/${staff.id}/usage`, { headers: staffHeaders });
  expect(usage.status()).toBe(403);

  const del = await page.request.delete(`/api/settings/users/${staff.id}`, { headers: staffHeaders });
  expect(del.status()).toBe(403);

  const segmentDel = await page.request.delete(`/api/settings/market-segments/${staff.id}`, { headers: staffHeaders });
  expect(segmentDel.status()).toBe(403);

  const list = await page.request.get('/api/settings/users', { headers: staffHeaders });
  expect(list.status()).toBe(403);

  await deleteStaffQuietly(page, headers, staff.id);
});

test('customer hard delete still works (unchanged behaviour)', async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const headers = await adminHeaders(page);

  const name = uniqueName('E2E Customer');
  const created = await page.request.post('/api/customers', { headers, data: { name } });
  expect(created.ok()).toBeTruthy();
  const { id } = await created.json();

  const del = await page.request.delete(`/api/customers/${id}`, { headers });
  expect(del.ok()).toBeTruthy();
  expect((await del.json()).usageCount).toBe(0);
});
