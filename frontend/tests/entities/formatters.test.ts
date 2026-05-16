import { describe, expect, it } from 'vitest';
import type { MetaField } from '../../src/types';
import {
  buildMetaFieldMap,
  formatCellValue,
} from '../../src/entities/formatters';

describe('formatCellValue', () => {
  it('returns em dash for null', () => {
    expect(formatCellValue(null)).toBe('\u2014');
  });

  it('returns em dash for undefined', () => {
    expect(formatCellValue(undefined)).toBe('\u2014');
  });

  it('formats boolean true as Yes', () => {
    expect(formatCellValue(true)).toBe('Yes');
  });

  it('formats boolean false as No', () => {
    expect(formatCellValue(false)).toBe('No');
  });

  it('formats datetime string with field metadata', () => {
    const mf = { field_type: 'datetime' } as MetaField;
    const result = formatCellValue('2026-01-15T10:30:00Z', mf);
    expect(result).toContain('2026');
    expect(result).not.toBe('2026-01-15T10:30:00Z');
  });

  it('formats date string with field metadata', () => {
    const mf = { field_type: 'date' } as MetaField;
    const result = formatCellValue('2026-01-15', mf);
    expect(result).toContain('2026');
  });

  it('returns raw string for invalid date', () => {
    const mf = { field_type: 'datetime' } as MetaField;
    expect(formatCellValue('not-a-date', mf)).toBe('not-a-date');
  });

  it('stringifies objects', () => {
    expect(formatCellValue({ foo: 'bar' })).toBe('{"foo":"bar"}');
  });

  it('converts numbers to string', () => {
    expect(formatCellValue(42)).toBe('42');
  });

  it('passes through plain strings', () => {
    expect(formatCellValue('hello')).toBe('hello');
  });
});

describe('buildMetaFieldMap', () => {
  it('builds a map keyed by field key', () => {
    const fields = [
      { key: 'id', label: 'Id' } as MetaField,
      { key: 'name', label: 'Name' } as MetaField,
    ];
    const map = buildMetaFieldMap(fields);
    expect(map.size).toBe(2);
    expect(map.get('name')?.label).toBe('Name');
  });
});
