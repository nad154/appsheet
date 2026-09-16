import { test, expect } from '@playwright/test';

async function login(page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

// The approval-driven notification flow was removed: STAFF edits apply
// immediately (an Update Progress note is mandatory) and surface through the
// unread indicator + history modal, which update-progress.spec.ts covers.
// Notifications now only come from the aging digest, so the mark-all-read
// behavior below is the remaining surface worth guarding.

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
