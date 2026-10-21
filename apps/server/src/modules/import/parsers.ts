// Pure cell parsers for CSV import (plan §6 "Cell parsing rules"). No I/O and
// no DB access — unit-tested in parsers.test.ts. Error codes are returned, not
// messages: importService formats them with the registry's human labels so
// error text never leaks internal keys.

import {
  IMPORT_MAX_INTEGER,
  type ImportField,
  type ImportDateFormat,
} from '@tracker/shared';

export type CellParseResult =
  | { ok: true; value: string | number | null; warning?: 'decimal_rounded' }
  | {
      ok: false;
      code: 'invalid_date' | 'invalid_number' | 'number_too_large' | 'invalid_enum';
      /** Raw cell content, echoed so the service can quote it in the message. */
      raw: string;
      /** Allowed values for enum errors (user-visible labels). */
      allowed?: readonly string[];
    };

const BLANK_CELLS = new Set(['', '-', '\u2013', '\u2014']); // '-', en/em dash

/** Blank / whitespace / '-' / '—' all mean "no value". */
export function isBlankCell(raw: string): boolean {
  const t = raw.trim();
  return BLANK_CELLS.has(t);
}

// --- Dates ------------------------------------------------------------------

// English names (the grid renders "15 September 2026" via en-GB) plus the
// Indonesian names, plus the handful of abbreviations that differ between the
// two. Keyed by the normalized (lowercased, unaccented) name.
const MONTH_BY_NAME: Record<string, number> = {
  january: 1, januari: 1, jan: 1,
  february: 2, februari: 2, feb: 2,
  march: 3, maret: 3, mar: 3,
  april: 4, apr: 4,
  may: 5, mei: 5,
  june: 6, juni: 6, jun: 6,
  july: 7, juli: 7, jul: 7,
  august: 8, agustus: 8, aug: 8, agu: 8, agt: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oktober: 10, oct: 10, okt: 10,
  november: 11, nov: 11,
  december: 12, desember: 12, dec: 12, des: 12,
};

function isRealDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= daysInMonth;
}

function toIsoDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Split a numeric date on / . or - and return [day, month, year] or [month, day, year]. */
function matchNumericDate(raw: string, format: ImportDateFormat): { y: number; m: number; d: number } | null {
  const sep = raw.includes('/') ? '/' : raw.includes('-') ? '-' : raw.includes('.') ? '.' : null;
  if (!sep) return null;
  const parts = raw.split(sep);
  if (parts.length !== 3) return null;
  if (!parts.every((p) => /^\d{1,4}$/.test(p))) return null;
  const [a, b, c] = parts.map(Number);
  if (c < 100 || a < 0 || b < 0) return null; // must have a 4-digit year in the last slot
  if (format === 'MM/DD/YYYY') return { m: a, d: b, y: c };
  return { d: a, m: b, y: c }; // DD/MM/YYYY and YYYY-MM-DD fallback (see ISO branch)
}

function matchIsoDate(raw: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})([T ].*)?$/.exec(raw);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/**
 * Expand a 2-digit year: 00-68 -> 2000-2068, 69-99 -> 1969-1999 (the JS Date
 * pivot), so "9-Jun-26" means 2026.
 */
function expandShortYear(y: number): number {
  if (y >= 100) return y;
  return y <= 68 ? 2000 + y : 1900 + y;
}

/**
 * Match a date written with a month name, either space-separated
 * ("15 September 2026") or dash/dot-separated ("9-Jun-26", "9.Jun.2026").
 * Accepts a 2- or 4-digit year; 2-digit years use expandShortYear.
 */
function matchMonthNameDate(raw: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{1,2})[\s./-]+([A-Za-z]+)[\s./-]+(\d{2}|\d{4})$/.exec(raw);
  if (!m) return null;
  const month = MONTH_BY_NAME[m[2].toLowerCase()];
  if (!month) return null;
  return { y: expandShortYear(Number(m[3])), m: month, d: Number(m[1]) };
}

/**
 * Parse a date cell. Blank -> null. Accepts the chosen format, plus always
 * YYYY-MM-DD, ISO timestamps (cut to the date part) and any month-name form
 * ("15 September 2026", "9-Jun-26", "9.Jun.2026"). Output is always
 * YYYY-MM-DD; impossible dates (31 Feb) are rejected.
 */
export function parseDateCell(raw: string, format: ImportDateFormat): CellParseResult {
  const t = raw.trim();
  if (isBlankCell(t)) return { ok: true, value: null };

  const hit = matchIsoDate(t) ?? matchMonthNameDate(t) ?? matchNumericDate(t, format);
  if (!hit || !isRealDate(hit.y, hit.m, hit.d)) {
    return { ok: false, code: 'invalid_date', raw: t };
  }
  return { ok: true, value: toIsoDate(hit.y, hit.m, hit.d) };
}

