// CSV serialization for GET /api/projects/export.csv.
//
// NOTE: unrelated to db/export.ts, which writes the Parquet snapshots. This
// module backs the user-facing "Export CSV" grid button only.
//
// One row per vendor line, headers taken from the shared import registry so an
// exported file can be fed straight back into the Import wizard and auto-map.
// Deliberately pure — no DB, no I/O, no clock — so the escaping / label /
// injection rules are unit-testable.

import { IMPORT_FIELDS, computeAging } from '@tracker/shared';
import type { ImportField, Project, ProjectVendorLine } from '@tracker/shared';

/** UTF-8 BOM: without it Excel mis-reads non-ASCII (Indonesian) names. */
export const CSV_BOM = '\uFEFF';
const ROW_SEPARATOR = '\r\n';

/**
 * Lookups the caller resolves once and passes in, so the serializer never
 * touches the database.
 */
export interface CsvExportContext {
  /**
   * user id -> login email. Sales and PIC export as EMAIL rather than name:
   * the importer matches email first, and names are not guaranteed unique — a
   * name shared by two active users makes the importer reject the row.
   */
  emailById: ReadonlyMap<string, string>;
}

/** `null` = a project with no vendor lines (one blank-vendor row is emitted). */
type VendorLine = ProjectVendorLine | null;

type RegistryGetter = (project: Project, line: VendorLine, ctx: CsvExportContext) => unknown;

/** One output column: a header plus a formatter that returns a final cell value. */
export interface CsvExportColumn {
  header: string;
  get(project: Project, line: VendorLine, ctx: CsvExportContext): string;
}

// Text cells starting with one of these are treated as formulas by Excel /
// Sheets, so a leading apostrophe neutralises them. Never applied to numbers
// or dates — a negative amount must stay "-5000", not "'-5000".
const FORMULA_LEAD_IN = /^[=+\-@\t\r]/;

function textCell(value: string): string {
  return FORMULA_LEAD_IN.test(value) ? `'${value}` : value;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// DuckDB's DATE driver values arrive as ISO timestamp strings or as a Date at
// UTC midnight; the API contract is YYYY-MM-DD (same normalisation as
// dateOnly() in issuesService.ts).
function dateCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function numberCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : '';
}

function enumCell(field: ImportField, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const raw = String(value);
  const index = field.enumInternals?.indexOf(raw) ?? -1;
  if (index < 0) return raw;
  return field.enumValues?.[index] ?? raw;
}

/** Registry fields format by `field.type`; unknown types fall back to text. */
function formatValue(field: ImportField, value: unknown): string {
  switch (field.type) {
    case 'date':
      return dateCell(value);
    case 'number':
      return numberCell(value);
    case 'enum':
      return enumCell(field, value);
    default:
      return value === null || value === undefined ? '' : textCell(String(value));
  }
}

const projectValue =
  (key: keyof Project): RegistryGetter =>
  (project) =>
    project[key];

const lineValue =
  (key: keyof ProjectVendorLine): RegistryGetter =>
  (_project, line) =>
    line?.[key];

// Exactly one getter per IMPORT_FIELDS key. Adding a registry field without a
// getter here fails csvExport.test.ts (the column would export blank).
const GETTERS: Record<string, RegistryGetter> = {
  // --- project level ---
  project_name: projectValue('project_name'),
  folder_name: projectValue('folder_name'),
  staff_assigned: (project, _line, ctx) =>
    project.staff_assigned_id ? (ctx.emailById.get(project.staff_assigned_id) ?? '') : '',
  pic: (project, _line, ctx) =>
    (project.pics ?? [])
      .map((pic) => ctx.emailById.get(pic.id) ?? '')
      .filter((email) => email !== '')
      .join(';'),
  current_stage: projectValue('current_stage'),
  customer_name: projectValue('customer_name'),
  market_segment: projectValue('market_segment'),
  service_or_goods: projectValue('service_or_goods'),
  date_customer_received_doc1: projectValue('date_customer_received_doc1'),
  date_customer_received_doc2: projectValue('date_customer_received_doc2'),
  doc2_number_id: projectValue('doc2_number_id'),
  customer_price: projectValue('customer_price'),
  customer_start_contract: projectValue('customer_start_contract'),
  customer_end_contract: projectValue('customer_end_contract'),

  // --- vendor line level ---
  vendor_name: lineValue('vendor_name'),
  vendor_type: lineValue('vendor_type'),
  vendor_revenue: lineValue('vendor_revenue'),
  project_sent_date: lineValue('project_sent_date'),
  project_finish_date: lineValue('project_finish_date'),
  vendor_project_id: lineValue('vendor_project_id'),
  negotiation_date: lineValue('negotiation_date'),
  approval_date: lineValue('approval_date'),
  document_sent_date: lineValue('document_sent_date'),
  document_id: lineValue('document_id'),
  vendor_price: lineValue('vendor_price'),
  vendor_start_contract: lineValue('vendor_start_contract'),
  vendor_end_contract: lineValue('vendor_end_contract'),
};

/** Info-only trailing headers (not importable, so the wizard ignores them). */
export const CSV_INFO_HEADERS = ['Aging (days)', 'Priority', 'Update Progress', 'Action'] as const;

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const REGISTRY_COLUMNS: CsvExportColumn[] = IMPORT_FIELDS.map((field) => ({
  header: field.label,
  get: (project, line, ctx) => {
    const getter = GETTERS[field.key];
    return formatValue(field, getter ? getter(project, line, ctx) : null);
  },
}));

const INFO_COLUMNS: CsvExportColumn[] = [
  { header: 'Aging (days)', get: (_project, line) => numberCell(line ? computeAging(line) : null) },
  { header: 'Priority', get: (_project, line) => PRIORITY_LABELS[line?.priority ?? ''] ?? '' },
  { header: 'Update Progress', get: (project) => textCell(project.update_progress ?? '') },
  { header: 'Action', get: (project) => textCell(project.issues ?? '') },
];

/** Registry columns in registry order, then the four info-only columns. */
export const CSV_EXPORT_COLUMNS: CsvExportColumn[] = [...REGISTRY_COLUMNS, ...INFO_COLUMNS];

export const CSV_EXPORT_HEADERS: string[] = CSV_EXPORT_COLUMNS.map((column) => column.header);

export interface CsvExportRow {
  project: Project;
  /** `null` when the project has no vendor lines. */
  line: VendorLine;
}

/**
 * One row per vendor line; project values repeat on every line so the file
 * stays flat (filterable in Excel) and the importer can group by folder or
 * project name. A project with zero vendor lines still gets one row.
 */
export function flattenProjectsToRows(projects: Project[]): CsvExportRow[] {
  const rows: CsvExportRow[] = [];
  for (const project of projects) {
    const lines = project.vendors ?? [];
    if (lines.length === 0) {
      rows.push({ project, line: null });
      continue;
    }
    for (const line of lines) rows.push({ project, line });
  }
  return rows;
}

/** RFC 4180: quote cells containing a comma, quote, CR or LF; double inner quotes. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Full file: BOM + CRLF-separated rows + trailing CRLF. */
export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((cells) => cells.map(csvCell).join(','));
  return `${CSV_BOM}${lines.join(ROW_SEPARATOR)}${ROW_SEPARATOR}`;
}

export function buildProjectsCsv(projects: Project[], ctx: CsvExportContext): string {
  const rows = flattenProjectsToRows(projects).map(({ project, line }) =>
    CSV_EXPORT_COLUMNS.map((column) => column.get(project, line, ctx)),
  );
  return toCsv(CSV_EXPORT_HEADERS, rows);
}
