import { test, expect } from '@playwright/test';

async function login(page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/grid/, { timeout: 15000 });
}

async function saveThresholds(page, low: string, medium: string) {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('Aging → Priority', { exact: true })).toBeVisible();

  const lowInput = page.getByLabel('Low priority — up to N days');
  const mediumInput = page.getByLabel('Medium priority — up to N days');
  // Values are only populated once the thresholds finish loading.
  await expect(lowInput).toBeEnabled();
  await lowInput.fill(low);
  await mediumInput.fill(medium);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Thresholds updated.', { exact: true }).first()).toBeVisible();
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

// One rendered vendor-line box inside the edit modal (the "Vendor N" header
// sits inside the bordered per-line container).
async function vendorBlock(dialog, label: string) {
  return dialog.getByText(label, { exact: true }).locator('xpath=ancestor::div[contains(@class,"border-gray-200")]');
}

// The priority badge reflects the FIRST vendor line's aging (a project's
// group-header display row carries its first vendor line). Vendor aging fields
// are modal-only now, so the spec drives the sent date through the edit modal's
// "Vendor lines" section.
test('priority badge follows the aging thresholds configured by the admin', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');

  // Normalize thresholds first (a previously crashed run may have left them
  // non-default, which would change the assertions below).
  await saveThresholds(page, '15', '30');
  await page.getByRole('link', { name: 'Grid' }).click();

  // Give Staff Project A's vendor line a known aging: 30 calendar days ago ≈
  // 20–22 business days. With the defaults (low 15, medium 30) that is Medium.
  const ago30 = new Date();
  ago30.setDate(ago30.getDate() - 30);
  const sentDate = ago30.toISOString().slice(0, 10);

  const nameCell = page.getByText('Staff Project A', { exact: true });
  const row = nameCell.locator('xpath=ancestor::div[@role="row"]');

  const setSentDate = async (date: string) => {
    await nameCell.hover();
    await row.locator('button[title="Edit project"]').click();
    const dialog = page.getByRole('dialog', { name: 'Edit Staff Project A' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Project sent date').fill(date);
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved.', { exact: true }).first()).toBeVisible();
  };

  await setSentDate(sentDate);

  // Default thresholds → Medium.
  await expect(row.getByText('Medium', { exact: true })).toBeVisible();

  // Shrink both thresholds so the same aging is now High.
  await saveThresholds(page, '5', '8');
  await page.getByRole('link', { name: 'Grid' }).click();
  await expect(row.getByText('High', { exact: true })).toBeVisible();

  // Expand them so the same aging drops back to Low.
  await saveThresholds(page, '60', '120');
  await page.getByRole('link', { name: 'Grid' }).click();
  await expect(row.getByText('Low', { exact: true })).toBeVisible();

  // Restore the defaults so later runs start from a known state.
  await saveThresholds(page, '15', '30');
  await page.getByRole('link', { name: 'Grid' }).click();

  // ── Multi-vendor gate: two vendor lines → two Aging/Priority badges ──────
  // Add a second line to Staff Project A with the same aging and assert the
  // grid renders two display rows, each carrying its own priority badge, and
  // that both badges follow the admin-configured thresholds together.
  let dialog = await openRowModal(page, 'Staff Project A');
  await dialog.getByRole('button', { name: '+ Add vendor' }).click();
  const line2 = await vendorBlock(dialog, 'Vendor 2');
  await dialog.getByLabel('Vendor 2').fill('E2E Priority Vendor');
  // The vendor may already exist from a previous run (the "Add …" fallback
  // only shows when there is no exact match): wait for either the create row or
  // the matching option, then act on whichever is present.
  const pickOrCreate = dialog
    .getByRole('button', { name: 'Add "E2E Priority Vendor"' })
    .or(dialog.getByRole('button', { name: 'E2E Priority Vendor', exact: true }));
  await expect(pickOrCreate).toBeVisible();
  if (await dialog.getByRole('button', { name: 'Add "E2E Priority Vendor"' }).count()) {
    await dialog.getByRole('button', { name: 'Add "E2E Priority Vendor"' }).click();
  } else {
    await dialog.getByRole('button', { name: 'E2E Priority Vendor', exact: true }).click();
  }
  await line2.getByLabel('Project sent date').fill(sentDate);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The second line's row is a separate display row under the group header.
  const row2 = page
    .getByText('E2E Priority Vendor', { exact: true })
    .locator('xpath=ancestor::div[@role="row"]');
  await expect(row2).toBeVisible();
  await expect(row.getByText('Medium', { exact: true })).toBeVisible();
  await expect(row2.getByText('Medium', { exact: true })).toBeVisible();

  // Shrink both thresholds → the two badges flip to High together.
  await saveThresholds(page, '5', '8');
  await page.getByRole('link', { name: 'Grid' }).click();
  await expect(row.getByText('High', { exact: true })).toBeVisible();
  await expect(row2.getByText('High', { exact: true })).toBeVisible();

  // Expand them again → both flip back to Low together.
  await saveThresholds(page, '60', '120');
  await page.getByRole('link', { name: 'Grid' }).click();
  await expect(row.getByText('Low', { exact: true })).toBeVisible();
  await expect(row2.getByText('Low', { exact: true })).toBeVisible();

  // Restore the defaults and drop the second line so later suite runs start
  // from the original single-line fixture.
  await saveThresholds(page, '15', '30');
  await page.getByRole('link', { name: 'Grid' }).click();
  dialog = await openRowModal(page, 'Staff Project A');
  const line2Again = await vendorBlock(dialog, 'Vendor 2');
  await line2Again.getByRole('button', { name: 'Remove' }).click();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row2).toHaveCount(0);

  // Removing the sent date clears the badge entirely (aging = null).
  await page.getByRole('link', { name: 'Grid' }).click();
  await setSentDate('');
  await expect(row.getByText('Medium', { exact: true })).toHaveCount(0);
});

test('staff cannot reach the aging thresholds panel or patch them via the API', async ({ page, request }) => {
  await login(page, 'staff1@example.com', 'staff12345');

  // UI route guard: /settings is SUPER_ADMIN-only, so staff bounce to /grid.
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/grid/);
  await expect(page.getByText('Aging → Priority', { exact: true })).toHaveCount(0);

  // Server-level guard: even with a valid staff token, PATCH is 403.
  const token = await page.evaluate(() => localStorage.getItem('tracker.accessToken'));
  expect(token).toBeTruthy();
  const res = await request.patch('/api/settings/aging-thresholds', {
    headers: { Authorization: `Bearer ${token}` },
    data: { low_max_days: 10, medium_max_days: 20 },
  });
  expect(res.status()).toBe(403);
});