import { describe, expect, it } from 'vitest';
import { createMockMetaEntity } from './testing/entity-test-utils';
import { metaToEntityConfig } from '../src/types';

describe('metaToEntityConfig', () => {
  it('converts a MetaEntity to EntityConfig', () => {
    const meta = createMockMetaEntity();
    const config = metaToEntityConfig(meta);
    expect(config.name).toBe('Test Entity');
    expect(config.slug).toBe('test-entities');
    expect(config.apiPrefix).toBe('/test-entities');
  });

  it('creates columns for all fields', () => {
    const meta = createMockMetaEntity();
    const config = metaToEntityConfig(meta);
    expect(config.columns).toHaveLength(3);
    expect(config.columns[0].key).toBe('id');
    expect(config.columns[1].key).toBe('name');
  });

  it('excludes auto and PK fields from form fields', () => {
    const meta = createMockMetaEntity();
    const config = metaToEntityConfig(meta);
    expect(config.fields).toHaveLength(1);
    expect(config.fields![0].key).toBe('name');
  });

  it('sets fields to undefined for readonly entities', () => {
    const meta = createMockMetaEntity({ readonly: true });
    const config = metaToEntityConfig(meta);
    expect(config.fields).toBeUndefined();
  });

  it('sets sortable on all columns', () => {
    const meta = createMockMetaEntity();
    const config = metaToEntityConfig(meta);
    expect(config.columns.every((c) => c.sortable)).toBe(true);
  });

  it('detects FK fields for expandFields', () => {
    const meta = createMockMetaEntity({
      fields: [
        ...createMockMetaEntity().fields,
        {
          key: 'author_id',
          label: 'Author Id',
          type: 'int',
          nullable: false,
          is_auto: false,
          is_primary_key: false,
          filterable: true,
          has_foreign_key: true,
          field_type: 'text',
        },
      ],
    });
    const config = metaToEntityConfig(meta);
    expect(config.expandFields).toEqual(['author']);
  });

  it('preserves bulkOperations and softDelete', () => {
    const meta = createMockMetaEntity({
      bulk_operations: true,
      soft_delete: true,
    });
    const config = metaToEntityConfig(meta);
    expect(config.bulkOperations).toBe(true);
    expect(config.softDelete).toBe(true);
  });

  it('maps field_type and options', () => {
    const meta = createMockMetaEntity({
      fields: [
        ...createMockMetaEntity().fields,
        {
          key: 'status',
          label: 'Status',
          type: 'str',
          nullable: false,
          is_auto: false,
          is_primary_key: false,
          filterable: true,
          has_foreign_key: false,
          field_type: 'select',
          options: ['active', 'inactive'],
        },
      ],
    });
    const config = metaToEntityConfig(meta);
    const statusField = config.fields!.find((f) => f.key === 'status');
    expect(statusField?.type).toBe('select');
    expect(statusField?.options).toEqual(['active', 'inactive']);
  });
});
