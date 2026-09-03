import { test, expect } from '@playwright/test';

async function login(page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

test('staff edit generates a notification for the admin', async ({ page }) => {
  // STAFF submits a change on their assigned project.
  await login(page, 'staff1@example.com', 'staff12345');
  await expect(page).toHaveURL(/\/grid/);

  const staffRow = page.getByText('Staff Project A', { exact: true });
  await expect(staffRow).toBeVisible();

  // Edit the PIC cell for Staff Project A (find the row, then an editable PIC cell).
  // The PIC button lives in the same row as the project name.
  const row = staffRow.locator('xpath=ancestor::div[@role="row"]');
  const picButton = row.locator('button[title="Edit pic"]');
  await picButton.click();
  await page.getByLabel('Edit pic').fill('E2E PIC Updated');
  await page.getByLabel('Edit pic').press('Enter');
  await expect(page.getByText('Change submitted for approval.', { exact: true })).toBeVisible();

  // Log out and log in as SUPER_ADMIN.
  await page.getByRole('button', { name: /log out/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await login(page, 'admin@example.com', 'admin12345');
  await expect(page).toHaveURL(/\/grid/);

  await expect(page.getByTestId('notification-bell')).toBeVisible();

  // The unread badge should show at least 1.
  await expect(page.getByTestId('notification-badge')).toHaveText('1');

  await page.getByTestId('notification-bell').click();
  await expect(page.getByTestId('notification-panel')).toBeVisible();
  await expect(page.getByText('New approval request', { exact: false }).first()).toBeVisible();
});

test('admin can mark all notifications as read to clear the badge', async ({ page }) => {
  await login(page, 'admin@example.com', 'admin12345');
  await expect(page).toHaveURL(/\/grid/);

  await page.getByTestId('notification-bell').click();
  await expect(page.getByTestId('notification-panel')).toBeVisible();

  const badge = page.getByTestId('notification-badge');
  const hasUnread = await badge.isVisible().catch(() => false);
  if (hasUnread) {
    await page.getByTestId('mark-all-read').click();
    await expect(badge).toBeHidden();
  }
});
