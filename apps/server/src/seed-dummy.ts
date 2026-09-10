import 'dotenv/config';
import { migrate } from './db/migrate.js';
import { runWrite, conn } from './db/connection.js';
import { uuid } from './lib/uuid.js';
import { exportSnapshots } from './db/export.js';
import { networkDays } from '@tracker/shared';
import { DEFAULT_AGING_LOW_MAX_DAYS, DEFAULT_AGING_MEDIUM_MAX_DAYS } from '@tracker/shared';

const DUMMY_COUNT = 100;
const NAME_PREFIX = 'Microsoft Project';
const CUSTOMER_NAME = 'Rotterdam Electrics company';

const SEGMENTS = ['Government', 'Enterprise', 'SME', 'Individual'];
const VENDORS = [
  'Feitoria Energy BV',
  'Nordwind Kraft GmbH',
  'Aurora Teknik AB',
  'Meridian Services Ltd',
  'Helios Power Systems',
  'BlueLine Utilities BV',
  'Vantage Grid Solutions',
  'Ostwind Renewables GmbH',
];
const ISSUES_POOL = [
  'Awaiting customer PO confirmation.',
  'Vendor pricing under review; re-quote expected this week.',
  'Missing doc 2 from customer; follow-up sent.',
  'Contract clause dispute with vendor, in negotiation.',
  'Customer requested scope change, impacting schedule.',
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20260910);