// --- Numbers ----------------------------------------------------------------

/**
 * Parse a whole-Rupiah amount. Blank -> null. Strips "Rp" and spaces, then
 * removes thousands separators (`.` or `,`). A decimal part at the end (",50",
 * ".5") is rounded and reported as a `decimal_rounded` warning since the
 * columns are whole numbers. Values above `IMPORT_MAX_INTEGER` fail with
 * `number_too_large`.
 */
export function parseNumberCell(raw: string): CellParseResult {
  const t = raw.trim();
  if (isBlankCell(t)) return { ok: true, value: null };

  let s = t.replace(/^(rp|idr)\s*/i, '').replace(/\s+/g, '');
  if (s === '') return { ok: false, code: 'invalid_number', raw: t };

  let warning: 'decimal_rounded' | undefined;
  let value: number;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const hasDot = lastDot !== -1;
  const hasComma = lastComma !== -1;

  if (!hasDot && !hasComma) {
    if (!/^-?\d+$/.test(s)) return { ok: false, code: 'invalid_number', raw: t };
    value = Number(s);
  } else {
    let decimalSep: string | null = null;
    let thousandsSep: string | null = null;

    if (hasDot && hasComma) {
      // Whichever separator appears last is the decimal separator.
      decimalSep = lastDot > lastComma ? '.' : ',';
      thousandsSep = decimalSep === '.' ? ',' : '.';
    } else {
      const sep = hasDot ? '.' : ',';
      const occurrences = s.split(sep).length - 1;
      const digitsAfter = s.slice(Math.max(lastDot, lastComma) + 1).length;
      if (occurrences > 1) {
        thousandsSep = sep;
      } else if (digitsAfter === 3) {
        // "1,234" / "1.234" — matches the grid's en-US amounts, so thousands.
        thousandsSep = sep;
      } else {
        decimalSep = sep;
      }
    }

    let normalized = s;
    if (thousandsSep) normalized = normalized.split(thousandsSep).join('');
    if (decimalSep) {
      // Only the decimal separator may remain; replace the first occurrence.
      const idx = normalized.lastIndexOf(decimalSep);
      normalized = normalized.slice(0, idx) + '.' + normalized.slice(idx + 1);
      warning = 'decimal_rounded';
    }
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(normalized)) return { ok: false, code: 'invalid_number', raw: t };
    value = Number(normalized);
    if (Number.isNaN(value)) return { ok: false, code: 'invalid_number', raw: t };
  }

  if (!Number.isSafeInteger(Math.round(value)) || Math.abs(value) > IMPORT_MAX_INTEGER) {
    return { ok: false, code: 'number_too_large', raw: t };
  }

  const rounded = Math.round(value);
  return warning ? { ok: true, value: rounded, warning } : { ok: true, value: rounded };
}

// --- Enums ------------------------------------------------------------------

/** Lowercase, trim, collapse spaces, strip punctuation/underscores. */
export function normalizeEnumToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Parse an enum cell case-insensitively. Accepts the internal value
 * ("on_progress") and the visible label ("On Progress") — normalization makes
 * both resolve to the same token. Unknown values fail with `invalid_enum` and
 * the allowed labels.
 */
export function parseEnumCell(
  raw: string,
  internalValues: readonly string[],
  labels: readonly string[],
): CellParseResult {
  const t = raw.trim();
  if (isBlankCell(t)) return { ok: true, value: null };

  const token = normalizeEnumToken(t);
  const byToken = new Map<string, string>();
  internalValues.forEach((v, i) => {
    byToken.set(normalizeEnumToken(v), v);
    const label = labels[i];
    if (label !== undefined) byToken.set(normalizeEnumToken(label), v);
  });
  const hit = byToken.get(token);
  if (hit === undefined) {
    return { ok: false, code: 'invalid_enum', raw: t, allowed: labels };
  }
  return { ok: true, value: hit };
}

// --- Dispatcher -------------------------------------------------------------

/**
 * Parse one cell for a registry field. Lookups (`customer_name`, user names,
 * …) resolve against the database in importService — here they are plain text.
 * Date parsing always additionally accepts YYYY-MM-DD, ISO and the long grid
 * format regardless of the chosen `dateFormat`.
 */
export function parseCell(
  raw: string,
  field: ImportField,
  opts: { dateFormat: ImportDateFormat },
): CellParseResult {
  switch (field.type) {
    case 'date':
      return parseDateCell(raw, opts.dateFormat);
    case 'number':
      return parseNumberCell(raw);
    case 'enum':
      return parseEnumCell(raw, field.enumInternals ?? [], field.enumValues ?? []);
    case 'text':
    case 'lookup': {
      const t = raw.trim();
      return { ok: true, value: t === '' ? null : t };
    }
    default:
      return { ok: true, value: null };
  }
}
