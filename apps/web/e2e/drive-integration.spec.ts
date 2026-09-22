import { test, expect } from '@playwright/test';
import { scrollGridTo } from './helpers';

// Drive integration access-control tests. These deliberately avoid calling the
// real Google Drive API (no service-account.json in the dev/test environment),
// so they only cover the RBAC + UI-gating surface:
//   - link/create-folder endpoints are SUPER_ADMIN-only

// Deterministic project ids seeded by apps/server/_rbac_setup.ts.
const ADMIN_PROJECT_A_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const STAFF_PROJECT_A_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

async function login(page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/grid/, { timeout: 15000 });
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

async function staffToken(page): Promise<string> {
  await login(page, 'staff1@example.com', 'staff12345');
  const token = await page.evaluate(() => localStorage.getItem('tracker.accessToken'));
  expect(token).toBeTruthy();
  return token as string;
}

test('admin sees the folder link/create controls in the edit modal', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');
  const dialog = await openRowModal(page, 'Admin Project A');

  await expect(dialog.getByRole('button', { name: 'Link existing folder' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create folder' })).toBeVisible();
  await expect(dialog.getByLabel('Drive folder URL or ID')).toBeVisible();
});

test('staff does not see the folder link/create controls', async ({ page }) => {
  await login(page, 'staff1@example.com', 'staff12345');
  const dialog = await openRowModal(page, 'Staff Project A');

  await expect(dialog.getByRole('button', { name: 'Link existing folder' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Create folder' })).toHaveCount(0);
  await expect(dialog.getByLabel('Drive folder URL or ID')).toHaveCount(0);
});

test('staff cannot call the link endpoint directly', async ({ page, request }) => {
  const token = await staffToken(page);
  const res = await request.post(`/api/drive/${ADMIN_PROJECT_A_ID}/link`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { folderInput: 'https://drive.google.com/drive/folders/abc123' },
  });
  expect(res.status()).toBe(403);
});

test('admin opens the quick-link modal from an unlinked folder cell', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');
  await scrollGridTo(page, 'Admin Project A');
  await page.getByLabel('Link Drive folder for Admin Project A').click();

  const dialog = page.getByRole('dialog', { name: 'Link Drive folder for Admin Project A' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Link to existing drive' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create drive folder' })).toBeVisible();
  await expect(dialog.getByLabel('Drive folder URL or ID')).toBeVisible();
  await expect(dialog.getByLabel('Folder name')).toBeVisible();
});

test('staff sees no link affordance on unlinked folder cells', async ({ page }) => {
  await login(page, 'staff1@example.com', 'staff12345');
  await expect(page.getByLabel('Link Drive folder for Staff Project A')).toHaveCount(0);
});

test('staff cannot call the create-folder endpoint directly', async ({ page, request }) => {
  const token = await staffToken(page);
  const res = await request.post(`/api/drive/${ADMIN_PROJECT_A_ID}/create-folder`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { folderName: 'E2E Should Never Be Created' },
  });
  expect(res.status()).toBe(403);
});