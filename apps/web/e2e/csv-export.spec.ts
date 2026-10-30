import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { scrollGridTo } from './helpers';

// Covers the plan_csv_export acceptance gates through the UI:
// - the Export CSV button downloads a file named projects-<date>.csv;
// - the file is UTF-8 BOM + CRLF, one row per vendor line, project values
//   repeated on each line, and a single blank-vendor row for a vendorless
//   project;
// - the four info-only columns trail the import registry columns;
// - the current Stage filter is applied (not just the visible page);
// - STAFF can export, and only sees their own scope.
//
// Fixtures use the `0 E2E CSV Export` prefix and are deleted through the API
// before and after each test, so the suite stays idempotent without a reseed.

const ADMIN = { email: 'admin@example.com', password: 'admin12345' };
const STAFF = { email: 'staff1@example.com', password: 'staff12345' };
const PROJECT_PREFIX = '0 E2E CSV Export';

const INFO_HEADERS = ['Aging (days)', 'Priority', 'Update Progress', 'Action'];

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/login');
  await page.fill('#email', user.email);
  await page.fill('#password', user.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/grid/, { timeout: 15000 });
}

async function apiToken(page: Page, user: { email: string; password: string }) {
  const res = await page.request.post('/api/auth/login', { data: user });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { accessToken?: string; access_token?: string };
  const token = body.accessToken ?? body.access_token;
  expect(token).toBeTruthy();
  return token as string;
}

async function cleanup(page: Page, headers: Record<string, string>) {
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

/** Minimal RFC 4180 reader: split('\n') would break on quoted newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r') {
      // CRLF: the LF ends the row.
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) rows.push([...row, cell]);
  return rows;
}

/** Click Export CSV and read the downloaded text back from disk. */
async function downloadCsv(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-csv').click(),
  ]);
  const path = await download.path();
  expect(path).toBeTruthy();
  const text = await readFile(path as string, 'utf8');
  // Excel/Sheets-compatible BOM — strip it before comparing the header line.
  expect(text.startsWith('\uFEFF')).toBe(true);
  return { download, text, rows: parseCsv(text.slice(1)) };
}

test('admin export contains one row per vendor line, all pages, BOM + CRLF', async ({ page }) => {
  await login(page, ADMIN);
  const headers = { Authorization: `Bearer ${await apiToken(page, ADMIN)}` };
  await cleanup(page, headers);

  const vendorRes = await page.request.post('/api/vendors', {
    headers,
    data: { name: '0 E2E CSV Export Vendor' },
  });
  expect(vendorRes.ok()).toBeTruthy();
  const vendorId = (await vendorRes.json()).id as string;

  const multiRes = await page.request.post('/api/projects', {
    headers,
    data: {
      project_name: `${PROJECT_PREFIX} Multi`,
      current_stage: 'on_progress',
      vendors: [
        { vendor_id: vendorId, project_sent_date: '2026-08-01', sort_order: 0 },
        { vendor_id: vendorId, project_sent_date: '2026-08-02', sort_order: 1 },
      ],
    },
  });
  expect(multiRes.ok()).toBeTruthy();
  const soloRes = await page.request.post('/api/projects', {
    headers,
    data: { project_name: `${PROJECT_PREFIX} Solo`, current_stage: 'on_progress', vendors: [] },
  });
  expect(soloRes.ok()).toBeTruthy();

  try {
    await page.reload();
    const { download, text, rows } = await downloadCsv(page);

    // Content-Disposition round-trips through the API client's filename parser.
    expect(download.suggestedFilename()).toMatch(/^projects-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(text).toContain('\r\n');
    expect(/[^\r]\n/.test(text)).toBe(false);

    const header = rows[0];
    expect(header[0]).toBe('Project Name');
    expect(header).toContain('FPT Sent Date');
    expect(header.slice(-INFO_HEADERS.length)).toEqual(INFO_HEADERS);

    const dataRows = rows.slice(1).filter((r) => r.some((c) => c !== ''));
    const nameCol = 0; // project_name is the first registry field
    const vendorCol = header.indexOf('Vendor');
    const multiRows = dataRows.filter((r) => r[nameCol] === `${PROJECT_PREFIX} Multi`);
    const soloRows = dataRows.filter((r) => r[nameCol] === `${PROJECT_PREFIX} Solo`);

    expect(multiRows).toHaveLength(2);
    expect(multiRows.map((r) => r[vendorCol])).toEqual([
      '0 E2E CSV Export Vendor',
      '0 E2E CSV Export Vendor',
    ]);
    // Project-level values repeat on every vendor line.
    expect(multiRows.every((r) => r[nameCol] === `${PROJECT_PREFIX} Multi`)).toBe(true);

    expect(soloRows).toHaveLength(1);
    expect(soloRows[0][vendorCol]).toBe('');
  } finally {
    await cleanup(page, headers);
  }
});

test('export honours the Stage filter', async ({ page }) => {
  await login(page, ADMIN);
  const headers = { Authorization: `Bearer ${await apiToken(page, ADMIN)}` };
  await cleanup(page, headers);

  const onProgress = await page.request.post('/api/projects', {
    headers,
    data: { project_name: `${PROJECT_PREFIX} Progress`, current_stage: 'on_progress', vendors: [] },
  });
  expect(onProgress.ok()).toBeTruthy();
  const finished = await page.request.post('/api/projects', {
    headers,
    data: { project_name: `${PROJECT_PREFIX} Finished`, current_stage: 'finish', vendors: [] },
  });
  expect(finished.ok()).toBeTruthy();

  try {
    await page.reload();
    await page.getByLabel('Filter by project stage').selectOption('finish');
    // Wait for the grid to settle on the filtered query before exporting.
    // Rows are virtualized, so scroll the fixture into the rendered window.
    await scrollGridTo(page, `${PROJECT_PREFIX} Finished`);
    await expect(page.getByText(`${PROJECT_PREFIX} Finished`, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`${PROJECT_PREFIX} Progress`, { exact: true })).toHaveCount(0);

    const { rows } = await downloadCsv(page);
    const names = rows.slice(1).map((r) => r[0]);
    expect(names).toContain(`${PROJECT_PREFIX} Finished`);
    expect(names).not.toContain(`${PROJECT_PREFIX} Progress`);
  } finally {
    await cleanup(page, headers);
  }
});

test('STAFF can export and only sees their own projects', async ({ page }) => {
  // Relies on the manual apps/server/_rbac_setup.ts fixtures, like grid.spec.ts
  // and priority.spec.ts do.
  await login(page, STAFF);
  const { rows } = await downloadCsv(page);
  const names = rows.slice(1).map((r) => r[0]);
  expect(names).toContain('Staff Project A');
  expect(names).not.toContain('Admin Project A');
});
