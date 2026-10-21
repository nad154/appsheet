// Field registry for CSV import. One entry per importable field; the mapping
// window, template download, header auto-suggest, server whitelist and import
// error messages all read from here — nothing else holds labels for import.
//
// Rename rule: `label`, `description`, `aliases` and `example` are free to
// edit at any time. The `key` is the contract with the database columns, the
// zod schemas and saved mappings, and must never change.

export type ImportFieldType = 'text' | 'number' | 'date' | 'enum' | 'lookup';
export type ImportFieldLevel = 'project' | 'vendor';
export type ImportFieldSection = 'Project info' | 'Customer' | 'Vendor line';

export interface ImportField {
  /** Internal key sent to the server. NEVER rename. */
  key: string;
  /** Natural-language name shown in the modal. Free to edit. */
  label: string;
  /** One or two sentences shown under the dropdown. Free to edit. */
  description: string;
  section: ImportFieldSection;
  /** 'project' = read once per project, 'vendor' = one per CSV row. */
  level: ImportFieldLevel;
  type: ImportFieldType;
  required?: boolean;
  /** Alternative CSV header spellings for auto-suggest. Includes the key. */
  aliases: string[];
  /** Example value shown in the template download and as a hint. */
  example?: string;
  /** User-visible accepted values for enum fields. */
  enumValues?: readonly string[];
  /** Internal values written to the DB, parallel to enumValues. Never renamed. */
  enumInternals?: readonly string[];
}

// Date formats offered by the import options dropdown. Any format still
// accepts YYYY-MM-DD, ISO timestamps, the grid's long format
// ("15 September 2026") and a month name with dashes or dots
// ("9-Jun-26", "9.Jun.2026") regardless of the choice.
export const IMPORT_DATE_FORMATS = [
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'YYYY-MM-DD',
  'D Month YYYY',
  'D-Mon-YY',
] as const;
export type ImportDateFormat = (typeof IMPORT_DATE_FORMATS)[number];
export const DEFAULT_IMPORT_DATE_FORMAT: ImportDateFormat = 'DD/MM/YYYY';

// customer_price, vendor_revenue and vendor_price are DuckDB BIGINT columns
// (signed 64-bit). JSON/JS carries them as Numbers, so the real ceiling is the
// safe-integer limit (9,007,199,254,740,991 ≈ Rp 9 quadrillion) — larger values
// would lose precision. Validation reports anything above it clearly.
export const IMPORT_MAX_INTEGER = Number.MAX_SAFE_INTEGER;

export const IMPORT_FIELD_SECTIONS = ['Project info', 'Customer', 'Vendor line'] as const;

