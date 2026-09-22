import { test, expect } from '@playwright/test';

// Covers the sticky-columns + project-wide hover gates from plan_sticky:
// 1. defaults stick (#, Folder, Project) and Sales doesn't;
// 2. pinning a Customer column sticks it at the left edge exactly after the
//    three default columns on horizontal scroll, with its neighbours sliding
//    underneath;
// 3. the selection persists across reloads per user and Reset restores defaults;
// 4. hovering any vendor line tints every row of that project — sticky cells
//    included — and clears again when the pointer leaves the table.
//
// Fixtures are created through the admin API with pre-2000 created_at values so
// they land first on page 1 under the default created_at-ASC order (the Project
// column isn't sortable), and cleaned up by name afterwards.

const ADMIN = { email: 'admin@example.com', password: 'admin12345' };

async function login(page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/grid/, { timeout: 15000 });
}

async function adminToken(page) {
  const token = await page.evaluate(() => localStorage.getItem('tracker.accessToken'));
  expect(token).toBeTruthy();
  return token as string;
}

async function adminApi(page) {
  const headers = { Authorization: `Bearer ${await adminToken(page)}` };

  const createVendor = async (name: string): Promise<string> => {
    const res = await page.request.post('/api/vendors', { headers, data: { name } });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).id as string;
  };

  const createProject = async (
    name: string,
    lines: Array<{ vendor_id: string }>,
    createdAt: string,
  ) => {
    const res = await page.request.post('/api/projects', {
      headers,
      data: {
        project_name: name,
        vendors: lines.map((l, i) => ({ vendor_id: l.vendor_id, sort_order: i })),
      },
    });
    expect(res.ok()).toBeTruthy();
    const id = (await res.json()).id as string;
    const patch = await page.request.patch(`/api/projects/${id}`, { headers, data: { created_at: createdAt } });
    expect(patch.ok()).toBeTruthy();
    return id;
  };

  const deleteProjects = async (names: string[]) => {
    const res = await page.request.get('/api/projects?page_size=500&sort_by=project_name&sort_dir=asc', { headers });
    expect(res.ok()).toBeTruthy();
    const rows = (await res.json()).rows as Array<{ id: string; project_name: string }>;
    for (const row of rows) {
      if (names.some((n) => row.project_name === n)) {
        const d = await page.request.delete(`/api/projects/${row.id}`, { headers });
        expect(d.ok()).toBeTruthy();
      }
    }
  };

  return { createVendor, createProject, deleteProjects };
}

async function clearStickyStorage(page) {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('tracker.grid.stickyColumns.')) localStorage.removeItem(key);
    }
  });
}

async function reloadAndShowFirst(page, firstProject: string) {
  await page.goto('/grid');
  await expect(page.getByText(firstProject, { exact: true })).toBeVisible();
}

async function stickyPosition(cell) {
  return cell.evaluate((el: HTMLElement) => getComputedStyle(el).position);
}

async function cellBg(cell) {
  return cell.evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor);
}

// Column geometry (display order, SUPER_ADMIN): the three defaults sit at
// indexes 0..2, Sales at 3; the Customer group starts at index 7 (customer_name)
// with market_segment right behind it at 8. Defaults total 48+160+300 = 508px.
const IDX = { number: 0, folder: 1, project: 2, sales: 3, customer: 7, marketSegment: 8 };

test('default sticky set pins #, Folder and Project and leaves Sales flowing', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  const api = await adminApi(page);
  await api.deleteProjects(['0 E2E Sticky Defaults']);

  const vendor = await api.createVendor('0 E2E Sticky Defaults Vendor');
  await api.createProject('0 E2E Sticky Defaults', [{ vendor_id: vendor }], '1999-12-31T00:00:00.000Z');

  await clearStickyStorage(page);
  await reloadAndShowFirst(page, '0 E2E Sticky Defaults');

  const row = page
    .getByText('0 E2E Sticky Defaults', { exact: true })
    .locator('xpath=ancestor::div[@role="row"]');
  const cells = row.locator('div[role="cell"]');

  await expect(await stickyPosition( cells.nth(IDX.number))).toBe('sticky');
  await expect(await stickyPosition( cells.nth(IDX.folder))).toBe('sticky');
  await expect(await stickyPosition( cells.nth(IDX.project))).toBe('sticky');
  await expect(await stickyPosition( cells.nth(IDX.sales))).not.toBe('sticky');

  await api.deleteProjects(['0 E2E Sticky Defaults']);
});

