import 'dotenv/config';
import { migrate } from './db/migrate.js';
import { runWrite, closeDb } from './db/connection.js';
import { uuid } from './lib/uuid.js';
import { exportSnapshots } from './db/export.js';
import { recordProjectUpdate } from './modules/project-updates/projectUpdatesService.js';
import { networkDays } from '@tracker/shared';
import { DEFAULT_AGING_LOW_MAX_DAYS, DEFAULT_AGING_MEDIUM_MAX_DAYS } from '@tracker/shared';

const DUMMY_COUNT = 100;
const NAME_PREFIX = 'Microsoft Project';
const CUSTOMER_NAME = 'Rotterdam Electrics company';

// Second batch anchored in 2025 so the grid's year filter has cross-year data.
// "Legacy" projects are created with created_at/updated_at (and their whole
// timeline) inside 2025, with document/PO numbers bearing the 2025 year.
const LEGACY_COUNT = 15;
const LEGACY_PREFIX = 'Legacy Project';

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

// Maps vendor name → { id, name } lookup so each dummy project references a
// vendors row instead of a free-text vendor_name.
interface VendorLookup { id: string; name: string; }

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

    // ── Customers ─────────────────────────────────────────────────────
    let customerId: string;
    const existingCust = await exec<{ id: string }>(
      `SELECT id FROM customers WHERE name = ?`, [CUSTOMER_NAME],
    );
    if (existingCust.length > 0) {
      customerId = existingCust[0].id;
    } else {
      customerId = uuid();
      await exec(`INSERT INTO customers (id, name, created_at) VALUES (?, ?, current_timestamp)`,
        [customerId, CUSTOMER_NAME]);
    }

    // ── Vendors ───────────────────────────────────────────────────────
    const vendorLookup = new Map<string, VendorLookup>();
    for (const vName of VENDORS) {
      const existingV = await exec<{ id: string }>(
        `SELECT id FROM vendors WHERE name = ?`, [vName],
      );
      if (existingV.length > 0) {
        vendorLookup.set(vName, { id: existingV[0].id, name: vName });
      } else {
        const id = uuid();
        await exec(`INSERT INTO vendors (id, name, created_at) VALUES (?, ?, current_timestamp)`,
          [id, vName]);
        vendorLookup.set(vName, { id, name: vName });
      }
    }

    // ── Projects ──────────────────────────────────────────────────────
    const PROJECT_COLS = [
      'id', 'folder_name', 'project_name', 'staff_assigned_id', 'drive_folder_id',
      'customer_id', 'market_segment', 'service_or_goods',
      'date_customer_received_doc1', 'date_customer_received_doc2', 'doc2_number_id',
      'customer_price', 'customer_start_contract', 'customer_end_contract',
      'current_stage', 'pic_id', 'issues', 'created_at', 'updated_at',
    ];
    const insertSql = `INSERT INTO projects (${PROJECT_COLS.join(', ')}) VALUES (${PROJECT_COLS.map(() => '?').join(', ')})`;

    // Insert one project + its vendor line. `anchor` is the timeline reference
    // ("today" for the fresh batch, a 2025 date for the legacy batch) — every
    // date pivots off it so a 2025 project's paperwork lands in 2025 too.
    const insertProject = async (
      i: number,
      projectName: string,
      docYear: string,
      anchor: Date,
      seen: Map<string, string>,
    ): Promise<void> => {
      if (seen.has(projectName)) return;

      const band = bandForIndex(i);
      const isFinish = band !== 'none' && i % 3 === 2;
      const segment = SEGMENTS[i % SEGMENTS.length];
      const vendorName = VENDORS[i % VENDORS.length];

      const agingTarget =
        band === 'none'
          ? 0
          : band === 'high'
            ? randInt(31, 60)
            : band === 'medium'
              ? randInt(16, DEFAULT_AGING_MEDIUM_MAX_DAYS)
              : randInt(1, DEFAULT_AGING_LOW_MAX_DAYS);

      const approvalDate = isFinish ? addDays(anchor, -randInt(1, 12)) : null;
      const agingEnd = approvalDate ?? anchor;
      const sentDate = band === 'none' ? null : backdateSentDate(agingTarget, agingEnd);

      const finishDate = isFinish
        ? addDays(approvalDate!, randInt(2, Math.min(10, calendarDaysBetween(approvalDate!, anchor))))
        : null;
      const negoDate =
        sentDate && (isFinish || rng() < 0.7)
          ? addDays(sentDate, randInt(1, Math.max(2, calendarDaysBetween(sentDate, isFinish ? approvalDate! : anchor))))
          : null;
      const documentSentDate =
        isFinish && finishDate
          ? addDays(approvalDate!, randInt(0, calendarDaysBetween(approvalDate!, finishDate)))
          : sentDate && rng() < 0.4
            ? addDays(sentDate, randInt(3, Math.max(3, calendarDaysBetween(sentDate, anchor) - 2)))
            : null;

      const doc1Date = sentDate ? addDays(sentDate, -randInt(0, 14)) : addDays(anchor, -randInt(20, 90));
      const doc2Date = addDays(doc1Date, randInt(0, 7));
      const customerStart = addDays(doc2Date, randInt(0, 10));
      const endInDays = randInt(180, 730);
      const customerEnd = addDays(customerStart, endInDays);
      const vendorStart = addDays(customerStart, randInt(0, 10));
      const vendorEnd = addDays(customerStart, randInt(endInDays, endInDays + 30));

      const deadlineSoon = band !== 'none' && !isFinish && i % 13 === 6;
      const custEnd = deadlineSoon ? addDays(anchor, randInt(1, 6)) : customerEnd;
      const vendEnd = deadlineSoon ? addDays(anchor, randInt(1, 6)) : vendorEnd;

      const customerPrice = roundToMillion(randInt(75, 2000) * 1_000_000);
      const vendorRevenue = roundToMillion(randInt(60, 1900) * 1_000_000);
      const vendorPrice = roundToMillion(randInt(50, 1800) * 1_000_000);

      const issues = rng() < 0.25 ? ISSUES_POOL[i % ISSUES_POOL.length] : null;
      const created = addDays(anchor, -randInt(0, 60));
      const updated = addDays(anchor, -randInt(0, 20));

      const pad4 = (n: number) => String(n).padStart(4, '0');

      const projectId = uuid();
      const vendor = vendorLookup.get(vendorName)!;

      await exec(insertSql, [
        projectId,
        null,                                 // folder_name
        projectName,
        null,                                 // staff_assigned_id
        null,                                 // drive_folder_id
        customerId,
        segment,
        'service',                            // service_or_goods
        toIso(doc1Date),                      // date_customer_received_doc1
        toIso(doc2Date),                      // date_customer_received_doc2
        `PO/ELE/${docYear}/${pad4(i + 1000)}`, // doc2_number_id
        customerPrice,
        toIso(customerStart),                 // customer_start_contract
        toIso(custEnd),                       // customer_end_contract
        isFinish ? 'finish' : 'on_progress',  // current_stage
        null,                                 // pic_id
        issues,
        toTimestamp(created),                  // created_at
        toTimestamp(updated),                  // updated_at
      ]);

      // ── Vendor line (project_vendors) ─────────────────────────────
      await exec(
        `INSERT INTO project_vendors (
          id, project_id, vendor_id, vendor_type, vendor_revenue,
          project_sent_date, project_finish_date, vendor_project_id,
          negotiation_date, approval_date, document_sent_date, document_id,
          vendor_price, vendor_start_contract, vendor_end_contract,
          sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, 'service', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          uuid(), projectId, vendor.id, vendorRevenue,
          sentDate ? toIso(sentDate) : null,                 // project_sent_date
          finishDate ? toIso(finishDate) : null,              // project_finish_date
          `FPT/${docYear}/${String(i + 100).padStart(6, '0')}`, // vendor_project_id
          negoDate ? toIso(negoDate) : null,                  // negotiation_date
          approvalDate ? toIso(approvalDate) : null,          // approval_date
          documentSentDate ? toIso(documentSentDate) : null,  // document_sent_date
          `PO/${docYear}/${String(i + 500).padStart(6, '0')}`, // document_id
          vendorPrice,
          toIso(vendorStart),                                 // vendor_start_contract
          toIso(vendEnd),                                     // vendor_end_contract
          toTimestamp(created),
          toTimestamp(updated),
        ],
      );

      seen.set(projectName, projectId);
    };

    if (nameToId.size >= DUMMY_COUNT) {
      console.log(`Found ${nameToId.size} '${NAME_PREFIX}' rows — skipping project insert.`);
    } else {
      let inserted = 0;
      for (let i = 0; i < DUMMY_COUNT; i++) {
        const projectName = `${NAME_PREFIX} ${String(i + 1).padStart(3, '0')}`;
        await insertProject(i, projectName, '2026', today, nameToId);
        if (nameToId.has(projectName)) inserted++;
      }
      console.log(`Inserted ${inserted} dummy projects with vendor lines.`);
    }

    // Legacy 2025 batch — created_at (and the whole timeline) anchored inside
    // 2025 so the year filter has cross-year data to show.
    const legacyRows = await exec<{ id: string; project_name: string }>(
      `SELECT id, project_name FROM projects WHERE project_name LIKE '${LEGACY_PREFIX} %'`,
    );
    const legacyNameToId = new Map<string, string>();
    for (const row of legacyRows) legacyNameToId.set(row.project_name, row.id);

    if (legacyNameToId.size >= LEGACY_COUNT) {
      console.log(`Found ${legacyNameToId.size} '${LEGACY_PREFIX}' rows — skipping legacy insert.`);
    } else {
      let inserted = 0;
      for (let i = 0; i < LEGACY_COUNT; i++) {
        const projectName = `${LEGACY_PREFIX} ${String(i + 1).padStart(3, '0')}`;
        // Anchored Mar 1 – Dec 31 2025 so created_at (anchor − up to 60 days)
        // still lands within 2025.
        const anchor = addDays(new Date(2025, 2, 1), randInt(0, 305));
        const before = legacyNameToId.size;
        await insertProject(i, projectName, '2025', anchor, legacyNameToId);
        if (legacyNameToId.size > before) inserted++;
      }
      console.log(`Inserted ${inserted} legacy 2025 projects with vendor lines.`);
    }

    // ── Project updates (history notes) ────────────────────────────────
    const users = await exec<{ id: string; email: string; role: string; is_active: boolean }>(
      `SELECT id, email, role, is_active FROM users`,
    );
    const requester =
      users.find((u) => u.email === 'staff1@example.com') ??
      users.find((u) => u.role === 'STAFF' && u.is_active) ??
      users.find((u) => u.is_active);

    const existingUpdates = await exec<{ project_id: string }>(
      `SELECT DISTINCT project_id FROM project_updates WHERE project_id IN (SELECT id FROM projects WHERE project_name LIKE '${NAME_PREFIX} %')`,
    );

    if (!requester) {
      console.warn('No active user found to attribute project updates — skipping them.');
    } else {
      const updatedProjectIds = new Set(existingUpdates.map((r) => r.project_id));
      let inserted = 0;
      const SPECS = [
        { name: `${NAME_PREFIX} 004`, field: 'customer_price', val: 875_000_000, note: 'Customer confirmed new PO amount over the phone.' },
        { name: `${NAME_PREFIX} 010`, field: 'issues', val: 'Vendor requested revised pricing; awaiting internal approval.', note: 'Flagging vendor pricing issue for visibility.' },
      ];
      for (const spec of SPECS) {
        const projectId = nameToId.get(spec.name);
        if (!projectId || updatedProjectIds.has(projectId)) continue;

        const projRows = await exec<Record<string, unknown>>(`SELECT * FROM projects WHERE id = ?`, [projectId]);
        const project = projRows[0];
        if (!project) continue;

        const changes: Record<string, { old: unknown; new: unknown }> = {
          [spec.field]: { old: project[spec.field] ?? null, new: spec.val },
        };
        await exec(
          `UPDATE projects SET ${spec.field} = ?, updated_at = current_timestamp WHERE id = ?`,
          [spec.val, projectId],
        );
        await recordProjectUpdate(exec, { projectId, staffId: requester.id, changes, updateProgress: spec.note });
        inserted++;
      }
      console.log(`Inserted ${inserted} project updates.`);
    }
  });

  await exportSnapshots(['projects', 'project_updates', 'customers', 'vendors', 'project_vendors']);
  console.log('Dummy data seed complete.');
}

main()
  .catch((err) => {
    console.error('Dummy seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });