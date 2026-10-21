// Regression guard for the BIGINT money columns (customer_price,
// vendor_revenue, vendor_price). The DuckDB node driver returns every BIGINT
// column as a JS BigInt — even small values — and JSON.stringify throws
// "Do not know how to serialize a BigInt" on it, which would crash every
// project/vendor API response. `normalizeBigInt` runs at the single read choke
// point (connection.execute) to convert them to Numbers, which is lossless
// because every BIGINT in this schema is within Number.MAX_SAFE_INTEGER.
import { describe, expect, it } from 'vitest';
import { normalizeBigInt } from './normalize.js';

describe('normalizeBigInt', () => {
  it('converts a BigInt cell to a Number', () => {
    expect(normalizeBigInt(7_255_000_000n)).toBe(7_255_000_000);
    expect(typeof normalizeBigInt(1n)).toBe('number');
  });

  it('leaves non-BigInt scalars untouched', () => {
    expect(normalizeBigInt(42)).toBe(42);
    expect(normalizeBigInt('text')).toBe('text');
    expect(normalizeBigInt(true)).toBe(true);
    expect(normalizeBigInt(null)).toBeNull();
    expect(normalizeBigInt(undefined)).toBeUndefined();
  });

  it('converts nested BigInts inside a result row and mutates it in place', () => {
    const row = {
      id: 'p1',
      customer_price: 7_255_000_000n,
      line_count: 2n,
      vendor: { vendor_price: 950_000_000n, vendor_name: 'PT Maju' },
    };
    const out = normalizeBigInt(row);
    expect(out.customer_price).toBe(7_255_000_000);
    expect(out.line_count).toBe(2);
    expect(out.vendor.vendor_price).toBe(950_000_000);
    expect(out.vendor.vendor_name).toBe('PT Maju');
  });

  it('preserves Date values (never recurses into them)', () => {
    const d = new Date('2026-06-09T00:00:00.000Z');
    expect(normalizeBigInt({ created_at: d }).created_at).toBe(d);
  });

  it('makes a row carrying BIGINT values JSON-serializable', () => {
    const row = { project_name: 'Big', customer_price: 7_255_000_000n };
    expect(() => JSON.stringify(row)).toThrow();
    expect(JSON.stringify(normalizeBigInt(row))).toBe(
      '{"project_name":"Big","customer_price":7255000000}',
    );
  });
});