function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function roundToMillion(n: number): number {
  return Math.round(n / 1_000_000) * 1_000_000;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateOnly(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toIso(date: Date): string {
  const d = dateOnly(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimestamp(date: Date): string {
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function calendarDaysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((dateOnly(to).getTime() - dateOnly(from).getTime()) / 86_400_000));
}

// Back-date a sent date so that networkDays(sent, end) lands within the band
// around `targetAging` — the same computation the grid uses for Aging/Priority.
function backdateSentDate(targetAging: number, endDate: Date): Date {
  const end = dateOnly(endDate);
  let sent = addDays(end, -2);
  for (let step = 0; step < 2000; step++) {
    const days = networkDays(sent, end);
    if (days >= targetAging - 1 && days <= targetAging + 1) return sent;
    if (days > targetAging + 1) break;
    sent = addDays(sent, -1);
  }
  return addDays(end, -targetAging - 60);
}

type Band = 'high' | 'medium' | 'low' | 'none';

function bandForIndex(i: number): Band {
  if (i >= 92) return 'none';
  if (i % 3 === 0) return 'high';
  if (i % 3 === 1) return 'medium';
  return 'low';
}

function buildProject(i: number, today: Date): unknown[] {
  const band = bandForIndex(i);
  const isFinish = band !== 'none' && i % 3 === 2;
  const projectName = `${NAME_PREFIX} ${String(i + 1).padStart(3, '0')}`;
  const segment = SEGMENTS[i % SEGMENTS.length];
  const vendor = VENDORS[i % VENDORS.length];

  const agingTarget =
    band === 'none'
      ? 0
      : band === 'high'
        ? randInt(31, 60)
        : band === 'medium'
          ? randInt(16, DEFAULT_AGING_MEDIUM_MAX_DAYS)
          : randInt(1, DEFAULT_AGING_LOW_MAX_DAYS);

  // Aging end: for finished rows the approval date caps aging; for everything
  // else aging runs to today.
  const approvalDate = isFinish ? addDays(today, -randInt(1, 12)) : null;
  const agingEnd = approvalDate ?? today;
  const sentDate = band === 'none' ? null : backdateSentDate(agingTarget, agingEnd);

  const finishDate = isFinish
    ? addDays(approvalDate!, randInt(2, Math.min(10, calendarDaysBetween(approvalDate!, today))))
    : null;
  const negoDate =
    sentDate && (isFinish || rng() < 0.7)
      ? addDays(sentDate, randInt(1, Math.max(2, calendarDaysBetween(sentDate, isFinish ? approvalDate! : today))))
      : null;
  const documentSentDate =
    isFinish && finishDate
      ? addDays(approvalDate!, randInt(0, calendarDaysBetween(approvalDate!, finishDate)))
      : sentDate && rng() < 0.4
        ? addDays(sentDate, randInt(3, Math.max(3, calendarDaysBetween(sentDate, today) - 2)))
        : null;

  const doc1Date = sentDate ? addDays(sentDate, -randInt(0, 14)) : addDays(today, -randInt(20, 90));
  const doc2Date = addDays(doc1Date, randInt(0, 7));
  const customerStart = addDays(doc2Date, randInt(0, 10));
  const endInDays = randInt(180, 730);
  const customerEnd = addDays(customerStart, endInDays);
  const vendorStart = addDays(customerStart, randInt(0, 10));
  const vendorEnd = addDays(customerStart, randInt(endInDays, endInDays + 30));

  const deadlineSoon = band !== 'none' && !isFinish && i % 13 === 6;
  const custEnd = deadlineSoon ? addDays(today, randInt(1, 6)) : customerEnd;
  const vendEnd = deadlineSoon ? addDays(today, randInt(1, 6)) : vendorEnd;

  const customerPrice = roundToMillion(randInt(75, 2000) * 1_000_000);
  const vendorRevenue = roundToMillion(randInt(60, 1900) * 1_000_000);
  const vendorPrice = roundToMillion(randInt(50, 1800) * 1_000_000);

  const issues = rng() < 0.25 ? ISSUES_POOL[i % ISSUES_POOL.length] : null;
  const created = addDays(today, -randInt(0, 60));
  const createdTs = toTimestamp(created);
  const updated = addDays(today, -randInt(0, 20));
  const updatedTs = toTimestamp(updated);

  const pad4 = (n: number) => String(n).padStart(4, '0');
  const pad6 = (n: number) => String(n).padStart(6, '0');

  return [
    uuid(), // id
    null, // folder_name (blank)
    projectName, // project_name
    null, // staff_assigned_id (Sales blank)
    null, // drive_folder_id (blank)
    CUSTOMER_NAME, // customer_name
    segment, // market_segment
    'service', // service_or_goods
    toIso(doc1Date), // date_customer_received_doc1
    toIso(doc2Date), // date_customer_received_doc2
    `PO/ELE/2026/${pad4(i + 1000)}`, // doc2_number_id
    customerPrice, // customer_price
    toIso(customerStart), // customer_start_contract
    toIso(custEnd), // customer_end_contract
    vendor, // vendor_name
    vendorRevenue, // vendor_revenue (Nilai RAB)
    'service', // vendor_type
    sentDate ? toIso(sentDate) : null, // project_sent_date
    finishDate ? toIso(finishDate) : null, // project_finish_date
    `FPT/2026/${pad6(i + 100)}`, // vendor_project_id
    negoDate ? toIso(negoDate) : null, // negotiation_date
    approvalDate ? toIso(approvalDate) : null, // approval_date
    documentSentDate ? toIso(documentSentDate) : null, // document_sent_date
    `PO/2026/${pad6(i + 500)}`, // document_id
    vendorPrice, // vendor_price
    toIso(vendorStart), // vendor_start_contract
    toIso(vendEnd), // vendor_end_contract
    isFinish ? 'finish' : 'on_progress', // current_stage
    null, // pic_id (blank)
    issues, // issues
    createdTs, // created_at
    updatedTs, // updated_at
  ];
}

const PROJECT_COLUMNS = [
  'id',
  'folder_name',
  'project_name',
  'staff_assigned_id',
  'drive_folder_id',
  'customer_name',
  'market_segment',
  'service_or_goods',
  'date_customer_received_doc1',
  'date_customer_received_doc2',
  'doc2_number_id',
  'customer_price',
  'customer_start_contract',
  'customer_end_contract',
  'vendor_name',
  'vendor_revenue',
  'vendor_type',
  'project_sent_date',
  'project_finish_date',
  'vendor_project_id',
  'negotiation_date',
  'approval_date',
  'document_sent_date',
  'document_id',
  'vendor_price',
  'vendor_start_contract',
  'vendor_end_contract',
  'current_stage',
  'pic_id',
  'issues',
  'created_at',
  'updated_at',
];

const PROJECT_COLUMN_SQL = PROJECT_COLUMNS.join(', ');
const PROJECT_PLACEHOLDERS = PROJECT_COLUMNS.map(() => '?').join(', ');

interface PendingEditSpec {
  projectName: string;
  changes: Record<string, unknown>;
}

const PENDING_EDIT_SPECS: PendingEditSpec[] = [
  { projectName: `${NAME_PREFIX} 004`, changes: { customer_price: 875_000_000 } },
  { projectName: `${NAME_PREFIX} 010`, changes: { issues: 'Vendor requested revised pricing; awaiting internal approval.' } },
  { projectName: `${NAME_PREFIX} 015`, changes: { customer_end_contract: '2027-03-31', customer_price: 1_250_000_000 } },
  { projectName: `${NAME_PREFIX} 022`, changes: { market_segment: 'Enterprise' } },
  { projectName: `${NAME_PREFIX} 030`, changes: { vendor_price: 640_000_000 } },
  { projectName: `${NAME_PREFIX} 042`, changes: { customer_start_contract: '2026-10-01', customer_end_contract: '2028-09-30' } },
];

async function main(): Promise<void> {
  await migrate();

  const today = dateOnly(new Date());

  await runWrite(async (exec) => {
    // Idempotency guard: re-running must not duplicate the 100 dummy rows.
    const existing = await exec<{ id: string; project_name: string }>(
      `SELECT id, project_name FROM projects WHERE project_name LIKE '${NAME_PREFIX} %'`,
    );
    const nameToId = new Map<string, string>();
    for (const row of existing) nameToId.set(row.project_name, row.id);

    if (nameToId.size >= DUMMY_COUNT) {
      console.log(`Found ${nameToId.size} '${NAME_PREFIX}' rows — skipping project insert.`);
    } else {
      const insertSql = `INSERT INTO projects (${PROJECT_COLUMN_SQL}) VALUES (${PROJECT_PLACEHOLDERS})`;
      let inserted = 0;
      for (let i = 0; i < DUMMY_COUNT; i++) {
        const projectName = `${NAME_PREFIX} ${String(i + 1).padStart(3, '0')}`;
        if (nameToId.has(projectName)) continue;
        const row = buildProject(i, today);
        await exec(insertSql, row);
        nameToId.set(projectName, String(row[0]));
        inserted++;
      }
      console.log(`Inserted ${inserted} missing dummy projects.`);
    }

    const users = await exec<{ id: string; email: string; role: string; is_active: boolean }>(
      `SELECT id, email, role, is_active FROM users`,
    );
    const requester =
      users.find((u) => u.email === 'staff1@example.com') ??
      users.find((u) => u.role === 'STAFF' && u.is_active) ??
      users.find((u) => u.is_active);

    // 6 pending UPDATE edits referencing stable dummy rows so the Pending badge
    // shows up in the grid and the approvals queue has content.
    const existingPending = await exec<{ id: string }>(
      `SELECT id FROM pending_edits WHERE status = 'pending' AND project_id IN (SELECT id FROM projects WHERE project_name LIKE '${NAME_PREFIX} %')`,
    );

    if (!requester) {
      console.warn('No active user found to attribute pending edits — skipping them.');
    } else if (existingPending.length >= PENDING_EDIT_SPECS.length) {
      console.log('Dummy pending edits already present — skipping.');
    } else {
      for (const spec of PENDING_EDIT_SPECS) {
        const projectId = nameToId.get(spec.projectName);
        if (!projectId) continue;
        const createdTs = toTimestamp(addDays(today, -randInt(1, 3)));
        await exec(
          `INSERT INTO pending_edits (id, project_id, requested_by, edit_type, changes_json, status, reviewed_by, review_note, created_at, reviewed_at)
           VALUES (?, ?, ?, 'UPDATE', ?, 'pending', NULL, NULL, ?, NULL)`,
          [uuid(), projectId, requester.id, JSON.stringify(spec.changes), createdTs],
        );
      }
      console.log(`Inserted ${PENDING_EDIT_SPECS.length} pending edits.`);
    }
  });

  await exportSnapshots(['projects', 'pending_edits']);
  console.log('Dummy data seed complete.');
}

main()
  .catch((err) => {
    console.error('Dummy seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    conn.close();
  });