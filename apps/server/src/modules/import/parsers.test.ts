import { IMPORT_FIELDS, type ImportField, type ImportDateFormat } from '@tracker/shared';
import { describe, expect, it } from 'vitest';
import { isBlankCell, parseCell, parseDateCell, parseEnumCell, parseNumberCell } from './parsers.js';

const field = (key: string): ImportField => {
  const f = IMPORT_FIELDS.find((x) => x.key === key);
  if (!f) throw new Error(`missing registry field ${key}`);
  return f;
};

describe('isBlankCell', () => {
  it('treats empty, whitespace and dashes as blank', () => {
    for (const raw of ['', '   ', '-', '\u2013', '\u2014', ' - ']) {
      expect(isBlankCell(raw), JSON.stringify(raw)).toBe(true);
    }
    expect(isBlankCell('x')).toBe(false);
  });
});

describe('parseDateCell', () => {
  const cases: { raw: string; format: ImportDateFormat; expected: string | null | 'error' }[] = [
    { raw: '', format: 'DD/MM/YYYY', expected: null },
    { raw: ' - ', format: 'DD/MM/YYYY', expected: null },
    // chosen format
    { raw: '01/08/2026', format: 'DD/MM/YYYY', expected: '2026-08-01' },
    { raw: '01/08/2026', format: 'MM/DD/YYYY', expected: '2026-01-08' },
    { raw: '1-8-2026', format: 'DD/MM/YYYY', expected: '2026-08-01' },
    { raw: '1.8.2026', format: 'DD/MM/YYYY', expected: '2026-08-01' },
    // always accepted regardless of chosen format
    { raw: '2026-08-01', format: 'DD/MM/YYYY', expected: '2026-08-01' },
    { raw: '2026-08-01', format: 'MM/DD/YYYY', expected: '2026-08-01' },
    { raw: '2026-08-01T14:30:00', format: 'DD/MM/YYYY', expected: '2026-08-01' },
    { raw: '2026-08-01 14:30', format: 'DD/MM/YYYY', expected: '2026-08-01' },
    { raw: '15 September 2026', format: 'DD/MM/YYYY', expected: '2026-09-15' },
    { raw: '15 September 2026', format: 'D Month YYYY', expected: '2026-09-15' },
    { raw: '1 Mei 2026', format: 'DD/MM/YYYY', expected: '2026-05-01' },
    { raw: '31 Desember 2026', format: 'DD/MM/YYYY', expected: '2026-12-31' },
    { raw: '3 sep 2026', format: 'DD/MM/YYYY', expected: '2026-09-03' },
    // month names with dash/dot separators and 2-digit years ("9-Jun-26")
    { raw: '9-Jun-26', format: 'D-Mon-YY', expected: '2026-06-09' },
    { raw: '9-Jun-26', format: 'DD/MM/YYYY', expected: '2026-06-09' },
    { raw: '9-Jun-2026', format: 'DD/MM/YYYY', expected: '2026-06-09' },
    { raw: '9.Jun.2026', format: 'DD/MM/YYYY', expected: '2026-06-09' },
    { raw: '9-juni-26', format: 'DD/MM/YYYY', expected: '2026-06-09' },
    { raw: '21-Aug-26', format: 'DD/MM/YYYY', expected: '2026-08-21' },
    { raw: '24-Aug-26', format: 'D-Mon-YY', expected: '2026-08-24' },
    { raw: '21-Oct-26', format: 'DD/MM/YYYY', expected: '2026-10-21' },
    { raw: '31-Des-26', format: 'D-Mon-YY', expected: '2026-12-31' },
    { raw: '1-Jan-99', format: 'D-Mon-YY', expected: '1999-01-01' },
    { raw: '29-Feb-24', format: 'D-Mon-YY', expected: '2024-02-29' },
    { raw: '31-Feb-26', format: 'D-Mon-YY', expected: 'error' },
    // leap years and impossible dates
    { raw: '29/02/2024', format: 'DD/MM/YYYY', expected: '2024-02-29' },
    { raw: '29/02/2025', format: 'DD/MM/YYYY', expected: 'error' },
    { raw: '31/02/2026', format: 'DD/MM/YYYY', expected: 'error' },
    { raw: '31/04/2026', format: 'DD/MM/YYYY', expected: 'error' },
    { raw: '00/08/2026', format: 'DD/MM/YYYY', expected: 'error' },
    { raw: '13/08/2026', format: 'MM/DD/YYYY', expected: 'error' },
    { raw: 'not a date', format: 'DD/MM/YYYY', expected: 'error' },
    { raw: '2026/08/01', format: 'YYYY-MM-DD', expected: 'error' },
  ];

  for (const c of cases) {
    it(`parses ${JSON.stringify(c.raw)} as ${c.format} -> ${String(c.expected)}`, () => {
      const r = parseDateCell(c.raw, c.format);
      if (c.expected === 'error') {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('invalid_date');
      } else if (c.expected === null) {
        expect(r).toEqual({ ok: true, value: null });
      } else {
        expect(r).toEqual({ ok: true, value: c.expected });
      }
    });
  }
});

describe('parseNumberCell', () => {
  it('treats blanks as null', () => {
    for (const raw of ['', '  ', '-', '\u2014']) {
      expect(parseNumberCell(raw)).toEqual({ ok: true, value: null });
    }
  });

  it('strips thousands separators in both conventions', () => {
    expect(parseNumberCell('1234567')).toEqual({ ok: true, value: 1234567 });
    expect(parseNumberCell('1.234.567')).toEqual({ ok: true, value: 1234567 });
    expect(parseNumberCell('1,234,567')).toEqual({ ok: true, value: 1234567 });
    expect(parseNumberCell('Rp 1,234,567')).toEqual({ ok: true, value: 1234567 });
    expect(parseNumberCell('Rp1.234.567')).toEqual({ ok: true, value: 1234567 });
    expect(parseNumberCell('1 234 567')).toEqual({ ok: true, value: 1234567 });
    expect(parseNumberCell('1,234')).toEqual({ ok: true, value: 1234 });
  });

  it('rounds decimals with a warning', () => {
    expect(parseNumberCell('12,5')).toEqual({ ok: true, value: 13, warning: 'decimal_rounded' });
    expect(parseNumberCell('.5')).toEqual({ ok: true, value: 1, warning: 'decimal_rounded' });
    expect(parseNumberCell('1.234,567')).toEqual({ ok: true, value: 1235, warning: 'decimal_rounded' });
    expect(parseNumberCell('1,234.567')).toEqual({ ok: true, value: 1235, warning: 'decimal_rounded' });
  });

  it('accepts large Rupiah values well past the old INTEGER ceiling', () => {
    expect(parseNumberCell('7255000000')).toEqual({ ok: true, value: 7255000000 });
    expect(parseNumberCell('Rp7,255,000,000')).toEqual({ ok: true, value: 7255000000 });
    expect(parseNumberCell(String(Number.MAX_SAFE_INTEGER))).toEqual({
      ok: true,
      value: Number.MAX_SAFE_INTEGER,
    });
  });

  it('rejects values above the safe-integer limit', () => {
    for (const raw of ['9007199254740992', '99999999999999999999']) {
      const r = parseNumberCell(raw);
      expect(r.ok, raw).toBe(false);
      if (!r.ok) expect(r.code).toBe('number_too_large');
    }
  });

  it('rejects non-numeric junk', () => {
    for (const raw of ['abc', 'Rp', '12abc', '1,2,3,4,5.6.7.8x']) {
      const r = parseNumberCell(raw);
      expect(r.ok, raw).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid_number');
    }
  });

  it('keeps negatives', () => {
    expect(parseNumberCell('-5000')).toEqual({ ok: true, value: -5000 });
  });
});

describe('parseEnumCell', () => {
  const stageValues = ['on_progress', 'finish'];
  const stageLabels = ['On Progress', 'Finish'];

  it('accepts internal values and labels case-insensitively', () => {
    expect(parseEnumCell('on_progress', stageValues, stageLabels)).toEqual({
      ok: true,
      value: 'on_progress',
    });
    expect(parseEnumCell('On Progress', stageValues, stageLabels)).toEqual({
      ok: true,
      value: 'on_progress',
    });
    expect(parseEnumCell('  ON PROGRESS ', stageValues, stageLabels)).toEqual({
      ok: true,
      value: 'on_progress',
    });
    expect(parseEnumCell('Finish', stageValues, stageLabels)).toEqual({ ok: true, value: 'finish' });
  });

  it('treats blanks as null', () => {
    expect(parseEnumCell('', stageValues, stageLabels)).toEqual({ ok: true, value: null });
    expect(parseEnumCell('-', stageValues, stageLabels)).toEqual({ ok: true, value: null });
  });

  it('rejects unknown values and lists the allowed labels', () => {
    const r = parseEnumCell('running', stageValues, stageLabels);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid_enum');
      expect(r.allowed).toEqual(stageLabels);
      expect(r.raw).toBe('running');
    }
  });
});

describe('parseCell dispatcher', () => {
  const opts = { dateFormat: 'DD/MM/YYYY' as const };

  it('parses each field by its registry type', () => {
    expect(parseCell('  Name  ', field('project_name'), opts)).toEqual({ ok: true, value: 'Name' });
    expect(parseCell('', field('project_name'), opts)).toEqual({ ok: true, value: null });
    expect(parseCell('01/08/2026', field('project_sent_date'), opts)).toEqual({
      ok: true,
      value: '2026-08-01',
    });
    expect(parseCell('1.000.000', field('vendor_revenue'), opts)).toEqual({
      ok: true,
      value: 1000000,
    });
    expect(parseCell('service', field('vendor_type'), opts)).toEqual({ ok: true, value: 'service' });
    expect(parseCell('Goods', field('service_or_goods'), opts)).toEqual({ ok: true, value: 'goods' });
    expect(parseCell('On Progress', field('current_stage'), opts)).toEqual({
      ok: true,
      value: 'on_progress',
    });
    // lookups stay raw text here — the DB resolves them in importService
    expect(parseCell('PT Maju', field('vendor_name'), opts)).toEqual({ ok: true, value: 'PT Maju' });
  });

  it('honours the chosen date format through the dispatcher', () => {
    expect(parseCell('01/08/2026', field('project_sent_date'), { dateFormat: 'MM/DD/YYYY' })).toEqual({
      ok: true,
      value: '2026-01-08',
    });
  });
});
