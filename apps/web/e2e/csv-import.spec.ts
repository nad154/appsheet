import { test, expect, type Page } from '@playwright/test';
import { scrollGridTo } from './helpers';

// Covers the CSV import wizard from plan_csv_import §10:
// - unusual CSV headers map through FIELD LABELS, never the internal keys;
// - changing a pick updates the description shown under the dropdown;
// - the same platform field cannot be chosen by two CSV columns;
// - project_name unmapped keeps "Next: Preview" disabled;
// - preview counts -> commit -> the imported projects appear in the grid;
// - reopening with the same CSV re-applies the saved mapping;
// - STAFF never sees the Import CSV button.
//
// Fixtures use the `0 E2E CSV Import` prefix and are deleted through the API
// before and after (like the other specs), so the suite stays idempotent even
// when re-run without a reseed. Customer/vendor names carry a timestamp so the
// "new entity" preview counts stay deterministic on every run.

const ADMIN = { email: 'admin@example.com', password: 'admin12345' };
const STAFF = { email: 'staff1@example.com', password: 'staff12345' };
const PROJECT_PREFIX = '0 E2E CSV Import';

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/login');
  await page.fill('#email', user.email);
  await page.fill('#password', user.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/grid/, { timeout: 15000 });
}

async function authHeaders(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('tracker.accessToken'));
  expect(token).toBeTruthy();
  return { Authorization: `Bearer ${token}` };
}

async function deleteImportProjects(page: Page) {
  const headers = await authHeaders(page);
  const res = await page.request.get('/api/projects?page_size=500', { headers });
  expect(res.ok()).toBeTruthy();
  const rows = (await res.json()).rows as Array<{ id: string; project_name: string }>;
  for (const row of rows) {
    if (row.project_name.startsWith(PROJECT_PREFIX)) {
      const del = await page.request.delete(`/api/projects/${row.id}`, { headers });
      expect(del.ok()).toBeTruthy();
    }
  }
}

async function resetImportMapping(page: Page) {
  const headers = await authHeaders(page);
  const res = await page.request.delete('/api/me/preferences/import-mapping', { headers });
  expect(res.ok()).toBeTruthy();
}

async function openWizard(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Import projects from CSV' });
  // The wizard's mapping seed waits for this GET. Anchor it before the modal
  // mounts so the cached-but-stale refetch can't race the assertions below.
  const mappingLoaded = page.waitForResponse(
    (r) => r.url().includes('/api/me/preferences/import-mapping') && r.request().method() === 'GET',
  );
  await page.getByTestId('open-import-csv').click();
  await expect(dialog).toBeVisible();
  await mappingLoaded;
  return dialog;
}

