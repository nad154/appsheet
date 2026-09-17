import { test, expect } from '@playwright/test';

// Covers the replacement for the approval flow: STAFF edits require an Update
// Progress note, pipe onto project_updates, and are surfaced to SUPER_ADMIN via
// the unread dot + history modal (getProjectUpdateHistory marks entries read).

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

test('staff save is blocked while Update Progress is empty', async ({ page }) => {
  await login(page, 'staff1@example.com', 'staff12345');

  const dialog = await openRowModal(page, 'Staff Project A');
  await selectCustomer(dialog, 'E2E Progress Blocked');

  const save = dialog.getByRole('button', { name: 'Save changes' });
  await expect(save).toBeDisabled();

  // Filling in the note unlocks the save button.
  await dialog.getByLabel('Update progress').fill('Blocked test note — should never persist');
  await expect(save).toBeEnabled();

  // Cancel instead of saving so this test leaves no project_updates row behind.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('staff edit with an Update Progress note applies immediately', async ({ page }) => {
  await login(page, 'staff1@example.com', 'staff12345');

  const dialog = await openRowModal(page, 'Staff Project A');
  await selectCustomer(dialog, 'E2E Live Update');
  await dialog.getByLabel('Update progress').fill('Changed the customer name after a vendor call.');
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // No approval step: the grid refetches and shows the new value plus the note.
  await expect(page.getByText('E2E Live Update', { exact: true })).toBeVisible();
  await expect(page.getByText('Changed the customer name after a vendor call.', { exact: true })).toBeVisible();
});

test('admin sees the unread dot and can review the update history', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');

  const nameCell = page.getByText('Staff Project A', { exact: true });
  await expect(nameCell).toBeVisible();
  const row = nameCell.locator('xpath=ancestor::div[@role="row"]');

  // The UPDATE from the previous test left an unread marker behind.
  const dot = row.getByTestId('unread-update-dot');
  await expect(dot).toBeVisible();

  // Opening the history opens the modal scoped to the project.
  await row.getByTitle('View update history').click();
  const dialog = page.getByRole('dialog', { name: 'Update history — Staff Project A' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Staff Project A — Update History')).toBeVisible();

  // The entry shows who changed what (old → new) and the mandatory note. The
  // customer change records the new customer_id (diff semantics), not the name.
  await expect(dialog.getByText('Staff One', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('Customer', { exact: true }).first()).toBeVisible();
  // New value cell renders as "→ <new customer id>"; old value is the previous
  // customer's id (line-through).
  await expect(dialog.getByText(/→ [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/).first()).toBeVisible();
  // The note div's text merges with the next card's header in the accessibility
  // tree, so match on a substring rather than exact text.
  await expect(dialog.getByText(/Changed the customer name after a vendor call\./)).toBeVisible();
  await expect(dialog.getByText('Update Progress', { exact: true }).first()).toBeVisible();

  // Closing the modal marks the entries read and clears the dot in the grid.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(dot).toHaveCount(0, { timeout: 15000 });
});