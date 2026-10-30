import { describe, expect, it } from 'vitest';
import { suggestMapping } from './csvImport';

// The CSV export appends four info-only columns after the import fields.
// They must stay unmapped when the file is fed back into the Import wizard:
// `Action` in particular holds free-form issue text, and the importer caps a
// cell at 1000 characters, so a mapped Action could reject an otherwise fine
// re-import. Headers are duplicated here on purpose — csvImport is browser code
// and the server module owns the real list.
const INFO_HEADERS = ['Aging (days)', 'Priority', 'Update Progress', 'Action'];

describe('suggestMapping on exported CSV headers', () => {
  it('leaves the info-only export columns unmapped', () => {
    const mapping = suggestMapping(INFO_HEADERS);
    expect(mapping.map((m) => m.fieldKey)).toEqual([null, null, null, null]);
    expect(mapping.every((m) => m.source === 'none')).toBe(true);
  });

  it('still maps the import fields that precede them', () => {
    const mapping = suggestMapping(['Project Name', 'Customer', 'Vendor', ...INFO_HEADERS]);
    expect(mapping.map((m) => m.fieldKey)).toEqual([
      'project_name',
      'customer_name',
      'vendor_name',
      null,
      null,
      null,
      null,
    ]);
  });
});
