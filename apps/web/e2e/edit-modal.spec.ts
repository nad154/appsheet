import { test, expect } from '@playwright/test';

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

test('hovering a project name reveals the edit button', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');

  const nameCell = page.getByText('Admin Project A', { exact: true });
  await expect(nameCell).toBeVisible();
  const pencil = nameCell.locator('xpath=ancestor::div[@role="row"]').locator('button[title="Edit project"]');

  // Hidden until hovered; appears after hovering the project name cell.
  await expect(pencil).toBeHidden();
  await nameCell.hover();
  await expect(pencil).toBeVisible();
});

test('admin can edit multiple fields in the modal with one PATCH', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');

  const dialog = await openRowModal(page, 'Admin Project A');

  // The modal is pre-filled with the full row, grouped into sections.
  await expect(dialog.getByText('Project info', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Customer', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Vendor', { exact: true })).toBeVisible();

  const customerInput = dialog.getByLabel('Customer name');
  const issuesInput = dialog.getByLabel('Issues');
  await customerInput.fill('E2E Admin Customer');
  await issuesInput.fill('E2E Admin Issue');

  await dialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Grid reflects the new values after the PATCH + refetch.
  await expect(page.getByText('E2E Admin Customer', { exact: true })).toBeVisible();
  await expect(page.getByText('E2E Admin Issue', { exact: true })).toBeVisible();
});

test('staff editing via the modal is held for approval and does not change the row', async ({ page }) => {
  await login(page, 'staff1@example.com', 'staff12345');

  const dialog = await openRowModal(page, 'Staff Project A');
  const customerInput = dialog.getByLabel('Customer name');

  // Fixture data has no customer name for Staff Project A → initially empty.
  await expect(customerInput).toHaveValue('');
  await customerInput.fill('E2E Staff Customer');
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByText('Change submitted for approval.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Until an admin approves, the live row is untouched: the grid refetches and
  // still shows the old value (an em-dash placeholder for null).
  await expect(page.getByText('E2E Staff Customer', { exact: true })).toHaveCount(0);
});

test('staff cannot reassign the Sales owner via the modal', async ({ page }) => {
  await login(page, 'staff1@example.com', 'staff12345');

  const dialog = await openRowModal(page, 'Staff Project A');

  // The Sales (staff_assigned_id) field is admin-only in the modal.
  await expect(dialog.getByLabel('Assigned staff')).toHaveCount(0);
});