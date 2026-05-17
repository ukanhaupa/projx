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
          columnNames: [
            'id',
            'name',
            'description',
            'created_at',
            'updated_at',
          ],
          searchableFields: ['name', 'description'],
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
        {
          name: 'Item',
          tableName: 'internal_items',
          reason: 'skipAutoRoutes=true',
        },
      ]);
    });
  });
});
