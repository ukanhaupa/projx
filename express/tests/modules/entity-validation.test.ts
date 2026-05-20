import { describe, it, expect, afterEach } from 'vitest';
import { z } from 'zod';
import {
  EntityRegistry,
  ensureEffectiveHiddenFields,
  type EntityConfig,
} from '../../src/modules/_base/entity-registry.js';

const dummySchema = z.object({ id: z.string() });

const baseConfig: EntityConfig = {
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

describe('softDelete requires deleted_at column', () => {
  afterEach(() => {
    EntityRegistry.reset();
  });

  it('throws when softDelete is true but deleted_at is not in columnNames', () => {
    expect(() =>
      EntityRegistry.register({
        ...baseConfig,
        name: 'BadSoft',
        tableName: 'bad_soft',
        prismaModel: 'BadSoft',
        softDelete: true,
      }),
    ).toThrow(/deleted_at/);
  });

  it('accepts softDelete when deleted_at is present in columnNames', () => {
    expect(() =>
      EntityRegistry.register({
        ...baseConfig,
        name: 'GoodSoft',
        tableName: 'good_soft',
        prismaModel: 'GoodSoft',
        softDelete: true,
        columnNames: [...baseConfig.columnNames!, 'deleted_at'],
      }),
    ).not.toThrow();
  });
});

describe('searchableFields must exist in columnNames', () => {
  afterEach(() => {
    EntityRegistry.reset();
  });

  it('throws when a searchable field is missing from columnNames', () => {
    expect(() =>
      EntityRegistry.register({
        ...baseConfig,
        name: 'BadSearch',
        tableName: 'bad_search',
        prismaModel: 'BadSearch',
        searchableFields: ['name', 'typo_field'],
      }),
    ).toThrow(/typo_field/);
  });

  it('accepts when every searchable field is in columnNames', () => {
    expect(() =>
      EntityRegistry.register({
        ...baseConfig,
        name: 'GoodSearch',
        tableName: 'good_search',
        prismaModel: 'GoodSearch',
        columnNames: [...baseConfig.columnNames!, 'description'],
        searchableFields: ['name', 'description'],
      }),
    ).not.toThrow();
  });
});

describe('EntityRegistry API', () => {
  afterEach(() => {
    EntityRegistry.reset();
  });

  it('getAll returns every registered entity', () => {
    EntityRegistry.register({ ...baseConfig, tableName: 'reg_items' });
    expect(EntityRegistry.getAll()).toHaveLength(1);
    expect(EntityRegistry.getAll()[0].name).toBe('Item');
  });

  it('get returns the entity by tableName', () => {
    EntityRegistry.register({ ...baseConfig, tableName: 'lookup_items' });
    const entity = EntityRegistry.get('lookup_items');
    expect(entity).toBeDefined();
    expect(entity!.name).toBe('Item');
  });

  it('get returns undefined for an unknown tableName', () => {
    expect(EntityRegistry.get('does-not-exist')).toBeUndefined();
  });

  it('reset clears every registered entity', () => {
    EntityRegistry.register({ ...baseConfig, tableName: 'reset_items' });
    expect(EntityRegistry.getAll()).toHaveLength(1);
    EntityRegistry.reset();
    expect(EntityRegistry.getAll()).toHaveLength(0);
  });

  it('derives columnNames from the Prisma DMMF when omitted', () => {
    EntityRegistry.register({
      ...baseConfig,
      name: 'AuditLog',
      tableName: 'audit_logs',
      prismaModel: 'AuditLog',
      apiPrefix: '/audit-logs',
      searchableFields: ['table_name'],
      schema: z.object({
        id: z.string(),
        table_name: z.string(),
        record_id: z.string(),
        action: z.string(),
        performed_by: z.string(),
      }),
      createSchema: z.object({
        table_name: z.string(),
        record_id: z.string(),
        action: z.string(),
        performed_by: z.string(),
      }),
      updateSchema: z.object({}),
      columnNames: undefined,
    });

    expect(EntityRegistry.get('audit_logs')?.columnNames).toEqual(
      expect.arrayContaining([
        'id',
        'table_name',
        'record_id',
        'action',
        'performed_by',
        'created_at',
        'updated_at',
      ]),
    );
  });

  it('fails when a required Prisma field is not in createSchema or beforeCreateFields', () => {
    expect(() =>
      EntityRegistry.register({
        ...baseConfig,
        name: 'AuditLog',
        tableName: 'audit_logs',
        prismaModel: 'AuditLog',
        apiPrefix: '/audit-logs',
        searchableFields: [],
        schema: z.object({ id: z.string() }),
        createSchema: z.object({ table_name: z.string() }),
        updateSchema: z.object({}),
      }),
    ).toThrow(/record_id|action|performed_by/);
  });

  it('accepts a required field when listed in beforeCreateFields', () => {
    expect(() =>
      EntityRegistry.register({
        ...baseConfig,
        name: 'AuditLog',
        tableName: 'audit_logs',
        prismaModel: 'AuditLog',
        apiPrefix: '/audit-logs',
        searchableFields: [],
        schema: z.object({ id: z.string() }),
        createSchema: z.object({}),
        updateSchema: z.object({}),
        beforeCreateFields: [
          'table_name',
          'record_id',
          'action',
          'performed_by',
        ],
      }),
    ).not.toThrow();
  });

  it('skips create-coverage checks on readonly entities', () => {
    expect(() =>
      EntityRegistry.register({
        ...baseConfig,
        name: 'AuditLogRO',
        tableName: 'audit_logs_ro',
        prismaModel: 'AuditLog',
        apiPrefix: '/audit-logs-ro',
        readonly: true,
        searchableFields: [],
        schema: z.object({ id: z.string() }),
        createSchema: z.object({}),
        updateSchema: z.object({}),
      }),
    ).not.toThrow();
  });

  it('records private entities as skipped instead of registering them', () => {
    EntityRegistry.register({
      ...baseConfig,
      tableName: 'hidden_items',
      private: true,
    });
    EntityRegistry.register({
      ...baseConfig,
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

  it('leaves the config alone when the Prisma model does not exist', () => {
    EntityRegistry.register({
      ...baseConfig,
      tableName: 'phantom_items',
      prismaModel: 'PhantomModel',
      searchableFields: [],
    });
    const entity = EntityRegistry.get('phantom_items');
    expect(entity?.columnNames).toEqual(baseConfig.columnNames);
  });
});

describe('ensureEffectiveHiddenFields', () => {
  it('merges built-in private columns with explicit hiddenFields', () => {
    const config: EntityConfig = {
      ...baseConfig,
      name: 'User',
      tableName: 'users_hidden',
      prismaModel: 'User',
      columnNames: ['id', 'email', 'password_hash', 'internal_note'],
      hiddenFields: ['internal_note'],
    };
    const hidden = ensureEffectiveHiddenFields(config);
    expect(hidden.has('password_hash')).toBe(true);
    expect(hidden.has('internal_note')).toBe(true);
  });

  it('returns the cached set on subsequent calls', () => {
    const config: EntityConfig = {
      ...baseConfig,
      name: 'CachedUser',
      tableName: 'cached_users',
      columnNames: ['id', 'password_hash'],
    };
    const first = ensureEffectiveHiddenFields(config);
    const second = ensureEffectiveHiddenFields(config);
    expect(first).toBe(second);
  });

  it('omits built-in private columns that do not appear in columnNames', () => {
    const config: EntityConfig = {
      ...baseConfig,
      name: 'PlainItem',
      tableName: 'plain_items_hidden',
      columnNames: ['id', 'name'],
    };
    const hidden = ensureEffectiveHiddenFields(config);
    expect(hidden.has('password_hash')).toBe(false);
    expect(hidden.has('name')).toBe(false);
  });
});
