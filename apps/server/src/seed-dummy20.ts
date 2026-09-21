import 'dotenv/config';
import argon2 from 'argon2';
import { migrate } from './db/migrate.js';
import { runWrite, closeDb } from './db/connection.js';
import { uuid } from './lib/uuid.js';
import { exportSnapshots } from './db/export.js';
import { recordProjectUpdate } from './modules/project-updates/projectUpdatesService.js';
import { networkDays } from '@tracker/shared';
import { DEFAULT_AGING_LOW_MAX_DAYS, DEFAULT_AGING_MEDIUM_MAX_DAYS } from '@tracker/shared';

const STAFF_PASSWORD = 'dummy12345';

const SEGMENTS = ['Government', 'Enterprise', 'SME', 'Individual'];

const CUSTOMER_NAMES = [
  'Rotterdam Electrics company',
  'Stedin Netbeheer',
  'TenneT TSO B.V.',
  'Alliander N.V.',
  'Provincie Groningen',
  'Provincie Friesland',
  'Rijkswaterstaat',
  'Port of Rotterdam Authority',
  'Gemeente Tilburg',
  'Gemeente Utrecht',
  'NOVI Energy',
  'Logistics Center Venlo',
];

const VENDOR_NAMES = [
  'Feitoria Energy BV',
  'Nordwind Kraft GmbH',
  'Aurora Teknik AB',
  'Meridian Services Ltd',
  'Helios Power Systems',
  'BlueLine Utilities BV',
  'Vantage Grid Solutions',
  'Ostwind Renewables GmbH',
];

// Aging band → target vendor aging (network days from project_sent_date to
// approval_date for finished, else to today). 'finished' projects have an
// approval date so aging freezes; 'none' have no sent date (aging = null).
type Band = 'low' | 'medium' | 'high' | 'finished' | 'none';

function agingTargetFor(band: Band, rng: () => number): number {
  if (band === 'high') return 31 + Math.floor(rng() * 30);            // 31–60
  if (band === 'medium') return 16 + Math.floor(rng() * (DEFAULT_AGING_MEDIUM_MAX_DAYS - 15)); // 16–30
  if (band === 'low') return 1 + Math.floor(rng() * DEFAULT_AGING_LOW_MAX_DAYS);            // 1–15
  if (band === 'finished') return 20 + Math.floor(rng() * 26);        // 20–45
  return 0;
}

interface SeedVendor {
  vendor: string;
  type: 'service' | 'goods';
  revenue: number;
  price: number;
}

interface SeedUpdate {
  note: string;
  field: string;
  value: unknown;
  isRead?: boolean;
}

interface SeedProject {
  name: string;
  band: Band;
  customer: string;
  segment: string;
  service_or_goods: 'service' | 'goods';
  staff: string;              // staff email assigned to the project (sales)
  pic?: string;               // staff email acting as PIC
  customer_price: number;
  vendors: SeedVendor[];
  issue?: string;
  update?: SeedUpdate;
}

