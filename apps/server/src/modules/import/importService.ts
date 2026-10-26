// CSV project import: preview (validation only) and commit (all-or-nothing).
// Plan: plan_csv_import.md §5-§6.
//
// The whole validation pipeline lives in prepare(); both endpoints call it —
// commit re-validates from its own request body and never trusts a prior
// preview. Commit wraps everything in one explicit BEGIN/COMMIT inside the
// write mutex and exports snapshots AFTER the block (plan §6 commit rules):
// no service that takes its own runWrite may be called from inside, or the
// mutex would deadlock against itself.

import {
  IMPORT_FIELDS,
  IMPORT_FIELD_BY_KEY,
  IMPORT_FIELD_KEYS,
  IMPORT_MAX_INTEGER,
  importFieldLabel,
  projectCreateSchema,
  projectImportRequestSchema,
  projectVendorCreateSchema,
  type ImportCommitResponse,
  type ImportIssue,
  type ImportPreviewResponse,
  type ImportSampleProject,
  type ProjectCreate,
  type ProjectVendorCreate,
} from '@tracker/shared';
import { z } from 'zod';
import type { AuthUser } from '../../middleware/requireAuth.js';
import { exportSnapshots } from '../../db/export.js';
import { runRead, runWrite } from '../../db/connection.js';
import { uuid } from '../../lib/uuid.js';
import {
  buildInsertValues,
  insertProjectSql,
  insertVendorLineSql,
  vendorLineValues,
} from '../projects/projectsService.js';
import { isBlankCell, parseCell, type CellParseResult } from './parsers.js';

export class ImportError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

// --- internal shapes --------------------------------------------------------

type CellValue = string | number | null;

interface RawRow {
  /** 1-based data-row number (row 1 = first row after the CSV header). */
  row: number;
  /** Raw (post continuation-fill) cell text, keyed by import field key. */
  cells: Record<string, string>;
  /** Which row each filled cell was copied from (project-level fill only). */
  filledFrom: Map<string, number>;
  /** Parse outcome per key, so a filled cell reuses its source row's result. */
  parseResults: Record<string, CellParseResult>;
  /** Parsed values for every mapped key that produced one. */
  values: Record<string, CellValue>;
}

interface GroupLine {
  row: number;
  values: Record<string, CellValue>;
  vendorName: string;
}

interface PreparedGroup {
  firstRow: number;
  rowNumbers: number[];
  /** Merged project-level values (first non-blank row wins; conflicts flagged). */
  values: Record<string, CellValue>;
  /** Row each merged value came from — used to attribute lookup errors. */
  valueRows: Record<string, number>;
  lines: GroupLine[];
  projectId: string;
  payload?: ProjectCreate;
  linePayloads?: { row: number; payload: ProjectVendorCreate }[];
}

interface Prepared {
  items: PreparedGroup[];
  skipped: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  notes: string[];
  newCustomers: { id: string; name: string }[];
  newVendors: { id: string; name: string }[];
  newSegments: { id: string; label: string }[];
}

const PROJECT_LEVEL_KEYS = IMPORT_FIELDS.filter((f) => f.level === 'project').map((f) => f.key);
const VENDOR_LEVEL_KEYS = IMPORT_FIELDS.filter((f) => f.level === 'vendor').map((f) => f.key);

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function sameValue(a: CellValue, b: CellValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return norm(String(a)) === norm(String(b));
}

function cellText(value: CellValue | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

function isPresent(value: CellValue | undefined): value is CellValue {
  return value !== null && value !== undefined && value !== '';
}

function formatCellError(res: Extract<CellParseResult, { ok: false }>, label: string): string {
  switch (res.code) {
    case 'invalid_date':
      return `${label} "${res.raw}" is not a valid date`;
    case 'invalid_number':
      return `${label} "${res.raw}" is not a valid number`;
    case 'number_too_large':
      return `${label} "${res.raw}" is above the maximum the database can store (${IMPORT_MAX_INTEGER.toLocaleString('en-US')})`;
    case 'invalid_enum':
      return `${label} "${res.raw}" is not valid — allowed values: ${(res.allowed ?? []).join(', ')}`;
    default:
      return `${label} "${res.raw}" could not be read`;
  }
}

/** Convert a zod failure into label-worded row issues (never expose keys). */
function pushZodIssues(err: unknown, row: number, errors: ImportIssue[]): void {
  if (!(err instanceof z.ZodError)) throw err;
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? '');
    errors.push({
      row,
      fieldKey: IMPORT_FIELD_KEYS.has(key) ? key : null,
      message: IMPORT_FIELD_KEYS.has(key)
        ? `${importFieldLabel(key)}: ${issue.message}`
        : issue.message,
    });
  }
}

