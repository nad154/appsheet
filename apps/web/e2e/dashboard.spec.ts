import { test, expect } from '@playwright/test';

async function login(page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/grid/, { timeout: 15000 });
}

// Unique per run so leftover views from earlier (possibly crashed) runs can
// never collide with the card this run creates or asserts on.
function uniqueViewLabel(prefix: string): string {
  return `${prefix} ${Date.now()}`;
}

test('admin can create a Stage pie view and sees both stages in the legend', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');

  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.getByRole('button', { name: 'Add view' }).click();
  await page.getByLabel('Chart type').selectOption({ label: 'Pie' });
  await page.getByLabel('Column').selectOption({ label: 'Stage' });
  const label = uniqueViewLabel('E2E Admin Stage');
  await page.getByLabel('Display label').fill(label);
  await page.getByRole('button', { name: 'Add view' }).click();

  const card = page.getByRole('heading', { name: label });
  await expect(card).toBeVisible();

  // The fixture has 3 on_progress + 1 finish project, so the legend must show both.
  await expect(page.getByText('on_progress', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('finish', { exact: true }).first()).toBeVisible();

  // Deleting the view removes its card.
  await card.locator('..').getByRole('button', { name: `Delete view ${label}` }).click();
  await expect(card).toHaveCount(0);
});

test("staff sees only their own dashboard views, not the admin's", async ({ page }) => {
  await login(page, 'staff1@example.com', 'staff12345');

  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // Admin views are keyed to the admin user — a staff account must never see
  // them. The label is unique per run, so any leftover from a prior run also
  // must not collide.
  const adminLabel = uniqueViewLabel('E2E Admin Stage');
  await expect(page.getByRole('heading', { name: adminLabel })).toHaveCount(0);

  await page.getByRole('button', { name: 'Add view' }).click();
  await page.getByLabel('Column').selectOption({ label: 'Stage' });
  const staffLabel = uniqueViewLabel('E2E Staff Stage');
  await page.getByLabel('Display label').fill(staffLabel);
  await page.getByRole('button', { name: 'Add view' }).click();

  const card = page.getByRole('heading', { name: staffLabel });
  await expect(card).toBeVisible();
  await expect(page.getByText('on_progress', { exact: true }).first()).toBeVisible();
});