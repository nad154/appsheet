import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPORT_DATE_FORMAT,
  IMPORT_DATE_FORMATS,
  IMPORT_FIELDS,
  IMPORT_FIELD_BY_KEY,
  IMPORT_FIELD_KEYS,
  IMPORT_FIELD_SECTIONS,
  IMPORT_MAX_INTEGER,
  importFieldLabel,
  importFieldsBySection,
} from './importFields.js';

describe('IMPORT_FIELDS registry', () => {
  it('has unique, snake_case keys and a matching key set/map', () => {
    const keys = IMPORT_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(IMPORT_FIELD_KEYS.size).toBe(IMPORT_FIELDS.length);
    expect(IMPORT_FIELD_BY_KEY.size).toBe(IMPORT_FIELDS.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('gives every field a label, description, section, aliases and example', () => {
    for (const f of IMPORT_FIELDS) {
      expect(f.label.length, f.key).toBeGreaterThan(0);
      expect(f.description.length, f.key).toBeGreaterThan(0);
      expect(IMPORT_FIELD_SECTIONS).toContain(f.section);
      expect(f.aliases.length, f.key).toBeGreaterThan(0);
      expect(f.aliases, f.key).toContain(f.key);
      expect(f.example, f.key).toBeTruthy();
    }
  });

  it('requires exactly project_name', () => {
    const required = IMPORT_FIELDS.filter((f) => f.required).map((f) => f.key);
    expect(required).toEqual(['project_name']);
  });

  it('marks vendor-line section fields as vendor level, the rest as project level', () => {
    for (const f of IMPORT_FIELDS) {
      expect(f.level, f.key).toBe(f.section === 'Vendor line' ? 'vendor' : 'project');
    }
  });

  it('pairs enumValues with enumInternals of the same length', () => {
    for (const f of IMPORT_FIELDS) {
      if (f.type === 'enum') {
        expect(f.enumValues, f.key).toBeTruthy();
        expect(f.enumInternals?.length, f.key).toBe(f.enumValues?.length);
      }
    }
  });

  it('keeps labels unique within each section (dropdown option identity)', () => {
    for (const { section, fields } of importFieldsBySection()) {
      const labels = fields.map((f) => f.label);
      expect(new Set(labels).size, section).toBe(labels.length);
    }
  });

  it('exposes labels through importFieldLabel, falling back to the key', () => {
    expect(importFieldLabel('project_sent_date')).toBe('FPT Sent Date');
    expect(importFieldLabel('no_such_key')).toBe('no_such_key');
  });

  it('orders sections for the dropdown groups', () => {
    const groups = importFieldsBySection();
    expect(groups.map((g) => g.section)).toEqual(['Project info', 'Customer', 'Vendor line']);
    expect(groups.every((g) => g.fields.length > 0)).toBe(true);
  });
});

describe('import constants', () => {
  it('defaults the date format to DD/MM/YYYY', () => {
    expect(IMPORT_DATE_FORMATS).toContain(DEFAULT_IMPORT_DATE_FORMAT);
    expect(DEFAULT_IMPORT_DATE_FORMAT).toBe('DD/MM/YYYY');
  });

  it('caps numbers at the JS safe-integer limit', () => {
    expect(IMPORT_MAX_INTEGER).toBe(Number.MAX_SAFE_INTEGER);
  });
});
