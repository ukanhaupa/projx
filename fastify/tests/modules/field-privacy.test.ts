import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import errorHandler from '../../src/plugins/error-handler.js';
import authPlugin from '../../src/plugins/auth.js';
import authzPlugin from '../../src/plugins/authz.js';
import { registerEntityRoutes } from '../../src/modules/_base/auto-routes.js';
import {
  EntityRegistry,
  type EntityConfig,
} from '../../src/modules/_base/entity-registry.js';

const secretSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  internal_note: Type.Optional(Type.String()),
  password_hash: Type.Optional(Type.String()),
  created_at: Type.String(),
  updated_at: Type.String(),
});

const createSchema = Type.Object({
  name: Type.String(),
  internal_note: Type.Optional(Type.String()),
  password_hash: Type.Optional(Type.String()),
});

const updateSchema = Type.Object({
  name: Type.Optional(Type.String()),
});

function superuserHeaders(app: FastifyInstance): Record<string, string> {
  const token = app.jwt.sign({ sub: 'test-superuser', permissions: ['*:*.*'] });
  return { authorization: `Bearer ${token}` };
}

function makeMockPrisma() {
  const records: Record<string, Record<string, unknown>> = {};

  return {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $queryRaw: vi.fn(),
    secretWidget: {
      findMany: vi.fn().mockImplementation(async () => Object.values(records)),
      findUnique: vi
        .fn()
        .mockImplementation(
          async (args: { where: { id: string } }) =>
            records[args.where.id] ?? null,
        ),
      count: vi
        .fn()
        .mockImplementation(async () => Object.keys(records).length),
      create: vi
        .fn()
        .mockImplementation(async (args: { data: Record<string, unknown> }) => {
          const id = crypto.randomUUID();
          const record = {
            id,
            ...args.data,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          records[id] = record;
          return record;
        }),
      update: vi
        .fn()
        .mockImplementation(
          async (args: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => {
            const record = records[args.where.id];
            if (!record) throw new Error('Record not found');
            Object.assign(record, args.data);
            return record;
          },
        ),
      delete: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    _records: records,
  };
}

function makeSecretConfig(overrides: Partial<EntityConfig> = {}): EntityConfig {
  return {
    name: 'SecretWidget',
    tableName: 'secret_widgets',
    prismaModel: 'SecretWidget',
    apiPrefix: '/secret-widgets',
    tags: ['secret-widgets'],
    readonly: false,
    softDelete: false,
    bulkOperations: false,
    columnNames: [
      'id',
      'name',
      'internal_note',
      'password_hash',
      'created_at',
      'updated_at',
    ],
    searchableFields: ['name'],
    hiddenFields: ['internal_note'],
    fields: [
      {
        key: 'id',
        label: 'Id',
        type: 'str',
        nullable: false,
        is_auto: true,
        is_primary_key: true,
        filterable: true,
        has_foreign_key: false,
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
        has_foreign_key: false,
        field_type: 'text',
      },
      {
        key: 'internal_note',
        label: 'Internal Note',
        type: 'str',
        nullable: true,
        is_auto: false,
        is_primary_key: false,
        filterable: true,
        has_foreign_key: false,
        field_type: 'text',
      },
      {
        key: 'password_hash',
        label: 'Password Hash',
        type: 'str',
        nullable: true,
        is_auto: false,
        is_primary_key: false,
        filterable: false,
        has_foreign_key: false,
        field_type: 'text',
      },
    ],
    schema: secretSchema,
    createSchema,
    updateSchema,
    ...overrides,
  };
}

async function buildPrivacyTestApp(
  entityConfig: EntityConfig,
  mockPrisma?: ReturnType<typeof makeMockPrisma>,
): Promise<{
  app: FastifyInstance;
  prisma: ReturnType<typeof makeMockPrisma>;
}> {
  const app = Fastify({ logger: false });
  const prisma = mockPrisma ?? makeMockPrisma();

  app.decorate('prisma', prisma as never);
  await app.register(errorHandler);
  await app.register(authPlugin);
  await app.register(authzPlugin);

  await app.register(
    async (instance) => {
      registerEntityRoutes(instance, entityConfig);
    },
    { prefix: '/api/v1/secret-widgets' },
  );

  await app.ready();
  return { app, prisma };
}

describe('Field-level privacy', () => {
  let app: FastifyInstance;

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET list strips explicitly hidden fields from response', async () => {
    const config = makeSecretConfig();
    const result = await buildPrivacyTestApp(config);
    app = result.app;
    const prisma = result.prisma;
    const headers = superuserHeaders(app);

    const id1 = crypto.randomUUID();
    prisma._records[id1] = {
      id: id1,
      name: 'Widget',
      internal_note: 'do-not-leak',
      password_hash: 'hashed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/secret-widgets/',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const row = res.json().data[0];
    expect(row).not.toHaveProperty('internal_note');
  });

  it('GET by id strips explicitly hidden fields from response', async () => {
    const config = makeSecretConfig();
    const result = await buildPrivacyTestApp(config);
    app = result.app;
    const prisma = result.prisma;
    const headers = superuserHeaders(app);

    const id2 = crypto.randomUUID();
    prisma._records[id2] = {
      id: id2,
      name: 'Widget',
      internal_note: 'do-not-leak',
      password_hash: 'hashed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/secret-widgets/${id2}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('internal_note');
  });

  it('GET list strips built-in private columns even without explicit hiddenFields', async () => {
    const config = makeSecretConfig();
    const result = await buildPrivacyTestApp(config);
    app = result.app;
    const prisma = result.prisma;
    const headers = superuserHeaders(app);

    const id3 = crypto.randomUUID();
    prisma._records[id3] = {
      id: id3,
      name: 'Widget',
      internal_note: 'x',
      password_hash: 'super-secret-hash',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/secret-widgets/',
      headers,
    });
    const row = res.json().data[0];
    expect(row).not.toHaveProperty('password_hash');
  });

  it('POST response strips hidden fields', async () => {
    const config = makeSecretConfig();
    const result = await buildPrivacyTestApp(config);
    app = result.app;
    const headers = superuserHeaders(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/secret-widgets/',
      headers,
      payload: { name: 'New', internal_note: 'secret', password_hash: 'h' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).not.toHaveProperty('internal_note');
    expect(body).not.toHaveProperty('password_hash');
  });
});

describe('Entity-level private', () => {
  it('private entity is rejected by registry', () => {
    EntityRegistry.reset();
    const config = makeSecretConfig({
      private: true,
      tableName: 'hidden_things',
    });
    EntityRegistry.register(config);
    expect(EntityRegistry.getAll()).toHaveLength(0);
  });

  it('private entity not in getMeta()', () => {
    EntityRegistry.reset();
    EntityRegistry.register(
      makeSecretConfig({ private: true, tableName: 'hidden_things' }),
    );
    EntityRegistry.register(
      makeSecretConfig({ tableName: 'visible_things', name: 'VisibleThing' }),
    );
    const meta = EntityRegistry.getMeta();
    const tableNames = meta.entities.map((e) => e.table_name);
    expect(tableNames).not.toContain('hidden_things');
    expect(tableNames).toContain('visible_things');
  });
});

describe('Meta strips hidden fields', () => {
  beforeEach(() => {
    EntityRegistry.reset();
  });

  it('getMeta excludes explicitly hidden fields and built-in private columns', () => {
    EntityRegistry.register(makeSecretConfig());
    const meta = EntityRegistry.getMeta();
    const entity = meta.entities.find(
      (e) => e.table_name === 'secret_widgets',
    ) as Record<string, unknown>;
    const fieldKeys = (entity.fields as Array<{ key: string }>).map(
      (f) => f.key,
    );
    expect(fieldKeys).not.toContain('internal_note');
    expect(fieldKeys).not.toContain('password_hash');
  });
});
