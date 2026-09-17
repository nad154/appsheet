import { test, expect } from '@playwright/test';

// Covers the multi-vendor grid gates from planning_customers_vendors:
// 1. the blank-second-row visual — a project's cells render only on its first
//    (group-header) row, later vendor lines get empty continuation rows;
// 2. add/remove of vendor lines in the edit modal;
// 3. the §3.1 greedy pagination boundary — a project whose vendor lines don't
//    fit the remaining space of a page starts fresh on the next page rather
//    than splitting, and the page it deferred from renders fewer than
//    page_size rows.
//
// Fixtures are created through the API (exact line counts, no dependence on
// the seeded projects) and cleaned up afterwards, so each test is idempotent
// even when the suite is re-run without a reseed.

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

// Runs everything through the admin API so vendor-line counts are exact.
async function adminApi(page) {
  const headers = { Authorization: `Bearer ${await adminToken(page)}` };

  const createVendor = async (name: string): Promise<string> => {
    const res = await page.request.post('/api/vendors', { headers, data: { name } });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).id as string;
  };

  const createProject = async (name: string, lines: Array<{ vendor_id: string; project_sent_date?: string }>) => {
    const res = await page.request.post('/api/projects', {
      headers,
      data: {
        project_name: name,
        vendors: lines.map((l, i) => ({
          vendor_id: l.vendor_id,
          project_sent_date: l.project_sent_date ?? null,
          sort_order: i,
        })),
      },
    });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).id as string;
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

function thirtyDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

// Click the Project column header once (first click ⇒ ASC, no prior sort in a
// fresh context) and wait for the server-side reorder to land: the Project
// header appends a "↑" arrow once sorted, so instead of inspecting aria-sort we
// just wait for the row that must sort first under project_name ASC.
async function sortByNameAsc(page, firstProject: string) {
  const header = page.getByRole('columnheader', { name: 'Project', exact: true });
  await header.click();
  await expect(page.getByText(firstProject, { exact: true })).toBeVisible();
}

test('a multi-vendor project renders its project cells only on the first vendor row', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  const api = await adminApi(page);
  await api.deleteProjects(['0 E2E MV Alpha']);

  const v1 = await api.createVendor('0 E2E Alpha Vendor One');
  const v2 = await api.createVendor('0 E2E Alpha Vendor Two');
  await api.createProject('0 E2E MV Alpha', [
    { vendor_id: v1, project_sent_date: thirtyDaysAgo() },
    { vendor_id: v2 },
  ]);

  await sortByNameAsc(page, '0 E2E MV Alpha');

  // The name appears exactly once — on the group-header row, which doubles as
  // the first vendor line's row.
  const name = page.getByText('0 E2E MV Alpha', { exact: true });
  await expect(name).toBeVisible();
  await expect(name).toHaveCount(1);
  const headerRow = name.locator('xpath=ancestor::div[@role="row"]');
  await expect(headerRow.getByText('0 E2E Alpha Vendor One', { exact: true })).toBeVisible();

  // The second vendor line is a continuation row: the project-name cell is
  // empty (muted dash, per the mock) instead of repeating the name.
  const line2Row = page
    .getByText('0 E2E Alpha Vendor Two', { exact: true })
    .locator('xpath=ancestor::div[@role="row"]');
  await expect(line2Row).toBeVisible();
  await expect(line2Row.getByText('0 E2E MV Alpha', { exact: true })).toHaveCount(0);
  await expect(line2Row.getByText('—', { exact: true }).first()).toBeVisible();

  await api.deleteProjects(['0 E2E MV Alpha']);
});