test('a newly pinned Customer column sticks at the edge after the defaults', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  const api = await adminApi(page);
  await api.deleteProjects(['0 E2E Sticky Edge']);

  const vendor = await api.createVendor('0 E2E Sticky Edge Vendor');
  await api.createProject('0 E2E Sticky Edge', [{ vendor_id: vendor }], '1999-12-30T00:00:00.000Z');

  await clearStickyStorage(page);
  await reloadAndShowFirst(page, '0 E2E Sticky Edge');

  await page.getByTestId('sticky-columns-button').click();
  await page.getByRole('checkbox', { name: 'Customer', exact: true }).check();
  await page.getByTestId('sticky-columns-button').click();

  const table = page.getByRole('table');
  const row = page
    .getByText('0 E2E Sticky Edge', { exact: true })
    .locator('xpath=ancestor::div[@role="row"]');
  const cells = row.locator('div[role="cell"]');

  // The Customer cell is sticky at 508px (the defaults' combined width) once
  // its natural position scrolls past the left edge.
  await expect(await stickyPosition( cells.nth(IDX.customer))).toBe('sticky');

  await table.evaluate((el: HTMLElement) => {
    el.scrollLeft = 2000;
  });
  await page.waitForTimeout(100);

  const [customerX, tableX] = await Promise.all([
    cells.nth(IDX.customer).evaluate((el: HTMLElement) => el.getBoundingClientRect().x),
    table.evaluate((el: HTMLElement) => el.getBoundingClientRect().x),
  ]);
  const relX = customerX - tableX;
  expect(Math.abs(relX - 508)).toBeLessThanOrEqual(4);

  // Its non-sticky neighbour (Market Segment) has scrolled past it to the left.
  const marketX = await cells.nth(IDX.marketSegment).evaluate((el: HTMLElement) => el.getBoundingClientRect().x);
  expect(marketX).toBeLessThan(customerX);

  await api.deleteProjects(['0 E2E Sticky Edge']);
});

test('the sticky selection persists across reloads and Reset restores defaults', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  const api = await adminApi(page);
  await api.deleteProjects(['0 E2E Sticky Persist']);

  const vendor = await api.createVendor('0 E2E Sticky Persist Vendor');
  await api.createProject('0 E2E Sticky Persist', [{ vendor_id: vendor }], '1999-12-29T00:00:00.000Z');

  await clearStickyStorage(page);
  await reloadAndShowFirst(page, '0 E2E Sticky Persist');

  await page.getByTestId('sticky-columns-button').click();
  await page.getByRole('checkbox', { name: 'Customer', exact: true }).check();
  await page.getByTestId('sticky-columns-button').click();

  await reloadAndShowFirst(page, '0 E2E Sticky Persist');
  const row = page
    .getByText('0 E2E Sticky Persist', { exact: true })
    .locator('xpath=ancestor::div[@role="row"]');
  const cells = row.locator('div[role="cell"]');
  await expect(await stickyPosition( cells.nth(IDX.customer))).toBe('sticky');

  await page.getByTestId('sticky-columns-button').click();
  await page.getByTestId('sticky-reset').click();

  await expect(await stickyPosition( cells.nth(IDX.customer))).not.toBe('sticky');
  await expect(await stickyPosition( cells.nth(IDX.number))).toBe('sticky');

  await api.deleteProjects(['0 E2E Sticky Persist']);
});

test('hovering one vendor line tints every row of the project, sticky cells included', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  const api = await adminApi(page);
  await api.deleteProjects(['0 E2E Sticky Hover']);

  const vendor = await api.createVendor('0 E2E Sticky Hover Vendor');
  await api.createProject(
    '0 E2E Sticky Hover',
    [{ vendor_id: vendor }, { vendor_id: vendor }],
    '1999-12-28T00:00:00.000Z',
  );

  await clearStickyStorage(page);
  await reloadAndShowFirst(page, '0 E2E Sticky Hover');

  // First on page 1 (created_at 1999), so this project sits on a WHITE stripe:
  // base rgb(255,255,255), hover rgb(243,244,246).
  const row1 = page
    .getByText('0 E2E Sticky Hover', { exact: true })
    .locator('xpath=ancestor::div[@role="row"]');
  const row2 = page
    .getByText('0 E2E Sticky Hover Vendor', { exact: true })
    .last()
    .locator('xpath=ancestor::div[@role="row"]');
  const projectCell1 = row1.locator('div[role="cell"]').nth(IDX.project);
  const projectCell2 = row2.locator('div[role="cell"]').nth(IDX.project);

  await expect(await cellBg( projectCell1)).toBe('rgb(255, 255, 255)');
  await expect(await cellBg( projectCell2)).toBe('rgb(255, 255, 255)');

  // Hover the second vendor line → BOTH lines' sticky Project cells tint.
  await page.getByText('0 E2E Sticky Hover Vendor', { exact: true }).last().hover();
  await expect(await cellBg( projectCell1)).toBe('rgb(243, 244, 246)');
  await expect(await cellBg( projectCell2)).toBe('rgb(243, 244, 246)');

  // Pointer leaves the table → both revert to the white stripe.
  await page.mouse.move(0, 0);
  await expect(await cellBg( projectCell1)).toBe('rgb(255, 255, 255)');
  await expect(await cellBg( projectCell2)).toBe('rgb(255, 255, 255)');

  await api.deleteProjects(['0 E2E Sticky Hover']);
});