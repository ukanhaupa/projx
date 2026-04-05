import type { MetaField } from '../types';

export function formatCellValue(value: unknown, metaField?: MetaField): string {
  if (value === null || value === undefined) return '\u2014';

  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  const fieldType = metaField?.field_type;

  if (fieldType === 'datetime' && typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }

  if (fieldType === 'date' && typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
  }

  if (typeof value === 'object') return JSON.stringify(value);

  return String(value);
}

export function buildMetaFieldMap(
  metaFields: MetaField[],
): Map<string, MetaField> {
  const map = new Map<string, MetaField>();
  for (const f of metaFields) {
    map.set(f.key, f);
  }
  return map;
}
