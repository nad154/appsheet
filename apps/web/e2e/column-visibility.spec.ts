import { test, expect, type Page } from '@playwright/test';

// Per-user column visibility (plan_column_visibility). Additive to the Sticky
// columns feature: the Columns menu only toggles which leaves/groups render.
// Preferences are persisted per user server-side, so these tests clean up after
// themselves (a leftover hidden group would break the sticky-columns spec,
// which assumes the default view with everything visible).

const ADMIN = { email: 'admin@example.com', password: 'admin12345' };
const STAFF = { email: 'staff1@example.com', password: 'staff12345' };

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/grid/, { timeout: 15000 });
}

async function apiToken(page: Page, email: string, password: string): Promise<string> {
  const res = await page.request.post('/api/auth/login', { data: { email, password } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).accessToken as string;
}

async function resetPrefs(page: Page, email: string, password: string) {
  const token = await apiToken(page, email, password);
  const res = await page.request.delete('/api/me/preferences/grid-columns', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
}

// The preference PUT is debounced (~400ms) — wait for it to land before a
// reload / new context reads the server copy.
async function waitForSave(page: Page) {
  await page.waitForTimeout(700);
}

async function openColumns(page: Page) {
  await page.getByTestId('columns-button').click();
  await expect(page.getByTestId('columns-panel')).toBeVisible();
}

async function closeColumns(page: Page) {
  await page.getByTestId('columns-button').click();
  await expect(page.getByTestId('columns-panel')).toHaveCount(0);
}

function gridHeader(page: Page, name: string) {
  return page.getByRole('table').getByRole('columnheader', { name, exact: true });
}

test.afterEach(async ({ page }) => {
  // Idempotent reset for both users so no test leaves a non-default view.
  await resetPrefs(page, ADMIN.email, ADMIN.password);
  await resetPrefs(page, STAFF.email, STAFF.password);
});

test('hiding the Vendor group removes its headers, and un-hiding restores them', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

  await expect(gridHeader(page, 'RAB Amount')).toBeVisible();

  await openColumns(page);
  await page.getByRole('checkbox', { name: 'Vendor Section', exact: true }).uncheck();
  await closeColumns(page);

  // Group header and every vendor leaf header are gone; Customer survives.
  await expect(gridHeader(page, 'Vendor Section')).toHaveCount(0);
  await expect(gridHeader(page, 'RAB Amount')).toHaveCount(0);
  await expect(gridHeader(page, 'Customer Section')).toBeVisible();

  await openColumns(page);
  await page.getByRole('checkbox', { name: 'Vendor Section', exact: true }).check();
  await closeColumns(page);

  await expect(gridHeader(page, 'Vendor Section')).toBeVisible();
  await expect(gridHeader(page, 'RAB Amount')).toBeVisible();
});

test('hiding one Customer column keeps the rest and shows the group as mixed', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

  await openColumns(page);
  const group = page.getByRole('checkbox', { name: 'Customer Section', exact: true });
  await page.getByRole('checkbox', { name: 'Market Segment', exact: true }).uncheck();
  await expect(group).toHaveAttribute('aria-checked', 'mixed');
  await closeColumns(page);

  await expect(gridHeader(page, 'Market Segment')).toHaveCount(0);
  await expect(gridHeader(page, 'Customer')).toBeVisible();
});

test('locked columns cannot be unchecked', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

  await openColumns(page);
  await expect(page.getByRole('checkbox', { name: 'Project Name', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: '# (row number)', exact: true })).toBeDisabled();
});

test('the view persists across a reload and a fresh browser context', async ({ page, browser }) => {
  await login(page, ADMIN.email, ADMIN.password);

  await openColumns(page);
  await page.getByRole('checkbox', { name: 'Vendor Section', exact: true }).uncheck();
  await closeColumns(page);
  await waitForSave(page);

  await page.reload();
  await expect(gridHeader(page, 'Vendor Section')).toHaveCount(0);

  // A brand-new context has no localStorage warm cache — the server copy must
  // still apply, proving the view is per profile, not per browser.
  const ctx = await browser.newContext();
  const fresh = await ctx.newPage();
  await login(fresh, ADMIN.email, ADMIN.password);
  await expect(gridHeader(fresh, 'Vendor Section')).toHaveCount(0);
  await expect(gridHeader(fresh, 'Customer Section')).toBeVisible();
  await ctx.close();
});

