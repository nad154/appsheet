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

// The customer field is a searchable combobox now: type a unique name and pick
// the "Add new" fallback, which creates the customer row and selects it.
async function selectCustomer(dialog, name: string) {
  const combobox = dialog.getByLabel('Customer', { exact: true });
  await combobox.fill(name);
  const addRow = dialog.getByRole('button', { name: `Add "${name}"` });
  await expect(addRow).toBeVisible({ timeout: 5000 });
  await addRow.click();
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

  // The modal is pre-filled with the full row, grouped into sections. Vendor
  // fields moved onto per-project vendor lines ("Vendor lines" section).
  await expect(dialog.getByRole('group', { name: 'Project info' })).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Customer' })).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Vendor lines' })).toBeVisible();

  await selectCustomer(dialog, 'E2E Admin Customer');
  await dialog.getByLabel('Issues').fill('E2E Admin Issue');

  await dialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Grid reflects the new values after the PATCH + refetch.
  await expect(page.getByText('E2E Admin Customer', { exact: true })).toBeVisible();
  await expect(page.getByText('E2E Admin Issue', { exact: true })).toBeVisible();
});

test('staff edits apply immediately but require an Update Progress note', async ({ page }) => {
  await login(page, 'staff1@example.com', 'staff12345');

  const dialog = await openRowModal(page, 'Staff Project A');
  await selectCustomer(dialog, 'E2E Staff Customer');

  // Without Update Progress the save button is disabled.
  await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled();

  await dialog.getByLabel('Update progress').fill('E2E modal progress note');
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // There is no approval step anymore — the change hits the grid immediately
  // and the Update Progress note is shown next to the row.
  await expect(page.getByText('E2E Staff Customer', { exact: true })).toBeVisible();
  await expect(page.getByText('E2E modal progress note', { exact: true })).toBeVisible();
});

test('staff cannot reassign the Sales owner via the modal', async ({ page }) => {
  await login(page, 'staff1@example.com', 'staff12345');

  const dialog = await openRowModal(page, 'Staff Project A');

  // The Sales (staff_assigned_id) field is admin-only in the modal.
  await expect(dialog.getByLabel('Assigned staff')).toHaveCount(0);
});