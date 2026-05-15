import { describe, it, expect, afterEach } from 'vitest';
import { EntityRegistry } from '../../src/modules/_base/entity-registry.js';
import { Type } from '@sinclair/typebox';

const dummySchema = Type.Object({ id: Type.String() });

describe('Entity Registration Validation', () => {
  describe('softDelete requires deleted_at column', () => {
    it('throws when softDelete is true but deleted_at is not in columnNames', () => {
      expect(() =>
        EntityRegistry.register({
          name: 'TestEntity',
          tableName: 'test_entities',
          prismaModel: 'TestEntity',
          apiPrefix: '/test-entities',
          tags: ['test'],
          readonly: false,
          softDelete: true,
          bulkOperations: false,
          columnNames: ['id', 'name', 'created_at', 'updated_at'],
          searchableFields: [],
          fields: [],
          schema: dummySchema,
          createSchema: dummySchema,
          updateSchema: dummySchema,
        }),
      ).toThrow('deleted_at');
    });

    it('accepts softDelete when deleted_at is in columnNames', () => {
      expect(() =>
        EntityRegistry.register({
          name: 'SoftEntity',
          tableName: 'soft_entities',
          prismaModel: 'SoftEntity',
          apiPrefix: '/soft-entities',
          tags: ['test'],
          readonly: false,
          softDelete: true,
          bulkOperations: false,
          columnNames: ['id', 'name', 'deleted_at', 'created_at', 'updated_at'],
          searchableFields: [],
          fields: [],
          schema: dummySchema,
          createSchema: dummySchema,
          updateSchema: dummySchema,
        }),
      ).not.toThrow();
      EntityRegistry.reset();
    });
  });

  describe('searchableFields must exist in columnNames', () => {
    it('throws when a searchableField is not in columnNames', () => {
      expect(() =>
        EntityRegistry.register({
          name: 'BadSearch',
          tableName: 'bad_search',
          prismaModel: 'BadSearch',
          apiPrefix: '/bad-search',
          tags: ['test'],
          readonly: false,
          softDelete: false,
          bulkOperations: false,
          columnNames: ['id', 'name', 'created_at', 'updated_at'],
          searchableFields: ['name', 'typo_field'],
          fields: [],
          schema: dummySchema,
          createSchema: dummySchema,
          updateSchema: dummySchema,
        }),
      ).toThrow('typo_field');
    });

    it('accepts when all searchableFields exist in columnNames', () => {
      expect(() =>
        EntityRegistry.register({
          name: 'GoodSearch',
          tableName: 'good_search',
          prismaModel: 'GoodSearch',
          apiPrefix: '/good-search',
          tags: ['test'],
          readonly: false,
          softDelete: false,
          bulkOperations: false,
          columnNames: ['id', 'name', 'description', 'created_at', 'updated_at'],
          searchableFields: ['name', 'description'],
          fields: [],
          schema: dummySchema,
          createSchema: dummySchema,
          updateSchema: dummySchema,
        }),
      ).not.toThrow();
      EntityRegistry.reset();
    });
  });

  describe('EntityRegistry API', () => {
    afterEach(() => {
      EntityRegistry.reset();
    });

    const validEntity = {
      name: 'Item',
      tableName: 'items',
      prismaModel: 'Item',
      apiPrefix: '/items',
      tags: ['items'],
      readonly: false,
      softDelete: false,
      bulkOperations: true,
      columnNames: ['id', 'name', 'created_at', 'updated_at'],
      searchableFields: ['name'],
      fields: [
        {
          key: 'name',
          label: 'Name',
          type: 'str',
          nullable: false,
          is_auto: false,
          is_primary_key: false,
          filterable: true,
          has_foreign_key: false,
          field_type: 'text',
        },
      ],
      schema: dummySchema,
      createSchema: dummySchema,
      updateSchema: dummySchema,
    };

    it('getAll returns all registered entities', () => {
      EntityRegistry.register(validEntity);
      const all = EntityRegistry.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('Item');
    });

    it('get returns entity by tableName', () => {
      EntityRegistry.register(validEntity);
      const entity = EntityRegistry.get('items');
      expect(entity).toBeDefined();
      expect(entity!.name).toBe('Item');
    });

    it('get returns undefined for unknown tableName', () => {
      expect(EntityRegistry.get('nonexistent')).toBeUndefined();
    });

    it('reset clears all entities', () => {
      EntityRegistry.register(validEntity);
      expect(EntityRegistry.getAll()).toHaveLength(1);
      EntityRegistry.reset();
      expect(EntityRegistry.getAll()).toHaveLength(0);
    });

    it('getMeta returns entity metadata', () => {
      EntityRegistry.register(validEntity);
      const meta = EntityRegistry.getMeta();
      expect(meta.entities).toHaveLength(1);
      expect(meta.entities[0].name).toBe('Item');
      expect(meta.entities[0].table_name).toBe('items');
      expect(meta.entities[0].api_prefix).toBe('/items');
      expect(meta.entities[0].tags).toEqual(['items']);
      expect(meta.entities[0].readonly).toBe(false);
      expect(meta.entities[0].soft_delete).toBe(false);
      expect(meta.entities[0].bulk_operations).toBe(true);
      expect(meta.entities[0].fields).toHaveLength(1);
    });

    it('getMeta: readonly entity reports bulk_operations as false', () => {
      EntityRegistry.register({
        ...validEntity,
        tableName: 'readonly_items',
        readonly: true,
        bulkOperations: true,
      });
      const meta = EntityRegistry.getMeta();
      expect(meta.entities[0].bulk_operations).toBe(false);
    });

    it('derives columnNames from Prisma DMMF when omitted', () => {
      EntityRegistry.register({
        ...validEntity,
        name: 'ServiceConfig',
        tableName: 'service_configs',
        prismaModel: 'ServiceConfig',
        apiPrefix: '/service-configs',
        searchableFields: ['purpose'],
        schema: Type.Object({
          id: Type.String(),
          purpose: Type.String(),
          config: Type.String(),
          is_active: Type.Boolean(),
          created_at: Type.String(),
          updated_at: Type.String(),
        }),
        createSchema: Type.Object({
          purpose: Type.String(),
          config: Type.String(),
        }),
        updateSchema: Type.Object({}),
        columnNames: undefined,
      });

      expect(EntityRegistry.get('service_configs')?.columnNames).toEqual([
        'id',
        'purpose',
        'config',
        'is_active',
        'created_at',
        'updated_at',
      ]);
    });

    it('derives field metadata from Prisma DMMF and applies overrides', () => {
      EntityRegistry.register({
        ...validEntity,
        name: 'ServiceConfig',
        tableName: 'service_configs',
        prismaModel: 'ServiceConfig',
        apiPrefix: '/service-configs',
        searchableFields: ['purpose'],
        schema: Type.Object({
          id: Type.String(),
          purpose: Type.String(),
          config: Type.String(),
          is_active: Type.Boolean(),
          created_at: Type.String(),
          updated_at: Type.String(),
        }),
        createSchema: Type.Object({
          purpose: Type.String(),
          config: Type.String(),
        }),
        updateSchema: Type.Object({}),
        fields: undefined,
        fieldOverrides: {
          config: { label: 'Encrypted Config', field_type: 'textarea', filterable: false },
        },
      });

      const fields = EntityRegistry.get('service_configs')?.fields ?? [];
      expect(fields.map((field) => field.key)).toEqual([
        'id',
        'purpose',
        'config',
        'is_active',
        'created_at',
        'updated_at',
      ]);
      expect(fields.find((field) => field.key === 'id')?.is_primary_key).toBe(true);
      expect(fields.find((field) => field.key === 'is_active')?.type).toBe('bool');
      expect(fields.find((field) => field.key === 'config')?.label).toBe('Encrypted Config');
      expect(fields.find((field) => field.key === 'config')?.filterable).toBe(false);
    });

    it('fails loud when a required Prisma field is neither accepted nor filled before create', () => {
      expect(() =>
        EntityRegistry.register({
          ...validEntity,
          name: 'ServiceConfig',
          tableName: 'service_configs',
          prismaModel: 'ServiceConfig',
          apiPrefix: '/service-configs',
          searchableFields: ['purpose'],
          schema: Type.Object({
            id: Type.String(),
            purpose: Type.String(),
            config: Type.String(),
            is_active: Type.Boolean(),
            created_at: Type.String(),
            updated_at: Type.String(),
          }),
          createSchema: Type.Object({
            config: Type.String(),
          }),
          updateSchema: Type.Object({}),
        }),
      ).toThrow('purpose');
    });

    it('records skipped auto-route entities instead of silently dropping them', () => {
      EntityRegistry.register({
        ...validEntity,
        tableName: 'hidden_items',
        private: true,
      });
      EntityRegistry.register({
        ...validEntity,
        tableName: 'internal_items',
        skipAutoRoutes: true,
      });

      expect(EntityRegistry.getAll()).toHaveLength(0);
      expect(EntityRegistry.getSkipped()).toEqual([
        { name: 'Item', tableName: 'hidden_items', reason: 'private=true' },
        { name: 'Item', tableName: 'internal_items', reason: 'skipAutoRoutes=true' },
      ]);
    });
  });
});
