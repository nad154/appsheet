import Papa from 'papaparse';
import { IMPORT_FIELDS } from '@tracker/shared';
import type { ImportField } from '@tracker/shared';

// Everything about reading a CSV happens in the browser (plan §4) — nothing
// is sent to the server until the preview step. papaparse auto-detects the
// delimiter; Excel in Indonesian locale often exports semicolons.

export interface ParsedCsv {
  fileName: string;
  /** Trimmed, de-duplicated header cells (display names, not field keys). */
  headers: string[];
  /** Data rows aligned to `headers` (padded with '' / truncated). */
  rows: string[][];
  /** Raw delimiter papaparse detected, e.g. ',', ';', '\t'. */
  delimiter: string;
  delimiterLabel: string;
  rowCount: number;
}

export function delimiterLabel(d: string): string {
  if (d === ',') return 'comma (,)';
  if (d === ';') return 'semicolon (;)';
  if (d === '\t') return 'tab';
  if (d === '|') return 'pipe (|)';
  return d ? `"${d}"` : 'comma (,) — guessed';
}

export async function parseCsvFile(file: File): Promise<ParsedCsv> {
  const text = await file.text();
  // Strip the UTF-8 BOM Excel writes, otherwise it lands in the first header.
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const result = Papa.parse<string[]>(cleaned, {
    delimiter: '', // auto-detect comma / semicolon / tab
    skipEmptyLines: true,
  });
  const data = result.data.filter((r) => Array.isArray(r));
  if (data.length === 0) {
    throw new Error('This file has no rows to import.');
  }

  const seen = new Map<string, number>();
  const headers = (data[0] ?? []).map((raw, i) => {
    let name = String(raw ?? '').trim() || `Column ${i + 1}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count > 0) name = `${name} (${count + 1})`;
    return name;
  });
  if (headers.length === 0) {
    throw new Error('This file has no header row.');
  }

  const rows = data.slice(1).map((r) => {
    const padded: string[] = [];
    for (let i = 0; i < headers.length; i++) padded.push(r[i] === undefined ? '' : String(r[i]));
    return padded;
  });
  if (rows.length === 0) {
    throw new Error('This file has a header but no data rows.');
  }

  const delimiter = result.meta?.delimiter ?? ',';
  return {
    fileName: file.name,
    headers,
    rows,
    delimiter,
    delimiterLabel: delimiterLabel(delimiter),
    rowCount: rows.length,
  };
}

/** Normalized form of a CSV header/alias for auto-suggest: lowercase, no
 * punctuation, single spaces. */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

export type SuggestSource = 'saved' | 'exact' | 'close' | 'none';

export interface MappingSuggestion {
  header: string;
  /** Import field key, or null = ignore. */
  fieldKey: string | null;
  source: SuggestSource;
}

/**
 * Auto-suggest a mapping for every CSV column, in the order the plan
 * specifies: (1) the user's saved mapping, (2) exact normalized label/alias
 * match, (3) close match. Unmatched columns default to Ignore. A platform
 * field is suggested at most once — later duplicate matches demote to none.
 */
export function suggestMapping(
  headers: string[],
  savedMapping?: Record<string, string | null>,
): MappingSuggestion[] {
  const used = new Set<string>();

  // Saved mapping lookup by raw header first, then by normalized header.
  const savedByRaw = new Map<string, string | null>();
  const savedByNorm = new Map<string, string | null>();
  for (const [header, key] of Object.entries(savedMapping ?? {})) {
    savedByRaw.set(header, key);
    savedByNorm.set(normalizeHeader(header), key);
  }

  const exactNorm = new Map<string, string>();
  const aliasList: { field: ImportField; norm: string }[] = [];
  for (const field of IMPORT_FIELDS) {
    for (const alias of field.aliases) {
      const norm = normalizeHeader(alias);
      if (norm && !exactNorm.has(norm)) exactNorm.set(norm, field.key);
      aliasList.push({ field, norm });
    }
  }

  return headers.map((header) => {
    // 1. Saved mapping (same file → usually the exact same header).
    if (savedByRaw.has(header)) {
      const key = savedByRaw.get(header) ?? null;
      if (key !== null && used.has(key)) return { header, fieldKey: null, source: 'none' as const };
      if (key !== null) used.add(key);
      return { header, fieldKey: key, source: 'saved' as const };
    }
    const normHeader = normalizeHeader(header);
    if (normHeader && savedByNorm.has(normHeader)) {
      const key = savedByNorm.get(normHeader) ?? null;
      if (key !== null && used.has(key)) return { header, fieldKey: null, source: 'none' as const };
      if (key !== null) used.add(key);
      return { header, fieldKey: key, source: 'saved' as const };
    }

    // 2. Exact match on a normalized label/alias.
    const exact = normHeader ? exactNorm.get(normHeader) : undefined;
    if (exact && !used.has(exact)) {
      used.add(exact);
      return { header, fieldKey: exact, source: 'exact' as const };
    }

    // 3. Close match: containment either way, or small edit distance.
    let close: string | null = null;
    if (normHeader.length >= 4) {
      for (const { field, norm } of aliasList) {
        if (used.has(field.key) || !norm) continue;
        const contains =
          (normHeader.length >= 4 && norm.includes(normHeader)) ||
          (norm.length >= 4 && normHeader.includes(norm));
        const near = levenshtein(normHeader, norm) <= 2;
        if (contains || near) {
          close = field.key;
          break;
        }
      }
    }
    if (close && !used.has(close)) {
      used.add(close);
      return { header, fieldKey: close, source: 'close' as const };
    }

    return { header, fieldKey: null, source: 'none' as const };
  });
}

/**
 * Apply the chosen mapping client-side (plan §5 preferred): the server only
 * ever receives rows keyed by internal import field keys. Ignored columns and
 * null values are dropped.
 */
export function applyMapping(
  headers: string[],
  rows: string[][],
  mapping: Record<string, string | null>,
): Record<string, string>[] {
  const keys = headers.map((h) => mapping[h] ?? null);
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key) out[key] = row[i] ?? '';
    }
    return out;
  });
}

/** Up to `n` first non-blank sample values from one CSV column. */
export function columnSamples(
  rows: string[][],
  colIndex: number,
  n = 3,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const v = (row[colIndex] ?? '').trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= n) break;
  }
  return out;
}

/** How many rows have a blank cell in the column mapped to project_name.
 * Anything > 0 means this is a grid-style CSV (continuation rows). */
export function blankProjectNameCount(
  headers: string[],
  rows: string[][],
  mapping: Record<string, string | null>,
): number {
  const col = headers.findIndex((h) => mapping[h] === 'project_name');
  if (col < 0) return 0;
  let count = 0;
  for (const row of rows) {
    if (!(row[col] ?? '').trim()) count++;
  }
  return count;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Template built from the registry: header row = labels, one example row from
 * each field's `example`. UTF-8 BOM so Excel opens it correctly.
 */
export function buildTemplateCsv(): string {
  const headers = IMPORT_FIELDS.map((f) => csvCell(f.label)).join(',');
  const examples = IMPORT_FIELDS.map((f) => csvCell(exampleFor(f))).join(',');
  return `\uFEFF${headers}\r\n${examples}\r\n`;
}

function exampleFor(field: ImportField): string {
  if (field.example !== undefined) return field.example;
  if (field.enumValues && field.enumValues.length > 0) return field.enumValues[0];
  return '';
}

export function downloadTemplateCsv(): void {
  const blob = new Blob([buildTemplateCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'project-import-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