export const IMPORT_FIELDS: ImportField[] = [
  // --- Project info ---------------------------------------------------------
  {
    key: 'project_name',
    label: 'Project Name',
    description:
      'Name of the project. Rows with the same project name (or folder reference) are grouped into one project.',
    section: 'Project info',
    level: 'project',
    type: 'text',
    required: true,
    aliases: ['project_name', 'Project Name', 'Nama Proyek', 'Nama Project'],
    example: 'Website Revamp 2026',
  },
  {
    key: 'folder_name',
    label: 'Folder Reference',
    description:
      'Internal folder/reference code for the project, e.g. 2026-001. Used first to group rows into one project.',
    section: 'Project info',
    level: 'project',
    type: 'text',
    aliases: ['folder_name', 'Folder Reference', 'Folder', 'Referensi Folder', 'Kode Folder'],
    example: '2026-001',
  },
  {
    key: 'staff_assigned',
    label: 'Sales Name',
    description: 'Sales person responsible. Match by the user\u2019s email or exact name.',
    section: 'Project info',
    level: 'project',
    type: 'lookup',
    aliases: ['staff_assigned', 'staff_assigned_id', 'Sales Name', 'Sales', 'PIC Sales'],
    example: 'admin@example.com',
  },
  {
    key: 'pic',
    label: 'Responsible PIC',
    description: 'Person in charge of the project. Match by email or exact name.',
    section: 'Project info',
    level: 'project',
    type: 'lookup',
    aliases: ['pic', 'pic_id', 'Responsible PIC', 'PIC'],
    example: 'admin@example.com',
  },
  {
    key: 'current_stage',
    label: 'Status',
    description: '"On Progress" or "Finish". Blank means On Progress.',
    section: 'Project info',
    level: 'project',
    type: 'enum',
    aliases: ['current_stage', 'Status', 'Stage', 'Tahapan'],
    example: 'On Progress',
    enumValues: ['On Progress', 'Finish'],
    enumInternals: ['on_progress', 'finish'],
  },

  // --- Customer -------------------------------------------------------------
  {
    key: 'customer_name',
    label: 'Customer',
    description: "Customer name. Matched ignoring case. If it doesn't exist yet it is created.",
    section: 'Customer',
    level: 'project',
    type: 'lookup',
    aliases: ['customer_name', 'customer', 'Customer', 'Pelanggan', 'Customer Name'],
    example: 'PT Stedin Nusantara',
  },
  {
    key: 'market_segment',
    label: 'Market Segment',
    description: 'Free-text segment, e.g. Government, Enterprise. Unknown segments are created.',
    section: 'Customer',
    level: 'project',
    type: 'lookup',
    aliases: ['market_segment', 'Market Segment', 'Segment', 'Segmen'],
    example: 'Government',
  },
  {
    key: 'service_or_goods',
    label: 'Project Type',
    description: '"service" or "goods".',
    section: 'Customer',
    level: 'project',
    type: 'enum',
    aliases: ['service_or_goods', 'Project Type', 'Jenis Proyek', 'Service/Goods'],
    example: 'service',
    enumValues: ['service', 'goods'],
    enumInternals: ['service', 'goods'],
  },
  {
    key: 'date_customer_received_doc1',
    label: 'Customer SP Received Date',
    description: "Date the customer's SP (order letter) was received.",
    section: 'Customer',
    level: 'project',
    type: 'date',
    aliases: [
      'date_customer_received_doc1',
      'Customer SP Received Date',
      'SP Received Date',
      'Tanggal Terima SP Customer',
    ],
    example: '15/01/2026',
  },
  {
    key: 'date_customer_received_doc2',
    label: 'Customer PO/PKS Received Date',
    description: 'Date the customer\u2019s PO/PKS was received.',
    section: 'Customer',
    level: 'project',
    type: 'date',
    aliases: [
      'date_customer_received_doc2',
      'Customer PO/PKS Received Date',
      'Tanggal Terima PO/PKS Customer',
      'PO/PKS Received Date',
    ],
    example: '20/01/2026',
  },
  {
    key: 'doc2_number_id',
    label: 'Customer PO/PKS Number',
    description: 'PO/PKS number from the customer.',
    section: 'Customer',
    level: 'project',
    type: 'text',
    aliases: ['doc2_number_id', 'Customer PO/PKS Number', 'Number PO/PKS Customer', 'No PO/PKS'],
    example: 'PO-2026-001',
  },
  {
    key: 'customer_price',
    label: 'Customer PO/PKS Amount',
    description: 'Contract value from the customer, in Rupiah, whole numbers.',
    section: 'Customer',
    level: 'project',
    type: 'number',
    aliases: ['customer_price', 'Customer PO/PKS Amount', 'Nilai PO/PKS Customer', 'Customer Price'],
    example: '1500000000',
  },
  {
    key: 'customer_start_contract',
    label: 'Customer Contract Start',
    description: 'Start date of the customer contract.',
    section: 'Customer',
    level: 'project',
    type: 'date',
    aliases: ['customer_start_contract', 'Customer Contract Start', 'Start Contract Date'],
    example: '01/02/2026',
  },
  {
    key: 'customer_end_contract',
    label: 'Customer Contract End',
    description: 'End date of the customer contract. Used for the deadline warning.',
    section: 'Customer',
    level: 'project',
    type: 'date',
    aliases: ['customer_end_contract', 'Customer Contract End', 'End Contract Date'],
    example: '31/12/2026',
  },

  // --- Vendor line (one per CSV row) ---------------------------------------
  {
    key: 'vendor_name',
    label: 'Vendor',
    description:
      'Vendor for this line. Matched ignoring case. Created if missing. A row with no vendor creates no vendor line.',
    section: 'Vendor line',
    level: 'vendor',
    type: 'lookup',
    aliases: ['vendor_name', 'Vendor', 'Supplier', 'Nama Vendor'],
    example: 'PT Maju Jaya',
  },
  {
    key: 'vendor_type',
    label: 'Vendor Project Type',
    description: '"service" or "goods" for this vendor line.',
    section: 'Vendor line',
    level: 'vendor',
    type: 'enum',
    aliases: ['vendor_type', 'Vendor Project Type', 'Project Type', 'Jenis Vendor'],
    example: 'service',
    enumValues: ['service', 'goods'],
    enumInternals: ['service', 'goods'],
  },
  {
    key: 'vendor_revenue',
    label: 'RAB Amount',
    description: 'Budget amount (RAB) for this vendor line, in Rupiah.',
    section: 'Vendor line',
    level: 'vendor',
    type: 'number',
    aliases: ['vendor_revenue', 'RAB Amount', 'RAB', 'Nilai RAB'],
    example: '1000000000',
  },
  {
    key: 'project_sent_date',
    label: 'FPT Sent Date',
    description:
      'Date the FPT was sent to the vendor. Aging starts counting from this date, and Priority is derived from it.',
    section: 'Vendor line',
    level: 'vendor',
    type: 'date',
    aliases: ['project_sent_date', 'FPT Sent Date', 'Finish FPT Date', 'Tanggal Kirim FPT'],
    example: '01/08/2026',
  },
  {
    key: 'project_finish_date',
    label: 'FPT Finish Date',
    description: 'Date the FPT was finished.',
    section: 'Vendor line',
    level: 'vendor',
    type: 'date',
    aliases: ['project_finish_date', 'FPT Finish Date', 'Tgl Finish FPT', 'Tanggal Finish FPT'],
    example: '15/08/2026',
  },
  {
    key: 'vendor_project_id',
    label: 'FPT Number',
    description: 'FPT number for this vendor line.',
    section: 'Vendor line',
    level: 'vendor',
    type: 'text',
    aliases: ['vendor_project_id', 'FPT Number', 'No FPT', 'Nomor FPT'],
    example: 'FPT-2026-001',
  },
  {
    key: 'negotiation_date',
    label: 'Vendor Negotiation Date',
    description: 'Date negotiation with the vendor took place.',
    section: 'Vendor line',
    level: 'vendor',
    type: 'date',
    aliases: ['negotiation_date', 'Vendor Negotiation Date', 'Negotiation Date', 'Tanggal Negosiasi'],
    example: '25/07/2026',
  },
  {
    key: 'approval_date',
    label: 'Vendor SP Received Date',
    description: "Date the vendor's SP was received. Stops the Aging count for this line.",
    section: 'Vendor line',
    level: 'vendor',
    type: 'date',
    aliases: ['approval_date', 'Vendor SP Received Date', 'SP Received Date', 'Tanggal Terima SP Vendor'],
    example: '28/07/2026',
  },
  {
    key: 'document_sent_date',
    label: 'PO/PKS Sent to Vendor Date',
    description: 'Date the PO/PKS was sent to the vendor.',
    section: 'Vendor line',
    level: 'vendor',
    type: 'date',
    aliases: ['document_sent_date', 'PO/PKS Sent to Vendor Date', 'PO/PKS Sent Date', 'Tanggal Kirim PO/PKS'],
    example: '05/08/2026',
  },
  {
    key: 'document_id',
    label: 'Vendor PO/PKS Number',
    description: 'PO/PKS number issued to the vendor.',
    section: 'Vendor line',
    level: 'vendor',
    type: 'text',
    aliases: ['document_id', 'Vendor PO/PKS Number', 'Number PO/PKS', 'No PO/PKS Vendor'],
    example: 'PO-V-2026-001',
  },
  {
    key: 'vendor_price',
    label: 'Vendor PO/PKS Amount',
    description: 'PO/PKS value for the vendor, in Rupiah.',
    section: 'Vendor line',
    level: 'vendor',
    type: 'number',
    aliases: ['vendor_price', 'Vendor PO/PKS Amount', 'PO/PKS Amount', 'Nilai PO/PKS Vendor'],
    example: '950000000',
  },
  {
    key: 'vendor_start_contract',
    label: 'Vendor Contract Start',
    description: 'Start date of the vendor contract.',
    section: 'Vendor line',
    level: 'vendor',
    type: 'date',
    aliases: ['vendor_start_contract', 'Vendor Contract Start', 'Start Contract Date', 'Mulai Kontrak Vendor'],
    example: '01/09/2026',
  },
  {
    key: 'vendor_end_contract',
    label: 'Vendor Contract End',
    description: 'End date of the vendor contract.',
    section: 'Vendor line',
    level: 'vendor',
    type: 'date',
    aliases: ['vendor_end_contract', 'Vendor Contract End', 'End Contract Date', 'Akhir Kontrak Vendor'],
    example: '31/08/2027',
  },
];

export const IMPORT_FIELD_KEYS: Set<string> = new Set(IMPORT_FIELDS.map((f) => f.key));

export const IMPORT_FIELD_BY_KEY: ReadonlyMap<string, ImportField> = new Map(
  IMPORT_FIELDS.map((f) => [f.key, f]),
);

/** Label for an import field key — used so import error messages never leak keys. */
export function importFieldLabel(key: string): string {
  return IMPORT_FIELD_BY_KEY.get(key)?.label ?? key;
}

/** Fields grouped by section, in registry order — the dropdown's option groups. */
export function importFieldsBySection(): { section: ImportFieldSection; fields: ImportField[] }[] {
  return IMPORT_FIELD_SECTIONS.map((section) => ({
    section,
    fields: IMPORT_FIELDS.filter((f) => f.section === section),
  })).filter((g) => g.fields.length > 0);
}
