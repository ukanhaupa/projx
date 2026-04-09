import { describe, it, expect } from 'vitest';
import {
  EntityRegistry,
  type EntityConfig,
  type FieldMeta,
} from '../../src/modules/_base/entity-registry.js';
import { Type } from '@sinclair/typebox';
import Fastify from 'fastify';
import errorHandler from '../../src/plugins/error-handler.js';
import authPlugin from '../../src/plugins/auth.js';
import { registerEntityRoutes } from '../../src/modules/_base/auto-routes.js';

const dummySchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  created_at: Type.String(),
  updated_at: Type.String(),
});

function makeConfig(overrides: Partial<EntityConfig> = {}): EntityConfig {
  return {
    name: 'TestEntity',
    tableName: 'test_entities',
    prismaModel: 'TestEntity',
    apiPrefix: '/test-entities',
    tags: ['test'],
    readonly: false,
    softDelete: false,
    bulkOperations: false,
    columnNames: ['id', 'name', 'created_at', 'updated_at'],
    searchableFields: ['name'],
    fields: [],
    schema: dummySchema,
    createSchema: Type.Object({ name: Type.String() }),
    updateSchema: Type.Object({ name: Type.Optional(Type.String()) }),
    ...overrides,
  };
}

describe('FieldMeta new fields', () => {
  it('getMeta returns searchable, foreign_key_target, in_create, in_update when provided', () => {
    EntityRegistry.reset();

    const fields: FieldMeta[] = [
      {
        key: 'id',
        label: 'Id',
        type: 'str',
        nullable: false,
        is_auto: true,
        is_primary_key: true,
        filterable: true,
        searchable: false,
        has_foreign_key: false,
        in_create: false,
        in_update: false,
        field_type: 'text',
      },
      {
        key: 'name',
        label: 'Name',
        type: 'str',
        nullable: false,
        is_auto: false,
        is_primary_key: false,
        filterable: true,
        searchable: true,
        has_foreign_key: false,
        in_create: true,
        in_update: true,
        field_type: 'text',
      },
      {
        key: 'category_id',
        label: 'Category',
        type: 'str',
        nullable: false,
        is_auto: false,
        is_primary_key: false,
        filterable: true,
        searchable: false,
        has_foreign_key: true,
        foreign_key_target: 'categories',
        in_create: true,
        in_update: false,
        field_type: 'text',
      },
    ];

    EntityRegistry.register(
      makeConfig({
        tableName: 'fieldmeta_test',
        columnNames: ['id', 'name', 'category_id', 'created_at', 'updated_at'],
        fields,
      }),
    );

    const meta = EntityRegistry.getMeta();
    const entity = meta.entities.find((e) => e.table_name === 'fieldmeta_test') as Record<
      string,
      unknown
    >;
    const entityFields = entity.fields as FieldMeta[];

    const nameField = entityFields.find((f) => f.key === 'name')!;
    expect(nameField.searchable).toBe(true);
    expect(nameField.in_create).toBe(true);
    expect(nameField.in_update).toBe(true);

    const categoryField = entityFields.find((f) => f.key === 'category_id')!;
    expect(categoryField.has_foreign_key).toBe(true);
    expect(categoryField.foreign_key_target).toBe('categories');
    expect(categoryField.in_create).toBe(true);
    expect(categoryField.in_update).toBe(false);

    const idField = entityFields.find((f) => f.key === 'id')!;
    expect(idField.in_create).toBe(false);
    expect(idField.in_update).toBe(false);
  });
});

describe('Custom controller support', () => {
  it('customRoutes overrides default registerEntityRoutes', async () => {
    const app = Fastify({ logger: false });
    app.decorate('prisma', {} as never);
    await app.register(errorHandler);
    await app.register(authPlugin);

    let customCalled = false;

    const config = makeConfig({
      customRoutes: (fastify) => {
        customCalled = true;
        fastify.get('/', async () => ({ custom: true }));
      },
    });

    await app.register(
      async (instance) => {
        const routeRegistrar = config.customRoutes ?? registerEntityRoutes;
        routeRegistrar(instance, config);
      },
      { prefix: '/api/v1/test-entities' },
    );

    await app.ready();

    expect(customCalled).toBe(true);

    const res = await app.inject({ method: 'GET', url: '/api/v1/test-entities/' });
    expect(res.json()).toEqual({ custom: true });

    await app.close();
  });

  it('falls back to registerEntityRoutes when customRoutes is not set', async () => {
    const app = Fastify({ logger: false });
    const mockPrisma = {
      $connect: () => {},
      $disconnect: () => {},
      $queryRaw: () => {},
      testEntity: {
        findMany: async () => [],
        findUnique: async () => null,
        count: async () => 0,
        create: async () => ({}),
        update: async () => ({}),
        delete: async () => ({}),
        createMany: async () => ({ count: 0 }),
        deleteMany: async () => ({ count: 0 }),
      },
    };

    app.decorate('prisma', mockPrisma as never);
    await app.register(errorHandler);
    await app.register(authPlugin);

    const config = makeConfig();

    await app.register(
      async (instance) => {
        const routeRegistrar = config.customRoutes ?? registerEntityRoutes;
        routeRegistrar(instance, config);
      },
      { prefix: '/api/v1/test-entities' },
    );

    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/v1/test-entities/' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('data');
    expect(res.json()).toHaveProperty('pagination');

    await app.close();
  });
});