const PROJECTS: SeedProject[] = [
  {
    name: 'Solar Park Zonnepark Oostflakkee',
    band: 'high',
    customer: 'Rotterdam Electrics company',
    segment: 'Enterprise',
    service_or_goods: 'goods',
    staff: 'staff1@example.com',
    pic: 'staff3@example.com',
    customer_price: 1_550_000_000,
    vendors: [{ vendor: 'Feitoria Energy BV', type: 'goods', revenue: 1_480_000_000, price: 1_320_000_000 }],
    issue: 'Panel delivery delayed due to port congestion; new ETA confirmed for next week.',
    update: {
      note: 'Customer approved budget increase for extra high-voltage switchgear.',
      field: 'customer_price',
      value: 1_620_000_000,
    },
  },
  {
    name: 'Grid Substation Upgrade Ridderkerk',
    band: 'medium',
    customer: 'Stedin Netbeheer',
    segment: 'Government',
    service_or_goods: 'service',
    staff: 'staff1@example.com',
    customer_price: 880_000_000,
    vendors: [{ vendor: 'Nordwind Kraft GmbH', type: 'service', revenue: 850_000_000, price: 790_000_000 }],
    update: {
      note: 'Final commercial offer aligned with vendor quotation.',
      field: 'customer_price',
      value: 905_000_000,
      isRead: true,
    },
  },
  {
    name: 'Offshore Wind Connection IJmuiden Ver',
    band: 'high',
    customer: 'TenneT TSO B.V.',
    segment: 'Government',
    service_or_goods: 'goods',
    staff: 'staff2@example.com',
    pic: 'staff2@example.com',
    customer_price: 1_800_000_000,
    vendors: [
      { vendor: 'Aurora Teknik AB', type: 'service', revenue: 1_480_000_000, price: 1_320_000_000 },
      { vendor: 'Helios Power Systems', type: 'goods', revenue: 1_350_000_000, price: 1_250_000_000 },
    ],
    issue: 'Cable vessel availability slipping; schedule risk flagged to customer.',
  },
  {
    name: 'EV Charging Network Groningen',
    band: 'low',
    customer: 'Provincie Groningen',
    segment: 'Government',
    service_or_goods: 'service',
    staff: 'staff3@example.com',
    customer_price: 320_000_000,
    vendors: [{ vendor: 'Meridian Services Ltd', type: 'service', revenue: 310_000_000, price: 280_000_000 }],
    update: {
      note: 'Phased rollout agreed; phase 1 signed off.',
      field: 'customer_price',
      value: 335_000_000,
      isRead: true,
    },
  },
  {
    name: 'Smart Meter Rollout Achterhoek',
    band: 'medium',
    customer: 'Alliander N.V.',
    segment: 'Enterprise',
    service_or_goods: 'goods',
    staff: 'staff1@example.com',
    pic: 'staff1@example.com',
    customer_price: 1_150_000_000,
    vendors: [
      { vendor: 'BlueLine Utilities BV', type: 'goods', revenue: 620_000_000, price: 540_000_000 },
      { vendor: 'Ostwind Renewables GmbH', type: 'service', revenue: 420_000_000, price: 380_000_000 },
    ],
    issue: 'Meter firmware needs local certification update before install.',
    update: {
      note: 'Meter purchase order consolidated across two vendors.',
      field: 'customer_price',
      value: 1_190_000_000,
    },
  },
  {
    name: 'Transformer Refurbishment Dordrecht',
    band: 'finished',
    customer: 'Stedin Netbeheer',
    segment: 'Government',
    service_or_goods: 'service',
    staff: 'staff2@example.com',
    customer_price: 260_000_000,
    vendors: [{ vendor: 'Helios Power Systems', type: 'service', revenue: 270_000_000, price: 245_000_000 }],
    update: {
      note: 'Site tests passed; project handed over to customer.',
      field: 'current_stage',
      value: 'finish',
    },
  },
  {
    name: 'Data Center Power Supply Alkmaar',
    band: 'high',
    customer: 'NOVI Energy',
    segment: 'Enterprise',
    service_or_goods: 'service',
    staff: 'staff3@example.com',
    pic: 'staff3@example.com',
    customer_price: 1_900_000_000,
    vendors: [{ vendor: 'Aurora Teknik AB', type: 'service', revenue: 1_850_000_000, price: 1_720_000_000 }],
    issue: 'Cooling system load unsupported; design revision requested.',
    update: {
      note: 'Customer ordered additional standby capacity.',
      field: 'customer_price',
      value: 2_050_000_000,
    },
  },
  {
    name: 'Biomass Cogeneration Plant Hoogeveen',
    band: 'finished',
    customer: 'Rijkswaterstaat',
    segment: 'Government',
    service_or_goods: 'goods',
    staff: 'staff1@example.com',
    customer_price: 1_950_000_000,
    vendors: [
      { vendor: 'Nordwind Kraft GmbH', type: 'goods', revenue: 1_300_000_000, price: 1_150_000_000 },
      { vendor: 'Feitoria Energy BV', type: 'service', revenue: 1_050_000_000, price: 980_000_000 },
    ],
    update: {
      note: 'Final budget revision approved before commissioning.',
      field: 'customer_price',
      value: 2_050_000_000,
      isRead: true,
    },
  },
  {
    name: 'Street Lighting LED Conversion Tilburg',
    band: 'low',
    customer: 'Gemeente Tilburg',
    segment: 'Government',
    service_or_goods: 'goods',
    staff: 'staff2@example.com',
    customer_price: 150_000_000,
    vendors: [{ vendor: 'Vantage Grid Solutions', type: 'goods', revenue: 145_000_000, price: 132_000_000 }],
  },
  {
    name: 'High Voltage Cable Replacement Zwolle',
    band: 'medium',
    customer: 'TenneT TSO B.V.',
    segment: 'Government',
    service_or_goods: 'service',
    staff: 'staff3@example.com',
    customer_price: 640_000_000,
    vendors: [{ vendor: 'BlueLine Utilities BV', type: 'service', revenue: 610_000_000, price: 570_000_000 }],
    update: {
      note: 'Cable length re-measured; price adjusted.',
      field: 'customer_price',
      value: 655_000_000,
    },
  },
  {
    name: 'Industrial Heat Pump Retrofit Breda',
    band: 'low',
    customer: 'NOVI Energy',
    segment: 'Enterprise',
    service_or_goods: 'service',
    staff: 'staff1@example.com',
    customer_price: 450_000_000,
    vendors: [{ vendor: 'Meridian Services Ltd', type: 'service', revenue: 460_000_000, price: 430_000_000 }],
    issue: 'Heat pump lead time extended by vendor; buffer order placed.',
  },
  {
    name: 'Battery Storage Facility Vlissingen',
    band: 'high',
    customer: 'Port of Rotterdam Authority',
    segment: 'Enterprise',
    service_or_goods: 'goods',
    staff: 'staff2@example.com',
    pic: 'staff2@example.com',
    customer_price: 760_000_000,
    vendors: [
      { vendor: 'Ostwind Renewables GmbH', type: 'goods', revenue: 720_000_000, price: 665_000_000 },
      { vendor: 'Aurora Teknik AB', type: 'service', revenue: 240_000_000, price: 210_000_000 },
    ],
    issue: 'Grid connection study pending approval from network operator.',
    update: {
      note: 'Battery supplier scope confirmed.',
      field: 'customer_price',
      value: 780_000_000,
    },
  },
  {
    name: 'Distribution Automation PZH Westland',
    band: 'medium',
    customer: 'Stedin Netbeheer',
    segment: 'Government',
    service_or_goods: 'service',
    staff: 'staff3@example.com',
    customer_price: 520_000_000,
    vendors: [{ vendor: 'Vantage Grid Solutions', type: 'service', revenue: 540_000_000, price: 495_000_000 }],
  },
  {
    name: 'River Pumping Station Electrification Eemshaven',
    band: 'none',
    customer: 'Rijkswaterstaat',
    segment: 'Government',
    service_or_goods: 'service',
    staff: 'staff1@example.com',
    customer_price: 350_000_000,
    vendors: [{ vendor: 'Feitoria Energy BV', type: 'service', revenue: 360_000_000, price: 330_000_000 }],
  },
  {
    name: 'Port Container Crane Electrification Rotterdam',
    band: 'high',
    customer: 'Port of Rotterdam Authority',
    segment: 'Enterprise',
    service_or_goods: 'service',
    staff: 'staff2@example.com',
    pic: 'staff2@example.com',
    customer_price: 980_000_000,
    vendors: [
      { vendor: 'Helios Power Systems', type: 'goods', revenue: 950_000_000, price: 870_000_000 },
      { vendor: 'Meridian Services Ltd', type: 'service', revenue: 380_000_000, price: 350_000_000 },
    ],
    issue: 'Crane OEM requires on-site survey before electrification quote.',
    update: {
      note: 'Crane electrification add-on confirmed.',
      field: 'customer_price',
      value: 1_020_000_000,
    },
  },
  {
    name: 'Warehouse Rooftop Solar Installation Venlo',
    band: 'low',
    customer: 'Logistics Center Venlo',
    segment: 'SME',
    service_or_goods: 'goods',
    staff: 'staff3@example.com',
    customer_price: 190_000_000,
    vendors: [{ vendor: 'Nordwind Kraft GmbH', type: 'goods', revenue: 185_000_000, price: 172_000_000 }],
    update: {
      note: 'Panel count increased after roof survey.',
      field: 'customer_price',
      value: 195_000_000,
      isRead: true,
    },
  },
  {
    name: 'Microgrid Pilot Island Ameland',
    band: 'finished',
    customer: 'Provincie Friesland',
    segment: 'Government',
    service_or_goods: 'goods',
    staff: 'staff1@example.com',
    customer_price: 250_000_000,
    vendors: [{ vendor: 'BlueLine Utilities BV', type: 'goods', revenue: 260_000_000, price: 235_000_000 }],
  },
  {
    name: 'Underground Cable Network Almere',
    band: 'medium',
    customer: 'Alliander N.V.',
    segment: 'Enterprise',
    service_or_goods: 'goods',
    staff: 'staff2@example.com',
    customer_price: 860_000_000,
    vendors: [{ vendor: 'Ostwind Renewables GmbH', type: 'goods', revenue: 890_000_000, price: 820_000_000 }],
    issue: 'Groundwater level complicates duct installation; dewatering plan requested.',
  },
  {
    name: 'Wind Farm Repowering North Sea',
    band: 'high',
    customer: 'TenneT TSO B.V.',
    segment: 'Government',
    service_or_goods: 'goods',
    staff: 'staff3@example.com',
    pic: 'staff3@example.com',
    customer_price: 1_900_000_000,
    vendors: [
      { vendor: 'Aurora Teknik AB', type: 'goods', revenue: 1_800_000_000, price: 1_650_000_000 },
      { vendor: 'Vantage Grid Solutions', type: 'service', revenue: 1_100_000_000, price: 1_050_000_000 },
    ],
    update: {
      note: 'Repowering scope finalized.',
      field: 'customer_price',
      value: 2_050_000_000,
    },
  },
  {
    name: 'Municipal Office Energy Retrofit Utrecht',
    band: 'low',
    customer: 'Gemeente Utrecht',
    segment: 'Government',
    service_or_goods: 'service',
    staff: 'staff1@example.com',
    customer_price: 320_000_000,
    vendors: [{ vendor: 'Feitoria Energy BV', type: 'service', revenue: 330_000_000, price: 305_000_000 }],
    issue: 'Asbestos survey pending before interior retrofit starts.',
  },
];

