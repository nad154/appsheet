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
  await expect(page.getByText('Thresholds updated.', { exact: true })).toBeVisible();
}

test('priority badge follows the aging thresholds configured by the admin', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');

  // Normalize thresholds first (a previously crashed run may have left them
  // non-default, which would change the assertions below).
  await saveThresholds(page, '15', '30');
  await page.getByRole('link', { name: 'Grid' }).click();

  // Give Staff Project A a known aging: 30 calendar days ago ≈ 20–22 business
  // days. With the defaults (low 15, medium 30) that is Medium.
  const ago30 = new Date();
  ago30.setDate(ago30.getDate() - 30);
  const sentDate = ago30.toISOString().slice(0, 10);

  const nameCell = page.getByText('Staff Project A', { exact: true });
  const row = nameCell.locator('xpath=ancestor::div[@role="row"]');
  await row.locator('button[title="Edit project_sent_date"]').click();
  await page.getByLabel('Edit project_sent_date').fill(sentDate);
  await page.getByLabel('Edit project_sent_date').press('Enter');
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

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

  // Removing the sent date clears the badge entirely (aging = null).
  await page.getByRole('link', { name: 'Grid' }).click();
  await row.locator('button[title="Edit project_sent_date"]').click();
  await page.getByLabel('Edit project_sent_date').fill('');
  await page.getByLabel('Edit project_sent_date').press('Enter');
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
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