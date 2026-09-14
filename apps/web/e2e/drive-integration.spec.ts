import { test, expect } from '@playwright/test';

// Drive integration access-control tests. These deliberately avoid calling the
// real Google Drive API (no service-account.json in the dev/test environment),
// so they only cover the RBAC + UI-gating surface:
//   - link/create-folder endpoints are SUPER_ADMIN-only
//   - upload requires ownership (SUPER_ADMIN or assigned staff)
//   - the upload control is hard-disabled when a project has no linked folder

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

test('staff cannot call the create-folder endpoint directly', async ({ page, request }) => {
  const token = await staffToken(page);
  const res = await request.post(`/api/drive/${ADMIN_PROJECT_A_ID}/create-folder`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { folderName: 'E2E Should Never Be Created' },
  });
  expect(res.status()).toBe(403);
});

test('upload control is disabled when the project has no linked Drive folder', async ({ page }) => {
  await login(page, 'staff1@example.com', 'staff12345');

  const nameCell = page.getByText('Staff Project A', { exact: true });
  const row = nameCell.locator('xpath=ancestor::div[@role="row"]');

  // The upload control exists (the assigned staff member may upload) but is
  // hard-disabled until a Drive folder is linked.
  const upload = row.locator('button[title="Link a Drive folder first"]');
  await expect(upload).toHaveCount(1);
  await expect(upload).toBeDisabled();
});

test('staff cannot upload to a project assigned to another staff member', async ({ page, request }) => {
  const token = await staffToken(page);
  const res = await request.post(`/api/drive/${ADMIN_PROJECT_A_ID}/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: 'e2e-unsigned.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('not allowed'),
      },
    },
  });
  expect(res.status()).toBe(403);
});