// Batch anchored in 2025 so the grid's year filter has cross-year data.
// "Legacy" projects are created with created_at (and their whole timeline)
// inside 2025, with document/PO numbers bearing the 2025 suffix.
const LEGACY_PROJECTS: SeedProject[] = [
  {
    name: 'Amsterdam Arena Roof Lighting Renewal',
    band: 'finished',
    customer: 'Rotterdam Electrics company',
    segment: 'Enterprise',
    service_or_goods: 'goods',
    staff: 'staff2@example.com',
    customer_price: 480_000_000,
    vendors: [{ vendor: 'Vantage Grid Solutions', type: 'goods', revenue: 450_000_000, price: 410_000_000 }],
    update: {
      note: 'Final acceptance signed; warranty period started.',
      field: 'current_stage',
      value: 'finish',
      isRead: true,
    },
  },
  {
    name: 'Schiphol Airport Baggage Conveyer Power',
    band: 'medium',
    customer: 'NOVI Energy',
    segment: 'Enterprise',
    service_or_goods: 'service',
    staff: 'staff1@example.com',
    customer_price: 920_000_000,
    vendors: [{ vendor: 'Aurora Teknik AB', type: 'service', revenue: 870_000_000, price: 800_000_000 }],
    issue: 'Spare transformer on backorder; commissioning set for later window.',
    update: {
      note: 'Load study complete; capacity reserved on the airport MV ring.',
      field: 'customer_price',
      value: 935_000_000,
      isRead: true,
    },
  },
  {
    name: 'Utrecht Central Station Platform Canopies',
    band: 'finished',
    customer: 'Rijkswaterstaat',
    segment: 'Government',
    service_or_goods: 'service',
    staff: 'staff3@example.com',
    pic: 'staff3@example.com',
    customer_price: 1_150_000_000,
    vendors: [
      { vendor: 'Meridian Services Ltd', type: 'service', revenue: 1_080_000_000, price: 990_000_000 },
      { vendor: 'BlueLine Utilities BV', type: 'goods', revenue: 310_000_000, price: 285_000_000 },
    ],
    issue: 'Window glazing delivery rescheduled; facade phase slipped.',
  },
  {
    name: 'Rotterdam Europoort Terminal Extension 2025',
    band: 'high',
    customer: 'Port of Rotterdam Authority',
    segment: 'Enterprise',
    service_or_goods: 'goods',
    staff: 'staff1@example.com',
    customer_price: 1_780_000_000,
    vendors: [{ vendor: 'Helios Power Systems', type: 'goods', revenue: 1_660_000_000, price: 1_520_000_000 }],
    issue: 'Foundation piling hits unexpected fill material; geotech review underway.',
    update: {
      note: 'Quay wall detailing revised after soil report.',
      field: 'customer_price',
      value: 1_820_000_000,
    },
  },
  {
    name: 'Eindhoven Industrial Park Smart Grid 2025',
    band: 'none',
    customer: 'Alliander N.V.',
    segment: 'Enterprise',
    service_or_goods: 'service',
    staff: 'staff2@example.com',
    customer_price: 640_000_000,
    vendors: [
      { vendor: 'Ostwind Renewables GmbH', type: 'service', revenue: 610_000_000, price: 555_000_000 },
      { vendor: 'Feitoria Energy BV', type: 'goods', revenue: 240_000_000, price: 215_000_000 },
    ],
  },
  {
    name: 'Delta Works Hydraulics Test Lab 2025',
    band: 'medium',
    customer: 'Rijkswaterstaat',
    segment: 'Government',
    service_or_goods: 'service',
    staff: 'staff3@example.com',
    pic: 'staff1@example.com',
    customer_price: 815_000_000,
    vendors: [{ vendor: 'Nordwind Kraft GmbH', type: 'service', revenue: 770_000_000, price: 705_000_000 }],
    update: {
      note: 'Pump skid shop test passed; shipping to site.',
      field: 'customer_price',
      value: 820_000_000,
    },
  },
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

const rng = mulberry32(20260921);

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

async function main(): Promise<void> {
  await migrate();

  const today = dateOnly(new Date());
  const year = today.getFullYear();

  await runWrite(async (exec) => {
    // ── Staff users ────────────────────────────────────────────────
    const staffSeeds = [
      { name: 'Sara Jansen', email: 'staff1@example.com' },
      { name: 'Tom Bakker', email: 'staff2@example.com' },
      { name: 'Lina Visser', email: 'staff3@example.com' },
    ];
    const staffIdByEmail = new Map<string, string>();
    const passwordHash = await argon2.hash(STAFF_PASSWORD);
    for (const s of staffSeeds) {
      const existing = await exec<{ id: string }>(`SELECT id FROM users WHERE email = ?`, [s.email]);
      if (existing.length > 0) {
        staffIdByEmail.set(s.email, existing[0].id);
      } else {
        const id = uuid();
        await exec(
          `INSERT INTO users (id, name, email, password_hash, role, is_active, created_at)
           VALUES (?, ?, ?, ?, 'STAFF', true, current_timestamp)`,
          [id, s.name, s.email, passwordHash],
        );
        staffIdByEmail.set(s.email, id);
        console.log(`Created STAFF ${s.name} <${s.email}>`);
      }
    }

    const adminRows = await exec<{ id: string }>(
      `SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND is_active = true LIMIT 1`,
    );
    const adminId = adminRows[0]?.id ?? null;

    // ── Customers ─────────────────────────────────────────────────
    const customerNameToId = new Map<string, string>();
    for (const name of CUSTOMER_NAMES) {
      const existing = await exec<{ id: string }>(`SELECT id FROM customers WHERE name = ?`, [name]);
      if (existing.length > 0) {
        customerNameToId.set(name, existing[0].id);
      } else {
        const id = uuid();
        await exec(`INSERT INTO customers (id, name, created_at) VALUES (?, ?, current_timestamp)`, [id, name]);
        customerNameToId.set(name, id);
      }
    }

    // ── Vendors ───────────────────────────────────────────────────
    const vendorNameToId = new Map<string, string>();
    for (const name of VENDOR_NAMES) {
      const existing = await exec<{ id: string }>(`SELECT id FROM vendors WHERE name = ?`, [name]);
      if (existing.length > 0) {
        vendorNameToId.set(name, existing[0].id);
      } else {
        const id = uuid();
        await exec(`INSERT INTO vendors (id, name, created_at) VALUES (?, ?, current_timestamp)`, [id, name]);
        vendorNameToId.set(name, id);
      }
    }

    // ── Existing projects guard (idempotent re-runs) ───────────────
    const allNames = [...PROJECTS, ...LEGACY_PROJECTS];
    const existingRows = await exec<{ project_name: string }>(
      `SELECT project_name FROM projects WHERE project_name IN (${allNames.map(() => '?').join(', ')})`,
      allNames.map((p) => p.name),
    );
    const existingNames = new Set(existingRows.map((r) => r.project_name));

    const PROJECT_COLS = [
      'id', 'folder_name', 'project_name', 'staff_assigned_id', 'drive_folder_id',
      'customer_id', 'market_segment', 'service_or_goods',
      'date_customer_received_doc1', 'date_customer_received_doc2', 'doc2_number_id',
      'customer_price', 'customer_start_contract', 'customer_end_contract',
      'current_stage', 'pic_id', 'issues', 'created_at', 'updated_at',
    ];
    const insertProjectSql = `INSERT INTO projects (${PROJECT_COLS.join(', ')}) VALUES (${PROJECT_COLS.map(() => '?').join(', ')})`;

    // Insert one project + its vendor lines (and optionally an issue/update).
    // `anchor` is the timeline reference ("today" for the fresh batch, a 2025
    // date for the legacy batch) and `docYear` drives the numbering.
    const insertProject = async (
      i: number,
      proj: SeedProject,
      anchor: Date,
      docYear: number,
      seen: Set<string>,
    ): Promise<void> => {
      if (seen.has(proj.name)) return;

      const pad4 = (n: number) => String(n).padStart(4, '0');
      const isFinished = proj.band === 'finished';
      const approvalDate = isFinished ? addDays(anchor, -randInt(3, 14)) : null;
      const agingEnd = approvalDate ?? anchor;
      const sentDate = proj.band === 'none' ? null : backdateSentDate(agingTargetFor(proj.band, rng), agingEnd);

      const finishDate =
        isFinished && approvalDate
          ? addDays(approvalDate, randInt(2, Math.min(10, calendarDaysBetween(approvalDate, anchor))))
          : null;
      const negoDate =
        sentDate && (isFinished || rng() < 0.7)
          ? addDays(sentDate, randInt(1, Math.max(2, calendarDaysBetween(sentDate, agingEnd))))
          : null;
      const documentSentDate =
        isFinished && finishDate && approvalDate
          ? addDays(approvalDate, randInt(0, calendarDaysBetween(approvalDate, finishDate)))
          : sentDate && rng() < 0.4
            ? addDays(sentDate, randInt(3, Math.max(3, calendarDaysBetween(sentDate, anchor) - 2)))
            : null;

      const doc1Raw = sentDate ? addDays(sentDate, -randInt(0, 14)) : addDays(anchor, -randInt(20, 90));
      // Keep the timeline inside the batch's year: never backdate before Jan 1
      // of the anchor year (matters for the 2025 legacy batch's year filter).
      const yearStart = new Date(anchor.getFullYear(), 0, 1);
      const doc1Date = doc1Raw.getTime() < yearStart.getTime() ? yearStart : doc1Raw;
      const doc2Date = addDays(doc1Date, randInt(0, 7));
      const customerStart = addDays(doc2Date, randInt(0, 10));
      const endInDays = randInt(180, 730);
      const customerEnd = addDays(customerStart, endInDays);
      const vendorStart = addDays(customerStart, randInt(0, 10));
      const vendorEnd = addDays(customerStart, randInt(endInDays, endInDays + 30));

      const deadlineSoon = !isFinished && proj.band !== 'none' && i % 11 === 5;
      const custEnd = deadlineSoon ? addDays(anchor, randInt(1, 6)) : customerEnd;
      const vendEnd = deadlineSoon ? addDays(anchor, randInt(1, 6)) : vendorEnd;

      const createdRaw = addDays(anchor, -randInt(30, 120));
      const created = createdRaw.getTime() < yearStart.getTime() ? yearStart : createdRaw;
      const updated = addDays(anchor, -randInt(0, 20));

      const projectId = uuid();
      const staffId = staffIdByEmail.get(proj.staff);
      const picId = proj.pic ? staffIdByEmail.get(proj.pic) ?? null : null;

      await exec(insertProjectSql, [
        projectId,
        null,                                   // folder_name
        proj.name,
        staffId ?? null,                        // staff_assigned_id
        null,                                   // drive_folder_id
        customerNameToId.get(proj.customer)!,
        proj.segment,
        proj.service_or_goods,
        toIso(doc1Date),                        // date_customer_received_doc1
        toIso(doc2Date),                        // date_customer_received_doc2
        `PO/ELE/${docYear}/${pad4(i + (docYear === 2025 ? 200 : 1100))}`, // doc2_number_id
        proj.customer_price,
        toIso(customerStart),                   // customer_start_contract
        toIso(custEnd),                         // customer_end_contract
        // Stage flips to finish later for projects whose update targets it.
        isFinished && proj.update?.field !== 'current_stage' ? 'finish' : 'on_progress',
        picId,                                  // pic_id
        proj.issue ?? null,                     // issues (denormalized latest)
        toTimestamp(created),                   // created_at
        toTimestamp(updated),                   // updated_at
      ]);

      // Vendor lines — first line keeps the project-level aging, additional
      // lines get a fresh sent date so aging differs per vendor.
      for (const [v, vendorLine] of proj.vendors.entries()) {
        const lineSent =
          v === 0
            ? sentDate
            : proj.band === 'none'
              ? null
              : backdateSentDate(agingTargetFor(proj.band, rng), agingEnd);
        const lineFinish = isFinished && approvalDate && finishDate ? finishDate : null;
        const lineNego =
          lineSent && (isFinished || rng() < 0.7)
            ? addDays(lineSent, randInt(1, Math.max(2, calendarDaysBetween(lineSent, agingEnd))))
            : null;
        const lineDocSent =
          isFinished && lineFinish && approvalDate
            ? addDays(approvalDate, randInt(0, calendarDaysBetween(approvalDate, lineFinish)))
            : lineSent && rng() < 0.4
              ? addDays(lineSent, randInt(3, Math.max(3, calendarDaysBetween(lineSent, anchor) - 2)))
              : null;

        await exec(
          `INSERT INTO project_vendors (
            id, project_id, vendor_id, vendor_type, vendor_revenue,
            project_sent_date, project_finish_date, vendor_project_id,
            negotiation_date, approval_date, document_sent_date, document_id,
            vendor_price, vendor_start_contract, vendor_end_contract,
            sort_order, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuid(), projectId, vendorNameToId.get(vendorLine.vendor)!,
            vendorLine.type, vendorLine.revenue,
            lineSent ? toIso(lineSent) : null,                        // project_sent_date
            lineFinish ? toIso(lineFinish) : null,                    // project_finish_date
            `PRJ/${docYear}/${String(i * 100 + v).padStart(6, '0')}`,  // vendor_project_id
            lineNego ? toIso(lineNego) : null,                        // negotiation_date
            approvalDate ? toIso(approvalDate) : null,                // approval_date
            lineDocSent ? toIso(lineDocSent) : null,                  // document_sent_date
            `PO/${docYear}/${String(i + (docYear === 2025 ? 2000 : 300)).padStart(6, '0')}`, // document_id
            vendorLine.price,
            toIso(vendorStart),                                       // vendor_start_contract
            toIso(vendEnd),                                           // vendor_end_contract
            v,
            toTimestamp(created),
            toTimestamp(updated),
          ],
        );
      }

      // ── Logged issue (project_issues) ─────────────────────────────
      if (proj.issue) {
        const issueDate = addDays(anchor, -randInt(1, 45));
        const assignee = staffIdByEmail.get(proj.staff) ?? null;
        await exec(
          `INSERT INTO project_issues (id, project_id, issue_text, issue_date, assignee_id, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, current_timestamp)`,
          [uuid(), projectId, proj.issue, toIso(issueDate), assignee, adminId],
        );
      }

      // ── Update-progress note (project_updates) ────────────────────
      if (proj.update) {
        const spec = proj.update;
        const projRows = await exec<Record<string, unknown>>(`SELECT * FROM projects WHERE id = ?`, [projectId]);
        await exec(
          `UPDATE projects SET ${spec.field} = ?, updated_at = current_timestamp WHERE id = ?`,
          [spec.value, projectId],
        );
        const changes: Record<string, { old: unknown; new: unknown }> = {
          [spec.field]: { old: projRows[0][spec.field] ?? null, new: spec.value },
        };
        await recordProjectUpdate(exec, {
          projectId,
          staffId: staffId!,
          changes,
          updateProgress: spec.note,
        });
        if (spec.isRead) {
          await exec(`UPDATE project_updates SET is_read = true WHERE project_id = ?`, [projectId]);
        }
      }

      seen.add(proj.name);
    };

    let inserted = 0;
    for (const [i, proj] of PROJECTS.entries()) {
      const before = existingNames.size;
      await insertProject(i, proj, today, year, existingNames);
      if (existingNames.size > before) inserted++;
    }
    console.log(`Inserted ${inserted} of ${PROJECTS.length} current-year dummy projects with vendor lines.`);

    // Legacy 2025 batch — created_at (and the whole timeline) anchored inside
    // 2025 so the year filter has cross-year data to show.
    let insertedLegacy = 0;
    for (const [i, proj] of LEGACY_PROJECTS.entries()) {
      // Anchored Mar 1 – Dec 31 2025 so created_at (anchor − up to 120 days)
      // still lands within 2025.
      const anchor = addDays(new Date(2025, 2, 1), randInt(0, 305));
      const before = existingNames.size;
      await insertProject(i, proj, anchor, 2025, existingNames);
      if (existingNames.size > before) insertedLegacy++;
    }
    console.log(`Inserted ${insertedLegacy} of ${LEGACY_PROJECTS.length} legacy 2025 projects with vendor lines.`);
  });

  await exportSnapshots([
    'projects',
    'customers',
    'vendors',
    'project_vendors',
    'project_updates',
    'project_issues',
    'users',
  ]);
  console.log('Dummy-20 seed complete.');
}

function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

main()
  .catch((err) => {
    console.error('Dummy-20 seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });