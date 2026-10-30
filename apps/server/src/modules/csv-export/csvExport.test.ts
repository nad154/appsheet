import { describe, expect, it } from 'vitest';
import { IMPORT_FIELDS } from '@tracker/shared';
import type { Project, ProjectVendorLine } from '@tracker/shared';
import {
  CSV_BOM,
  CSV_EXPORT_HEADERS,
  CSV_INFO_HEADERS,
  buildProjectsCsv,
  flattenProjectsToRows,
  toCsv,
  type CsvExportContext,
} from './csvExport.js';

const EMPTY_CTX: CsvExportContext = { emailById: new Map() };

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    project_name: 'Alpha',
    folder_name: null,
    staff_assigned_name: null,
    staff_assigned_id: null,
    drive_folder_id: null,
    customer_id: null,
    customer_name: null,
    market_segment: null,
    service_or_goods: null,
    date_customer_received_doc1: null,
    date_customer_received_doc2: null,
    doc2_number_id: null,
    customer_price: null,
    customer_start_contract: null,
    customer_end_contract: null,
    current_stage: 'on_progress',
    pics: [],
    issues: null,
    vendors: [],
    update_progress: null,
    has_unread_update: false,
    latest_issue_date: null,
    latest_issue_assignees: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeLine(overrides: Partial<ProjectVendorLine> = {}): ProjectVendorLine {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    project_id: '11111111-1111-4111-8111-111111111111',
    vendor_id: '33333333-3333-4333-8333-333333333333',
    vendor_name: 'Vendor',
    vendor_type: null,
    vendor_revenue: null,
    project_sent_date: null,
    project_finish_date: null,
    vendor_project_id: null,
    negotiation_date: null,
    approval_date: null,
    document_sent_date: null,
    document_id: null,
    vendor_price: null,
    vendor_start_contract: null,
    vendor_end_contract: null,
    sort_order: 0,
    priority: null,
    ...overrides,
  };
}

/** Minimal RFC 4180 reader — proves the written file can be read back. */
function parseCsv(csv: string): string[][] {
  const text = csv.startsWith(CSV_BOM) ? csv.slice(CSV_BOM.length) : csv;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
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
      // CR is only a line separator here (CRLF); a lone CR is ignored.
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function columnIndex(header: string): number {
  const index = CSV_EXPORT_HEADERS.indexOf(header);
  if (index < 0) throw new Error(`Unknown header: ${header}`);
  return index;
}

describe('csv export registry coverage', () => {
  it('writes every import field, in registry order, then the info columns', () => {
    expect(CSV_EXPORT_HEADERS.slice(0, IMPORT_FIELDS.length)).toEqual(IMPORT_FIELDS.map((f) => f.label));
    expect(CSV_EXPORT_HEADERS.slice(IMPORT_FIELDS.length)).toEqual([...CSV_INFO_HEADERS]);
  });

  it('has unique headers', () => {
    expect(new Set(CSV_EXPORT_HEADERS).size).toBe(CSV_EXPORT_HEADERS.length);
  });

  it('has a working getter for every import field', () => {
    const ctx: CsvExportContext = {
      emailById: new Map([
        ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'sales@example.com'],
        ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'pic@example.com'],
      ]),
    };
    const project = makeProject({
      project_name: 'Full Project',
      folder_name: 'F-1',
      staff_assigned_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      pics: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Pic One' }],
      current_stage: 'finish',
      customer_name: 'PT Customer',
      market_segment: 'Government',
      service_or_goods: 'service',
      date_customer_received_doc1: '2026-01-01',
      date_customer_received_doc2: '2026-01-02',
      doc2_number_id: 'PO-1',
      customer_price: 1500000000,
      customer_start_contract: '2026-02-01',
      customer_end_contract: '2026-12-31',
      update_progress: 'waiting on vendor',
      issues: 'none',
      vendors: [
        makeLine({
          vendor_name: 'PT Vendor',
          vendor_type: 'goods',
          vendor_revenue: 1000000000,
          project_sent_date: '2026-03-01',
          project_finish_date: '2026-04-01',
          vendor_project_id: 'FPT-1',
          negotiation_date: '2026-03-05',
          approval_date: '2026-03-10',
          document_sent_date: '2026-03-11',
          document_id: 'PO-V-1',
          vendor_price: 950000000,
          vendor_start_contract: '2026-05-01',
          vendor_end_contract: '2027-05-01',
          priority: 'high',
        }),
      ],
    });

    const [, dataRow] = parseCsv(buildProjectsCsv([project], ctx));
    const values = IMPORT_FIELDS.map((field, i) => [field.key, dataRow[i]] as const);
    expect(values.filter(([, value]) => value === '').map(([key]) => key)).toEqual([]);
  });
});

describe('csv export formatting', () => {
  it('starts with exactly one BOM and separates rows with CRLF', () => {
    const csv = buildProjectsCsv([makeProject()], EMPTY_CTX);
    expect(csv.startsWith(`${CSV_BOM}Project Name,`)).toBe(true);
    expect(csv.indexOf(CSV_BOM, 1)).toBe(-1);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n').length).toBe(3); // header + 1 row + trailing ''
  });

  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    const name = 'A, B "quoted"\nsecond line';
    const csv = buildProjectsCsv([makeProject({ project_name: name })], EMPTY_CTX);
    expect(csv).toContain('"A, B ""quoted""\nsecond line"');
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe(name);
  });

  it('neutralises formula lead-ins in text cells only', () => {
    for (const raw of ['=cmd', '+cmd', '-cmd', '@cmd', '\tcmd']) {
      const [, dataRow] = parseCsv(
        buildProjectsCsv([makeProject({ project_name: raw })], EMPTY_CTX),
      );
      expect(dataRow[0]).toBe(`'${raw}`);
    }

    // Numbers and dates must never be prefixed.
    const [, numberRow] = parseCsv(
      buildProjectsCsv([makeProject({ customer_price: -5000 })], EMPTY_CTX),
    );
    expect(numberRow[columnIndex('Customer PO/PKS Amount')]).toBe('-5000');
  });

  it('formats dates from strings, Date objects and null', () => {
    const [, row] = parseCsv(
      buildProjectsCsv(
        [
          makeProject({
            date_customer_received_doc1: '2026-01-15T00:00:00Z',
            date_customer_received_doc2: new Date('2026-02-20T00:00:00.000Z') as unknown as string,
            customer_start_contract: null,
          }),
        ],
        EMPTY_CTX,
      ),
    );
    expect(row[columnIndex('Customer SP Received Date')]).toBe('2026-01-15');
    expect(row[columnIndex('Customer PO/PKS Received Date')]).toBe('2026-02-20');
    expect(row[columnIndex('Customer Contract Start')]).toBe('');
  });

  it('maps enum internals to the labels the importer accepts', () => {
    const [, row] = parseCsv(
      buildProjectsCsv(
        [makeProject({ current_stage: 'finish', service_or_goods: 'goods' })],
        EMPTY_CTX,
      ),
    );
    expect(row[columnIndex('Status')]).toBe('Finish');
    expect(row[columnIndex('Project Type')]).toBe('goods');
  });

  it('writes plain integers and blanks null numbers', () => {
    const [, row] = parseCsv(
      buildProjectsCsv(
        [makeProject({ customer_price: 1500000000, date_customer_received_doc1: null })],
        EMPTY_CTX,
      ),
    );
    expect(row[columnIndex('Customer PO/PKS Amount')]).toBe('1500000000');
    expect(row[columnIndex('Customer PO/PKS Amount')]).not.toMatch(/Rp|[.,]000/);
  });

  it('exports Sales and PIC by email, joining multiple PICs with ";"', () => {
    const ctx: CsvExportContext = {
      emailById: new Map([
        ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'sales@example.com'],
        ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'pic1@example.com'],
        ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'pic2@example.com'],
      ]),
    };
    const [, row] = parseCsv(
      buildProjectsCsv(
        [
          makeProject({
            staff_assigned_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            pics: [
              { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Pic One' },
              // Dangling PIC (permanently deleted user) has no email -> dropped.
              { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: null },
              { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Pic Two' },
            ],
          }),
        ],
        ctx,
      ),
    );
    expect(row[columnIndex('Sales Name')]).toBe('sales@example.com');
    expect(row[columnIndex('Responsible PIC')]).toBe('pic1@example.com;pic2@example.com');
  });

  it('leaves a dangling vendor/customer reference blank instead of writing a placeholder', () => {
    const [, row] = parseCsv(
      buildProjectsCsv(
        [
          makeProject({
            customer_name: null,
            // A hard-deleted vendor leaves the line pointing at a missing row,
            // so the joined name is null at runtime despite the string type.
            vendors: [makeLine({ vendor_name: null as unknown as string })],
          }),
        ],
        EMPTY_CTX,
      ),
    );
    expect(row[columnIndex('Customer')]).toBe('');
    expect(row[columnIndex('Vendor')]).toBe('');
  });

  it('writes the info columns (aging, priority, progress, action)', () => {
    const [, row] = parseCsv(
      buildProjectsCsv(
        [
          makeProject({
            update_progress: 'waiting',
            issues: '=bad formula',
            vendors: [
              makeLine({ project_sent_date: '2026-01-01', approval_date: '2026-01-08', priority: 'medium' }),
            ],
          }),
        ],
        EMPTY_CTX,
      ),
    );
    expect(row[columnIndex('Aging (days)')]).toBe('5');
    expect(row[columnIndex('Priority')]).toBe('Medium');
    expect(row[columnIndex('Update Progress')]).toBe('waiting');
    expect(row[columnIndex('Action')]).toBe("'=bad formula");
  });
});

describe('csv export flattening', () => {
  it('emits one row for a project with no vendor lines', () => {
    const rows = flattenProjectsToRows([makeProject()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].line).toBeNull();

    const parsed = parseCsv(buildProjectsCsv([makeProject()], EMPTY_CTX));
    expect(parsed).toHaveLength(2); // header + one row
    expect(parsed[1][columnIndex('Vendor')]).toBe('');
  });

  it('repeats project values on one row per vendor line', () => {
    const project = makeProject({
      project_name: 'Multi',
      vendors: [
        makeLine({ vendor_name: 'Vendor A' }),
        makeLine({ vendor_name: 'Vendor B' }),
        makeLine({ vendor_name: 'Vendor C' }),
      ],
    });
    expect(flattenProjectsToRows([project])).toHaveLength(3);

    const parsed = parseCsv(buildProjectsCsv([project], EMPTY_CTX));
    const dataRows = parsed.slice(1);
    expect(dataRows).toHaveLength(3);
    expect(dataRows.map((r) => r[columnIndex('Project Name')])).toEqual(['Multi', 'Multi', 'Multi']);
    expect(dataRows.map((r) => r[columnIndex('Vendor')])).toEqual(['Vendor A', 'Vendor B', 'Vendor C']);
  });
});

describe('toCsv', () => {
  it('always writes a header row, even with no data', () => {
    expect(toCsv(['A', 'B'], [])).toBe(`${CSV_BOM}A,B\r\n`);
  });
});