test('vendor lines can be added and removed in the edit modal', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  const api = await adminApi(page);
  await api.deleteProjects(['0 E2E MV Beta']);

  const v1 = await api.createVendor('0 E2E Beta Vendor One');
  const v2 = await api.createVendor('0 E2E Beta Vendor Two');
  await api.createProject('0 E2E MV Beta', [
    { vendor_id: v1, project_sent_date: thirtyDaysAgo() },
    { vendor_id: v2 },
  ]);

  await sortByNameAsc(page, '0 E2E MV Beta');

  const name = page.getByText('0 E2E MV Beta', { exact: true });
  await expect(name).toBeVisible();
  await name.hover();
  const pencil = name.locator('xpath=ancestor::div[@role="row"]').locator('button[title="Edit project"]');
  await expect(pencil).toBeVisible();
  await pencil.click();
  const dialog = page.getByRole('dialog', { name: 'Edit 0 E2E MV Beta' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Vendor lines \(2\)/)).toBeVisible();

  // Add a third blank line and fill in vendor + sent date.
  await dialog.getByRole('button', { name: '+ Add vendor' }).click();
  const line3 = dialog.getByText('Vendor 3', { exact: true }).locator('xpath=ancestor::div[contains(@class,"border-gray-200")]');
  await dialog.getByLabel('Vendor 3').fill('0 E2E Beta Vendor Three');
  await dialog.getByRole('button', { name: 'Add "0 E2E Beta Vendor Three"' }).click();
  await line3.getByLabel('Project sent date').fill(thirtyDaysAgo());
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The new line shows up in the grid as a third display row.
  await expect(page.getByText('0 E2E Beta Vendor Three', { exact: true })).toBeVisible();

  // Reopen: three lines now; removing line 3 reverts to two.
  await name.hover();
  await pencil.click();
  const dialog2 = page.getByRole('dialog', { name: 'Edit 0 E2E MV Beta' });
  await expect(dialog2).toBeVisible();
  await expect(dialog2.getByText(/Vendor lines \(3\)/)).toBeVisible();
  const line3Again = dialog2.getByText('Vendor 3', { exact: true }).locator('xpath=ancestor::div[contains(@class,"border-gray-200")]');
  await line3Again.getByRole('button', { name: 'Remove' }).click();
  await dialog2.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('0 E2E Beta Vendor Three', { exact: true })).toHaveCount(0);

  await api.deleteProjects(['0 E2E MV Beta']);
});

test('a project too large for the remaining page space starts fresh on the next page', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  const api = await adminApi(page);
  await api.deleteProjects(['0 E2E A1', '0 E2E A2', '0 E2E A3', '0 E2E BIG']);

  // Four projects that all sort consecutively under project_name ASC:
  // '0 E2E A1' < '0 E2E A2' < '0 E2E A3' < '0 E2E BIG'. The fillers carry one
  // line each; BIG carries exactly page_size (25) lines — it can never share a
  // page with another project, so after A1..A3 it must start fresh on the next
  // page rather than split (planning_customers_vendors §3.1 / Phase 5 gate).
  const vA1 = await api.createVendor('0 E2E AV1');
  const vA2 = await api.createVendor('0 E2E AV2');
  const vA3 = await api.createVendor('0 E2E AV3');
  await api.createProject('0 E2E A1', [{ vendor_id: vA1 }]);
  await api.createProject('0 E2E A2', [{ vendor_id: vA2 }]);
  await api.createProject('0 E2E A3', [{ vendor_id: vA3 }]);
  const vBig = await api.createVendor('0 E2E BV');
  await api.createProject('0 E2E BIG', Array.from({ length: 25 }, () => ({ vendor_id: vBig })));

  await page.getByLabel('Rows per page').selectOption('25');
  await sortByNameAsc(page, '0 E2E A1');

  // Page 1: only the three fillers — fewer than page_size rows — BIG deferred.
  await expect(page.getByText('0 E2E A1', { exact: true })).toBeVisible();
  await expect(page.getByText('0 E2E A2', { exact: true })).toBeVisible();
  await expect(page.getByText('0 E2E A3', { exact: true })).toBeVisible();
  await expect(page.getByText('0 E2E BIG', { exact: true })).toHaveCount(0);
  await expect(page.getByText('0 E2E BV', { exact: true })).toHaveCount(0);

  // Page 2: BIG starts fresh on its own page (not split with page 1, and no
  // other project shares the page with its 25 lines).
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('0 E2E BIG', { exact: true })).toBeVisible();
  await expect(page.getByText('0 E2E BV', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('0 E2E A1', { exact: true })).toHaveCount(0);
  await expect(page.getByText('0 E2E A2', { exact: true })).toHaveCount(0);
  await expect(page.getByText('0 E2E A3', { exact: true })).toHaveCount(0);

  // Page 3: content continues past BIG without it spilling over.
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText(/Page 3 of /)).toBeVisible();
  await expect(page.getByText('0 E2E BIG', { exact: true })).toHaveCount(0);

  await api.deleteProjects(['0 E2E A1', '0 E2E A2', '0 E2E A3', '0 E2E BIG']);
});