// --- prepare (validation pipeline, plan §6 steps 1-8) -----------------------

async function prepare(body: unknown): Promise<Prepared> {
  const req = projectImportRequestSchema.safeParse(body);
  if (!req.success) {
    throw new ImportError(
      'Invalid import payload',
      400,
      req.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const { options } = req.data;
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const notes: string[] = [];

  // The union of keys across rows = the user's mapping (the client sends
  // every mapped key in every row).
  const mappedKeys = new Set<string>();
  for (const r of req.data.rows) for (const k of Object.keys(r)) mappedKeys.add(k);

  // Without a vendor column there are no vendor lines at all — other
  // vendor-level columns are ignored rather than erroring row by row (plan §4
  // step 2 info note).
  const hasVendorColumn = mappedKeys.has('vendor_name');
  if (!hasVendorColumn) {
    notes.push('No vendor column mapped: projects will be created without vendor lines.');
  }

  const rows: RawRow[] = req.data.rows.map((cells, i) => {
    const text: Record<string, string> = {};
    for (const [k, v] of Object.entries(cells)) {
      if (!hasVendorColumn && VENDOR_LEVEL_KEYS.includes(k)) continue;
      text[k] = v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v);
    }
    return { row: i + 1, cells: text, filledFrom: new Map(), parseResults: {}, values: {} };
  });

  // Step 2 — continuation fill: blank project cells copy the row above. Each
  // copied cell records its source row so a bad value errors once, at its
  // origin, instead of once per continuation row.
  if (options.continueBlankRows) {
    for (let i = 1; i < rows.length; i++) {
      if (isBlankCell(rows[i].cells.project_name ?? '')) {
        for (const key of PROJECT_LEVEL_KEYS) {
          const current = rows[i].cells[key];
          if (current !== undefined && !isBlankCell(current)) continue;
          const prev = rows[i - 1].cells[key];
          if (prev !== undefined && !isBlankCell(prev)) {
            rows[i].cells[key] = prev;
            rows[i].filledFrom.set(key, i - 1);
          }
        }
      }
    }
  }
  // A row with no project name (after fill) cannot be grouped — this also
  // covers a blank first row (there is nothing above it to continue).
  for (const r of rows) {
    if (isBlankCell(r.cells.project_name ?? '')) {
      errors.push({
        row: r.row,
        fieldKey: 'project_name',
        message: `${importFieldLabel('project_name')} is empty`,
      });
    }
  }

  // Step 4 — parse every mapped cell with its registry type. A filled cell
  // reuses its source row's outcome (value, warning or error).
  for (const r of rows) {
    for (const [k, raw] of Object.entries(r.cells)) {
      const sourceIndex = r.filledFrom.get(k);
      if (sourceIndex !== undefined && sourceIndex >= 0) {
        const source = rows[sourceIndex].parseResults[k];
        if (source) {
          if (source.ok) r.values[k] = source.value;
          continue; // source row already recorded any error/warning
        }
      }
      const field = IMPORT_FIELD_BY_KEY.get(k);
      if (!field) continue; // whitelisted by zod already; belt and braces
      const res = parseCell(raw, field, { dateFormat: options.dateFormat });
      r.parseResults[k] = res;
      if (!res.ok) {
        errors.push({ row: r.row, fieldKey: k, message: formatCellError(res, field.label) });
        continue;
      }
      r.values[k] = res.value;
      if (res.warning === 'decimal_rounded') {
        warnings.push({
          row: r.row,
          fieldKey: k,
          message: `${field.label} "${raw.trim()}" has decimals and was rounded to a whole number`,
        });
      }
    }
  }

  // A vendor line needs a vendor name; orphan vendor data is an error so a
  // mistyped blank cell can't silently drop a whole line.
  if (hasVendorColumn) {
    const otherVendorKeys = VENDOR_LEVEL_KEYS.filter((k) => k !== 'vendor_name');
    for (const r of rows) {
      if (isPresent(r.values.vendor_name)) continue;
      const hasOrphanData = otherVendorKeys.some((k) => isPresent(r.values[k]));
      if (hasOrphanData) {
        errors.push({
          row: r.row,
          fieldKey: 'vendor_name',
          message: `${importFieldLabel('vendor_name')} is blank but this row has Vendor line values`,
        });
      }
    }
  }

  // Step 3 — group rows into projects: folder reference first, else name
  // (case-insensitive, trimmed). Group key comes from the filled cells, so a
  // grid-style continuation row joins the project above it.
  const groups = new Map<string, PreparedGroup>();
  for (const r of rows) {
    const nameCell = r.cells.project_name ?? '';
    if (isBlankCell(nameCell)) continue;
    const folderCell = r.cells.folder_name ?? '';
    const key = !isBlankCell(folderCell) ? `f:${norm(folderCell)}` : `n:${norm(nameCell)}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        firstRow: r.row,
        rowNumbers: [],
        values: {},
        valueRows: {},
        lines: [],
        projectId: uuid(),
      };
      groups.set(key, g);
    }
    g.rowNumbers.push(r.row);
  }

  // Merge project-level values (first non-blank row in file order wins) and
  // collect vendor lines. rowNumbers are in ascending order, so "first
  // non-blank seen" is the first row that has the value.
  for (const g of groups.values()) {
    for (const rowNumber of g.rowNumbers) {
      const r = rows[rowNumber - 1];
      for (const key of PROJECT_LEVEL_KEYS) {
        if (g.values[key] !== undefined) continue;
        const v = r.values[key];
        if (!isPresent(v)) continue;
        g.values[key] = v;
        g.valueRows[key] = r.row;
      }
      const vendorName = r.values.vendor_name;
      if (isPresent(vendorName)) {
        g.lines.push({ row: r.row, values: { ...r.values }, vendorName: String(vendorName) });
      }
    }
  }

  // Step 7 — duplicates against existing projects: folder when provided,
  // otherwise case-insensitive project name (plan §6 step 7). `reject`
  // produces an error, `skip` drops the group and counts it.
  const existingFolders = new Set<string>();
  const existingNames = new Set<string>();
  for (const p of await runRead<{ folder_name: string | null; project_name: string }>(
    `SELECT folder_name, project_name FROM projects`,
  )) {
    if (p.folder_name && p.folder_name.trim()) existingFolders.add(norm(p.folder_name));
    existingNames.add(norm(p.project_name));
  }

  const items: PreparedGroup[] = [];
  let skipped = 0;
  for (const g of groups.values()) {
    const folder = g.values.folder_name;
    const isDuplicate = isPresent(folder)
      ? existingFolders.has(norm(String(folder)))
      : existingNames.has(norm(cellText(g.values.project_name)));
    if (!isDuplicate) {
      items.push(g);
      continue;
    }
    if (options.onDuplicate === 'reject') {
      errors.push({
        row: g.firstRow,
        fieldKey: 'project_name',
        message: `${importFieldLabel('project_name')} "${cellText(g.values.project_name)}" already exists`,
      });
    } else {
      skipped++;
    }
  }

  // Conflicts — two different non-blank values for one project-level field
  // inside the same project. Never silently pick one (plan §6 step 3).
  for (const g of items) {
    const groupRows = g.rowNumbers.map((n) => rows[n - 1]);
    for (const key of PROJECT_LEVEL_KEYS) {
      const present = groupRows
        .map((r) => ({ row: r.row, v: r.values[key] }))
        .filter((x) => isPresent(x.v));
      if (present.length < 2) continue;
      const base = present[0];
      for (const other of present.slice(1)) {
        if (sameValue(base.v, other.v)) continue;
        errors.push({
          row: other.row,
          fieldKey: key,
          message: `${importFieldLabel(key)} differs within the same project: Row ${base.row} has "${cellText(base.v)}", Row ${other.row} has "${cellText(other.v)}"`,
        });
      }
    }
  }

  // Step 5 — lookups. Only for groups that will actually be created: skipped
  // duplicates never queue new customers/vendors/segments, and their Sales/PIC
  // values don't block the import. Case-insensitive get-or-create within the
  // import too — one entry per distinct name (plan §6 step 5).
  const newCustomers: { id: string; name: string }[] = [];
  const newVendors: { id: string; name: string }[] = [];
  const newSegments: { id: string; label: string }[] = [];

  const customerByName = new Map<string, { id: string; name: string }>();
  for (const c of await runRead<{ id: string; name: string }>(`SELECT id, name FROM customers`)) {
    customerByName.set(norm(c.name), c);
  }
  const vendorByName = new Map<string, { id: string; name: string }>();
  for (const v of await runRead<{ id: string; name: string }>(`SELECT id, name FROM vendors`)) {
    vendorByName.set(norm(v.name), v);
  }
  // Segments match every existing label (soft-deleted included) so a value
  // that once existed is reused; genuinely new ones are created active.
  const segmentByLabel = new Map<string, { id: string; label: string }>();
  for (const s of await runRead<{ id: string; label: string }>(
    `SELECT id, label FROM market_segments`,
  )) {
    segmentByLabel.set(norm(s.label), s);
  }
  const activeUsers = await runRead<{ id: string; name: string; email: string }>(
    `SELECT id, name, email FROM users WHERE is_active = true`,
  );
  const userByEmail = new Map<string, { id: string }>();
  const usersByName = new Map<string, { id: string }[]>();
  for (const u of activeUsers) {
    userByEmail.set(norm(u.email), { id: u.id });
    const list = usersByName.get(norm(u.name)) ?? [];
    list.push({ id: u.id });
    usersByName.set(norm(u.name), list);
  }

  function getOrCreate<T extends { id: string }>(
    map: Map<string, T>,
    name: string,
    make: () => T,
    register: (entry: T) => void,
  ): { id: string } {
    const key = norm(name);
    const existing = map.get(key);
    if (existing) return existing;
    const entry = make();
    map.set(key, entry);
    register(entry);
    return entry;
  }

  type UserLookup = { id: string } | { error: string };
  function resolveUser(raw: string, label: string): UserLookup {
    const byEmail = userByEmail.get(norm(raw));
    if (byEmail) return byEmail;
    const byName = usersByName.get(norm(raw)) ?? [];
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) {
      return { error: `${label} "${raw.trim()}" matches more than one active user` };
    }
    return { error: `${label} "${raw.trim()}" was not found among active users` };
  }

  // Step 6 — build and validate objects against the same schemas the Add
  // Project form uses.
  for (const g of items) {
    const payload: Record<string, unknown> = {
      project_name: cellText(g.values.project_name),
      folder_name: cellText(g.values.folder_name) || null,
      drive_folder_id: null,
      market_segment: cellText(g.values.market_segment) || null,
      service_or_goods: g.values.service_or_goods ?? null,
      date_customer_received_doc1: g.values.date_customer_received_doc1 ?? null,
      date_customer_received_doc2: g.values.date_customer_received_doc2 ?? null,
      doc2_number_id: cellText(g.values.doc2_number_id) || null,
      customer_price: g.values.customer_price ?? null,
      customer_start_contract: g.values.customer_start_contract ?? null,
      customer_end_contract: g.values.customer_end_contract ?? null,
      current_stage: g.values.current_stage ?? 'on_progress',
      staff_assigned_id: null,
      pic_id: null,
      customer_id: null,
    };

    const staffRaw = g.values.staff_assigned;
    if (isPresent(staffRaw)) {
      const found = resolveUser(String(staffRaw), importFieldLabel('staff_assigned'));
      if ('error' in found) {
        errors.push({
          row: g.valueRows.staff_assigned ?? g.firstRow,
          fieldKey: 'staff_assigned',
          message: found.error,
        });
      } else {
        payload.staff_assigned_id = found.id;
      }
    }

    const picRaw = g.values.pic;
    if (isPresent(picRaw)) {
      const found = resolveUser(String(picRaw), importFieldLabel('pic'));
      if ('error' in found) {
        errors.push({
          row: g.valueRows.pic ?? g.firstRow,
          fieldKey: 'pic',
          message: found.error,
        });
      } else {
        payload.pic_id = found.id;
      }
    }

    const customerRaw = g.values.customer_name;
    if (isPresent(customerRaw)) {
      payload.customer_id = getOrCreate(
        customerByName,
        String(customerRaw),
        () => ({ id: uuid(), name: String(customerRaw) }),
        (c) => newCustomers.push(c),
      ).id;
    }

    const segmentRaw = g.values.market_segment;
    if (isPresent(segmentRaw)) {
      getOrCreate(
        segmentByLabel,
        String(segmentRaw),
        () => ({ id: uuid(), label: String(segmentRaw) }),
        (s) => newSegments.push(s),
      );
    }

    const linePayloads: { row: number; payload: ProjectVendorCreate }[] = [];
    for (const [i, line] of g.lines.entries()) {
      const vendorId = getOrCreate(
        vendorByName,
        line.vendorName,
        () => ({ id: uuid(), name: line.vendorName }),
        (v) => newVendors.push(v),
      ).id;
      const linePayload: Record<string, unknown> = { vendor_id: vendorId, sort_order: i };
      for (const key of VENDOR_LEVEL_KEYS) {
        if (key === 'vendor_name') continue;
        linePayload[key] = line.values[key] ?? null;
      }
      try {
        linePayloads.push({ row: line.row, payload: projectVendorCreateSchema.parse(linePayload) });
      } catch (err) {
        pushZodIssues(err, line.row, errors);
      }
    }
    g.linePayloads = linePayloads;

    try {
      g.payload = projectCreateSchema.parse(payload);
    } catch (err) {
      pushZodIssues(err, g.firstRow, errors);
    }
  }

  return { items, skipped, errors, warnings, notes, newCustomers, newVendors, newSegments };
}

// --- endpoints --------------------------------------------------------------

/** Validation only — nothing is written (plan §4 step 3). */
export async function previewProjectImport(body: unknown): Promise<ImportPreviewResponse> {
  const p = await prepare(body);
  const sample: ImportSampleProject[] = p.items.slice(0, 50).map((g) => ({
    rows: g.rowNumbers,
    values: g.values,
    lines: g.lines.map((l) => ({ row: l.row, values: l.values })),
  }));
  return {
    summary: {
      projects: p.items.length,
      vendor_lines: p.items.reduce((n, g) => n + g.lines.length, 0),
      new_customers: p.newCustomers.map((c) => c.name),
      new_vendors: p.newVendors.map((v) => v.name),
      new_segments: p.newSegments.map((s) => s.label),
      skipped_duplicates: p.skipped,
      errors: p.errors.length,
      warnings: p.warnings.length,
    },
    notes: p.notes,
    errors: p.errors,
    warnings: p.warnings,
    sample,
    sample_truncated: p.items.length > sample.length,
  };
}

/**
 * Re-validate from this request, then write everything in one explicit
 * transaction under the write mutex. Snapshots are exported AFTER the mutex
 * block (exportSnapshots takes it itself). Imported projects get
 * drive_folder_id = NULL - the column is retained as a stale field now that
 * Drive folder linking has been removed.
 */
export async function commitProjectImport(
  _user: AuthUser,
  body: unknown,
): Promise<ImportCommitResponse> {
  const p = await prepare(body);
  if (p.errors.length > 0) {
    throw new ImportError(`Import has ${p.errors.length} error(s) — nothing was written`, 400, {
      errors: p.errors.slice(0, 50),
    });
  }

  const createdVendorLines = p.items.reduce((n, g) => n + (g.linePayloads?.length ?? 0), 0);

  await runWrite(async (ex) => {
    await ex('BEGIN');
    try {
      const [segMax] = await ex<{ maxSort: number | bigint | null }>(
        `SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM market_segments`,
      );
      let nextSegmentSort = Number(segMax?.maxSort ?? 0) + 1;
      for (const s of p.newSegments) {
        await ex(
          `INSERT INTO market_segments (id, label, is_active, sort_order) VALUES (?, ?, true, ?)`,
          [s.id, s.label, nextSegmentSort++],
        );
      }
      for (const c of p.newCustomers) {
        await ex(`INSERT INTO customers (id, name, created_at) VALUES (?, ?, current_timestamp)`, [
          c.id,
          c.name,
        ]);
      }
      for (const v of p.newVendors) {
        await ex(`INSERT INTO vendors (id, name, created_at) VALUES (?, ?, current_timestamp)`, [
          v.id,
          v.name,
        ]);
      }
      for (const g of p.items) {
        if (!g.payload) continue; // unreachable when errors are empty
        await ex(insertProjectSql(), buildInsertValues(g.projectId, g.payload));
        for (const [i, line] of (g.linePayloads ?? []).entries()) {
          await ex(
            insertVendorLineSql(),
            vendorLineValues(uuid(), g.projectId, line.payload, i),
          );
        }
      }
      await ex('COMMIT');
    } catch (err) {
      await ex('ROLLBACK');
      throw err;
    }
  });
  await exportSnapshots(['projects', 'project_vendors', 'customers', 'vendors']);

  return {
    created_projects: p.items.filter((g) => g.payload).length,
    created_vendor_lines: createdVendorLines,
    created_customers: p.newCustomers.length,
    created_vendors: p.newVendors.length,
    created_segments: p.newSegments.length,
    skipped_duplicates: p.skipped,
  };
}