async function uploadCsv(page: Page, fileName: string, csv: string) {
  await page.getByTestId('import-file-input').setInputFiles({
    name: fileName,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
}

/**
 * The option whose registry LABEL (a child span) is exactly `label`.
 * The inner `has` locator must be ROOTED AT THE PAGE: a scope-rooted inner
 * serializes as `<dialog> >> span:...` and gets re-resolved inside each
 * candidate option (which contains no dialog), so it never matches.
 */
function fieldOption(page: Page, scope: ReturnType<Page['locator']>, label: string) {
  return scope.locator('[role="option"]', { has: page.locator(`span:text-is("${label}")`) });
}

function summaryItem(scope: ReturnType<Page['locator']>, label: string) {
  return scope.locator('li').filter({ hasText: label }).first();
}

test('mapping step shows labels, refreshes descriptions and blocks duplicate fields', async ({ page }) => {
  await login(page, ADMIN);
  await resetImportMapping(page);

  const dialog = await openWizard(page);
  await uploadCsv(page, 'unusual-headers.csv', [
    'Prog,Client',
    '0 E2E CSV Map One,PT CSV Client One',
    '0 E2E CSV Map Two,PT CSV Client Two',
  ].join('\n'));

  await expect(dialog.getByText('2 data rows, 2 columns')).toBeVisible();
  await dialog.getByRole('button', { name: 'Next: Map columns' }).click();
  await expect(dialog.getByText('Step 2 of 4')).toBeVisible();

  // project_name unmapped: banner shown, Next disabled (plan §10).
  await expect(dialog.getByRole('alert')).toHaveText(/Map a CSV column to Project Name to continue/);
  await expect(dialog.getByRole('button', { name: 'Next: Preview' })).toBeDisabled();

  // The plan's sentence carries the CSV header and the field LABEL — the
  // internal key (project_name) never shows up in the window.
  await expect(dialog.getByText('“Prog”')).toBeVisible();
  await expect(dialog.getByText('(from the CSV) will be mapped to')).toHaveCount(2);
  await expect(dialog.getByText('project_name')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Platform field for CSV column Prog' })).toHaveText('Ignore this column');

  // Changing the pick swaps the description shown under the dropdown.
  await dialog.getByRole('button', { name: 'Platform field for CSV column Prog' }).click();
  await fieldOption(page, dialog, 'Market Segment').click();
  await expect(dialog.getByText('Free-text segment, e.g. Government, Enterprise')).toBeVisible();

  await dialog.getByRole('button', { name: 'Platform field for CSV column Prog' }).click();
  await fieldOption(page, dialog, 'Customer').click();
  await expect(dialog.getByText('Customer name. Matched ignoring case')).toBeVisible();
  await expect(dialog.getByText('Free-text segment, e.g. Government, Enterprise')).toHaveCount(0);

  // Map the other column to Project Name — the banner clears, Next unlocks.
  await dialog.getByRole('button', { name: 'Platform field for CSV column Client' }).click();
  await fieldOption(page, dialog, 'Project Name').click();
  await expect(dialog.getByText('Name of the project. Rows with the same project name')).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Next: Preview' })).toBeEnabled();

  // A second column cannot take the same platform field.
  await dialog.getByRole('button', { name: 'Platform field for CSV column Prog' }).click();
  await expect(fieldOption(page, dialog, 'Project Name')).toBeDisabled();
  await expect(fieldOption(page, dialog, 'Project Name')).toHaveAttribute('title', 'Already used by "Client"');
  await dialog.getByRole('button', { name: 'Platform field for CSV column Prog' }).click();

  await expect(dialog.getByText('project_name')).toHaveCount(0);
  await dialog.locator('button[aria-label="Close"]').click();
  await expect(dialog).toHaveCount(0);
});

test('preview counts, commit and the imported projects land in the grid', async ({ page }) => {
  await login(page, ADMIN);
  await resetImportMapping(page);
  await deleteImportProjects(page);

  const ts = Date.now();
  const customer = `PT0 E2E CSV Customer ${ts}`;
  const vendorA = `0 E2E CSV Vendor A ${ts}`;
  const vendorB = `0 E2E CSV Vendor B ${ts}`;
  const alpha = '0 E2E CSV Import Alpha';
  const beta = '0 E2E CSV Import Beta';

  const dialog = await openWizard(page);
  await uploadCsv(page, 'csv-import-fixture.csv', [
    'project_name,customer_name,market_segment,vendor_name,vendor_price,project_sent_date',
    `${alpha},${customer},Government,${vendorA},100000000,01/10/2026`,
    `${beta},${customer},Government,${vendorB},200000000,02/10/2026`,
  ].join('\n'));

  await expect(dialog.getByText('2 data rows, 6 columns')).toBeVisible();
  await dialog.getByRole('button', { name: 'Next: Map columns' }).click();
  await expect(dialog.getByText('Step 2 of 4')).toBeVisible();

  // Canonical headers exact-match the registry and arrive pre-selected.
  await expect(dialog.getByText('suggested')).toHaveCount(6);
  await expect(dialog.getByRole('button', { name: 'Platform field for CSV column project_name' })).toHaveText('Project Name');
  await expect(dialog.getByRole('button', { name: 'Platform field for CSV column customer_name' })).toHaveText('Customer');
  await expect(dialog.getByRole('button', { name: 'Platform field for CSV column market_segment' })).toHaveText('Market Segment');
  await expect(dialog.getByRole('button', { name: 'Platform field for CSV column vendor_name' })).toHaveText('Vendor');
  await expect(dialog.getByRole('button', { name: 'Platform field for CSV column vendor_price' })).toHaveText('Vendor PO/PKS Amount');
  await expect(dialog.getByRole('button', { name: 'Platform field for CSV column project_sent_date' })).toHaveText('FPT Sent Date');

  await dialog.getByRole('button', { name: 'Next: Preview' }).click();
  await expect(dialog.getByText('Step 3 of 4')).toBeVisible();

  await expect(summaryItem(dialog, 'Projects to create')).toContainText('2');
  await expect(summaryItem(dialog, 'Vendor lines to create')).toContainText('2');
  await expect(summaryItem(dialog, 'New customers')).toContainText('1');
  await expect(summaryItem(dialog, 'New vendors')).toContainText('2');
  await expect(summaryItem(dialog, 'Rows skipped as duplicates')).toContainText('0');
  await expect(summaryItem(dialog, 'Rows with errors')).toContainText('0');
  await expect(dialog.locator('td').filter({ hasText: alpha })).toHaveCount(1);
  await expect(dialog.locator('td').filter({ hasText: vendorA })).toHaveCount(1);

  await dialog.getByRole('button', { name: 'Next: Confirm' }).click();
  await expect(dialog.getByText('Step 4 of 4')).toBeVisible();
  await expect(dialog.getByText('either every project is created, or nothing is')).toBeVisible();

  await dialog.getByRole('button', { name: 'Import 2 projects' }).click();

  const result = dialog.getByTestId('import-result');
  await expect(result).toContainText('2 projects imported');
  await expect(result.locator('li').filter({ hasText: 'Vendor lines' })).toContainText('2');
  await expect(result.locator('li').filter({ hasText: 'New vendors' })).toContainText('2');
  await expect(page.getByText('Imported 2 projects.', { exact: true })).toBeVisible();

  await dialog.locator('button[aria-label="Close"]').click();
  await expect(dialog).toHaveCount(0);

  // The grid sorts created_at ASC, so fresh imports land on the LAST page of
  // a 100+ row dataset and never enter page 1's virtualized window. Like the
  // other specs (multi-vendor, sticky-columns), pin the fixtures to an old
  // created_at and reload so they surface at the top of page 1.
  const headers = await authHeaders(page);
  const list = await page.request.get('/api/projects?page_size=500', { headers });
  expect(list.ok()).toBeTruthy();
  const listRows = (await list.json()).rows as Array<{ id: string; project_name: string }>;
  let pinned = 0;
  for (const row of listRows) {
    if (row.project_name.startsWith(PROJECT_PREFIX)) {
      const patch = await page.request.patch(`/api/projects/${row.id}`, {
        headers,
        data: { created_at: '1999-12-30T00:00:00.000Z' },
      });
      expect(patch.ok()).toBeTruthy();
      pinned++;
    }
  }
  expect(pinned).toBe(2);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Project Grid' })).toBeVisible();
  await scrollGridTo(page, alpha);
  await expect(page.getByText(alpha, { exact: true })).toBeVisible();
  await scrollGridTo(page, beta);
  await expect(page.getByText(beta, { exact: true })).toBeVisible();

  await deleteImportProjects(page);
});

test('reopening with the same CSV re-applies the saved column mapping', async ({ page }) => {
  await login(page, ADMIN);
  await resetImportMapping(page);

  const csv = [
    'Doc Title,Counterparty',
    '0 E2E CSV Saved Map,PT CSV Counterparty',
  ].join('\n');

  const dialog = await openWizard(page);
  await uploadCsv(page, 'saved-mapping.csv', csv);
  await dialog.getByRole('button', { name: 'Next: Map columns' }).click();

  // Unusual headers: nothing is suggested, so project_name stays unmapped.
  await expect(dialog.getByRole('button', { name: 'Platform field for CSV column Doc Title' })).toHaveText('Ignore this column');
  await expect(dialog.getByRole('button', { name: 'Platform field for CSV column Counterparty' })).toHaveText('Ignore this column');
  await expect(dialog.getByRole('button', { name: 'Next: Preview' })).toBeDisabled();

  // Map by hand — "Save this mapping for next time" is ticked by default.
  await expect(dialog.getByLabel('Save this mapping for next time')).toBeChecked();
  await dialog.getByRole('button', { name: 'Platform field for CSV column Doc Title' }).click();
  await fieldOption(page, dialog, 'Project Name').click();
  await dialog.getByRole('button', { name: 'Platform field for CSV column Counterparty' }).click();
  await fieldOption(page, dialog, 'Customer').click();

  const saved = page.waitForResponse(
    (r) => r.url().includes('/api/me/preferences/import-mapping') && r.request().method() === 'PUT',
  );
  await dialog.getByRole('button', { name: 'Next: Preview' }).click();
  await saved;
  await expect(dialog.getByText('Step 3 of 4')).toBeVisible();

  await dialog.locator('button[aria-label="Close"]').click();
  await expect(dialog).toHaveCount(0);

  // Reopen with the same file: every column is pre-selected from the save.
  const reopened = await openWizard(page);
  await uploadCsv(page, 'saved-mapping.csv', csv);
  await reopened.getByRole('button', { name: 'Next: Map columns' }).click();
  await expect(reopened.getByRole('button', { name: 'Platform field for CSV column Doc Title' })).toHaveText('Project Name');
  await expect(reopened.getByRole('button', { name: 'Platform field for CSV column Counterparty' })).toHaveText('Customer');
  await expect(reopened.getByText('saved', { exact: true })).toHaveCount(2);
  await expect(reopened.getByRole('alert')).toHaveCount(0);
  await expect(reopened.getByRole('button', { name: 'Next: Preview' })).toBeEnabled();

  await reopened.locator('button[aria-label="Close"]').click();
  await resetImportMapping(page);
});

test('staff does not see the Import CSV button', async ({ page }) => {
  await login(page, STAFF);
  await expect(page).toHaveURL(/\/grid/);
  await expect(page.getByTestId('open-import-csv')).toHaveCount(0);
});
