import { z } from 'zod';
import { IMPORT_DATE_FORMATS, IMPORT_FIELD_KEYS } from '../lib/importFields.js';

// Request/response contract for POST /api/import/projects/preview|commit.
// The client applies its column mapping BEFORE sending (plan §5 preferred), so
// every row key is an internal import field key. The server whitelists keys
// against IMPORT_FIELD_KEYS and rejects unknown ones with 400.

/** Hard cap on rows per request (plan §5). */
export const IMPORT_MAX_ROWS = 5000;

export const importOptionsSchema = z.object({
  /** Blank project cells copy the values from the row above (grid-style CSVs). */
  continueBlankRows: z.boolean().default(true),
  dateFormat: z.enum(IMPORT_DATE_FORMATS).default('DD/MM/YYYY'),
  /** What to do when the project already exists (matched on folder, else name). */
  onDuplicate: z.enum(['skip', 'reject']).default('skip'),
});

export type ImportOptions = z.infer<typeof importOptionsSchema>;

// CSV cells arrive as strings; papaparse may hand back numbers/booleans, so
// accept those too and stringify server-side. Null/empty means "blank cell".
const importCellSchema = z.union([
  z.string().max(1000),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const importRowSchema = z.record(importCellSchema);

export const projectImportRequestSchema = z
  .object({
    options: importOptionsSchema.default({}),
    rows: z.array(importRowSchema).min(1).max(IMPORT_MAX_ROWS),
  })
  .superRefine((req, ctx) => {
    req.rows.forEach((row, i) => {
      for (const key of Object.keys(row)) {
        if (!IMPORT_FIELD_KEYS.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['rows', i, key],
            message: `Unknown import field: ${key}`,
          });
        }
      }
    });
  });

export type ProjectImportRequest = z.infer<typeof projectImportRequestSchema>;

// --- Responses --------------------------------------------------------------

/** One validation problem, already worded with the registry's human label. */
export interface ImportIssue {
  /** 1-based data-row number (row 1 = first row after the CSV header). */
  row: number;
  fieldKey: string | null;
  message: string;
}

/** One vendor line inside a sample project. `values` are keyed by import key. */
export interface ImportSampleLine {
  row: number;
  values: Record<string, string | number | null>;
}

/** One project in the preview sample. `values` are keyed by import key. */
export interface ImportSampleProject {
  rows: number[];
  values: Record<string, string | number | null>;
  lines: ImportSampleLine[];
}

export interface ImportPreviewResponse {
  summary: {
    projects: number;
    vendor_lines: number;
    /** Names of customers that will be created by this import. */
    new_customers: string[];
    new_vendors: string[];
    new_segments: string[];
    skipped_duplicates: number;
    errors: number;
    warnings: number;
  };
  /** Informational notes, e.g. "No vendor column mapped…". */
  notes: string[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** First 50 projects (nested vendor lines) — plan §4 step 3. */
  sample: ImportSampleProject[];
  sample_truncated: boolean;
}

export interface ImportCommitResponse {
  created_projects: number;
  created_vendor_lines: number;
  created_customers: number;
  created_vendors: number;
  created_segments: number;
  skipped_duplicates: number;
}