test('two users keep different views', async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const staffCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  const staffPage = await staffCtx.newPage();

  await login(adminPage, ADMIN.email, ADMIN.password);
  await login(staffPage, STAFF.email, STAFF.password);

  // Admin hides Vendor; Staff hides Customer.
  await openColumns(adminPage);
  await adminPage.getByRole('checkbox', { name: 'Vendor Section', exact: true }).uncheck();
  await closeColumns(adminPage);

  await openColumns(staffPage);
  await staffPage.getByRole('checkbox', { name: 'Customer Section', exact: true }).uncheck();
  await closeColumns(staffPage);
  await waitForSave(staffPage);

  await adminPage.reload();
  await expect(gridHeader(adminPage, 'Vendor Section')).toHaveCount(0);
  await expect(gridHeader(adminPage, 'Customer Section')).toBeVisible();

  await expect(gridHeader(staffPage, 'Customer Section')).toHaveCount(0);
  await expect(gridHeader(staffPage, 'Vendor Section')).toBeVisible();

  await adminCtx.close();
  await staffCtx.close();
});

test('Reset restores all columns', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

  await openColumns(page);
  await page.getByRole('checkbox', { name: 'Vendor Section', exact: true }).uncheck();
  await closeColumns(page);
  await expect(gridHeader(page, 'Vendor Section')).toHaveCount(0);

  await openColumns(page);
  await page.getByTestId('columns-reset').click();
  await closeColumns(page);

  await expect(gridHeader(page, 'Vendor Section')).toBeVisible();
  await expect(gridHeader(page, 'RAB Amount')).toBeVisible();

  await page.reload();
  await expect(gridHeader(page, 'RAB Amount')).toBeVisible();
});

test('a pinned column that is hidden is not sticky, and sticky again once re-shown', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

  // Fixture: a project pinned early so it lands on page 1 under default order.
  const token = await page.evaluate(() => localStorage.getItem('tracker.accessToken'));
  const headers = { Authorization: `Bearer ${token}` };
  const name = '0 E2E Column Visibility Sticky';
  const listRes = await page.request.get('/api/projects?page_size=500&sort_by=project_name&sort_dir=asc', { headers });
  for (const p of (await listRes.json()).rows as Array<{ id: string; project_name: string }>) {
    if (p.project_name === name) await page.request.delete(`/api/projects/${p.id}`, { headers });
  }
  const vendor = await (
    await page.request.post('/api/vendors', { headers, data: { name: '0 E2E Column Visibility Vendor' } })
  ).json();
  // A customer name so the Customer cell has unique, matchable text.
  const customerName = '0 E2E Column Visibility Customer';
  const customer = await (
    await page.request.post('/api/customers', { headers, data: { name: customerName } })
  ).json();
  const created = await (
    await page.request.post('/api/projects', {
      headers,
      data: {
        project_name: name,
        customer_id: customer.id,
        vendors: [{ vendor_id: vendor.id, sort_order: 0 }],
      },
    })
  ).json();
  await page.request.patch(`/api/projects/${created.id}`, {
    headers,
    data: { created_at: '1999-12-27T00:00:00.000Z' },
  });

  const cellFor = (label: string) =>
    page
      .getByText(name, { exact: true })
      .locator('xpath=ancestor::div[@role="row"]')
      .getByRole('cell', { name: label, exact: false });

  const isSticky = async (el: ReturnType<typeof cellFor>) =>
    (await el.evaluate((n: HTMLElement) => getComputedStyle(n).position)) === 'sticky';

  // Pin the Customer column (header label "Customer").
  await page.getByTestId('sticky-columns-button').click();
  await page.getByRole('checkbox', { name: 'Customer', exact: true }).check();
  await page.getByTestId('sticky-columns-button').click();

  await page.reload();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect.poll(() => isSticky(cellFor(customerName))).toBe(true);

  // Hide the pinned column: it is no longer rendered at all.
  await openColumns(page);
  await page.getByRole('checkbox', { name: 'Customer', exact: true }).uncheck();
  await closeColumns(page);
  await expect(gridHeader(page, 'Customer')).toHaveCount(0);

  // Re-show it: the pin is restored.
  await openColumns(page);
  await page.getByRole('checkbox', { name: 'Customer', exact: true }).check();
  await closeColumns(page);
  await expect.poll(() => isSticky(cellFor(customerName))).toBe(true);

  await page.request.delete(`/api/projects/${created.id}`, { headers });
  await page.request.delete(`/api/customers/${customer.id}`, { headers });
});

test('API rejects a bad payload and has no per-user route', async ({ page }) => {
  const token = await apiToken(page, ADMIN.email, ADMIN.password);
  const headers = { Authorization: `Bearer ${token}` };

  const bad = await page.request.put('/api/me/preferences/grid-columns', {
    headers,
    data: { hidden_column_ids: 123 },
  });
  expect(bad.status()).toBe(400);

  // The route is scoped to the caller's token — there is no user id to target.
  const other = await page.request.get('/api/me/preferences/grid-columns/some-other-user', { headers });
  expect(other.status()).toBe(404);
});
