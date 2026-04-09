import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import errorHandler from '../../src/plugins/error-handler.js';
import authPlugin from '../../src/plugins/auth.js';
import authzPlugin from '../../src/plugins/authz.js';
import { registerEntityRoutes } from '../../src/modules/_base/auto-routes.js';
import type { EntityConfig } from '../../src/modules/_base/entity-registry.js';

const dummySchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  created_at: Type.String(),
  updated_at: Type.String(),
});

const createSchema = Type.Object({
  name: Type.String(),
});

const updateSchema = Type.Object({
  name: Type.Optional(Type.String()),
});

function makeMockPrisma() {
  const records: Record<string, Record<string, unknown>> = {};

  return {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $queryRaw: vi.fn(),
    widget: {
      findMany: vi.fn().mockImplementation(async () => Object.values(records)),
      findUnique: vi
        .fn()
        .mockImplementation(
          async (args: { where: { id: string } }) => records[args.where.id] ?? null,
        ),
      count: vi.fn().mockImplementation(async () => Object.keys(records).length),
      create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
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
          async (args: { where: { id: string }; data: Record<string, unknown> }) => {
            const record = records[args.where.id];
            if (!record) throw new Error('Record not found');
            Object.assign(record, args.data);
            return record;
          },
        ),
      delete: vi.fn().mockImplementation(async (args: { where: { id: string } }) => {
        const record = records[args.where.id];
        delete records[args.where.id];
        return record;
      }),
      createMany: vi.fn().mockImplementation(async (args: { data: unknown }) => {
        const items = args.data as Record<string, unknown>[];
        let count = 0;
        if (Array.isArray(items)) {
          for (const item of items) {
            const id = crypto.randomUUID();
            records[id] = {
              id,
              ...item,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            count++;
          }
        }
        return { count };
      }),
      deleteMany: vi.fn().mockImplementation(async (args: { where: { id: { in: string[] } } }) => {
        let count = 0;
        for (const id of args.where.id.in) {
          if (records[id]) {
            delete records[id];
            count++;
          }
        }
        return { count };
      }),
    },
    _records: records,
  };
}

function makeEntityConfig(overrides: Partial<EntityConfig> = {}): EntityConfig {
  return {
    name: 'Widget',
    tableName: 'widgets',
    prismaModel: 'Widget',
    apiPrefix: '/widgets',
    tags: ['widgets'],
    readonly: false,
    softDelete: false,
    bulkOperations: false,
    columnNames: ['id', 'name', 'created_at', 'updated_at'],
    searchableFields: ['name'],
    fields: [],
    schema: dummySchema,
    createSchema,
    updateSchema,
    ...overrides,
  };
}

async function buildRouteTestApp(
  entityConfig: EntityConfig,
  mockPrisma?: ReturnType<typeof makeMockPrisma>,
): Promise<{ app: FastifyInstance; prisma: ReturnType<typeof makeMockPrisma> }> {
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
    { prefix: '/api/v1/widgets' },
  );

  await app.ready();
  return { app, prisma };
}

describe('registerEntityRoutes', () => {
  let app: FastifyInstance;
  let prisma: ReturnType<typeof makeMockPrisma>;

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('CRUD routes', () => {
    beforeEach(async () => {
      const result = await buildRouteTestApp(makeEntityConfig());
      app = result.app;
      prisma = result.prisma;
    });

    it('GET / returns paginated list', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/widgets' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeDefined();
      expect(body.pagination).toBeDefined();
    });

    it('GET / with search param triggers search', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/widgets?search=foo' });
      expect(res.statusCode).toBe(200);
    });

    it('GET / with expand param triggers expand', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/widgets?expand=category' });
      expect(res.statusCode).toBe(200);
    });

    it('GET / with pagination params', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/widgets?page=2&page_size=5',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.pagination.current_page).toBe(2);
      expect(body.pagination.page_size).toBe(5);
    });

    it('GET / with order_by param', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/widgets?order_by=-name',
      });
      expect(res.statusCode).toBe(200);
    });

    it('GET /:id returns the record', async () => {
      const created = await prisma.widget.create({ data: { name: 'Test' } });
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/widgets/${created.id}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Test');
    });

    it('GET /:id with expand param', async () => {
      const created = await prisma.widget.create({ data: { name: 'Test' } });
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/widgets/${created.id}?expand=category`,
      });
      expect(res.statusCode).toBe(200);
    });

    it('GET /:id returns 404 for non-existent', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/widgets/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });

    it('POST / creates a record', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/widgets',
        payload: { name: 'New Widget' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().name).toBe('New Widget');
    });

    it('PATCH /:id updates a record', async () => {
      const created = await prisma.widget.create({ data: { name: 'Old Name' } });
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/widgets/${created.id}`,
        payload: { name: 'New Name' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('New Name');
    });

    it('PATCH /:id returns 400 for empty body', async () => {
      const created = await prisma.widget.create({ data: { name: 'Test' } });
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/widgets/${created.id}`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().detail).toContain('empty');
    });

    it('PATCH /:id returns 404 for non-existent', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/widgets/00000000-0000-0000-0000-000000000000',
        payload: { name: 'Updated' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('DELETE /:id removes a record', async () => {
      const created = await prisma.widget.create({ data: { name: 'To Delete' } });
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/widgets/${created.id}`,
      });
      expect(res.statusCode).toBe(204);
    });

    it('DELETE /:id returns 404 for non-existent', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/widgets/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('readonly entity', () => {
    beforeEach(async () => {
      const result = await buildRouteTestApp(makeEntityConfig({ readonly: true }));
      app = result.app;
      prisma = result.prisma;
    });

    it('GET / works on readonly entity', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/widgets' });
      expect(res.statusCode).toBe(200);
    });

    it('POST / returns 404 on readonly entity', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/widgets',
        payload: { name: 'Test' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('PATCH /:id returns 404 on readonly entity', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/widgets/some-id',
        payload: { name: 'Test' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('DELETE /:id returns 404 on readonly entity', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/widgets/some-id',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('bulk operations', () => {
    beforeEach(async () => {
      const result = await buildRouteTestApp(makeEntityConfig({ bulkOperations: true }));
      app = result.app;
      prisma = result.prisma;
    });

    it('POST /bulk creates multiple records', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/widgets/bulk',
        payload: {
          items: [{ name: 'Widget A' }, { name: 'Widget B' }],
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().count).toBeDefined();
    });

    it('DELETE /bulk deletes multiple records', async () => {
      const r1 = await prisma.widget.create({ data: { name: 'A' } });
      const r2 = await prisma.widget.create({ data: { name: 'B' } });
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/widgets/bulk',
        payload: { ids: [r1.id, r2.id] },
      });
      expect(res.statusCode).toBe(204);
    });
  });

  describe('bulk operations not registered when disabled', () => {
    beforeEach(async () => {
      const result = await buildRouteTestApp(makeEntityConfig({ bulkOperations: false }));
      app = result.app;
      prisma = result.prisma;
    });

    it('POST /bulk returns 404 when bulk ops disabled', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/widgets/bulk',
        payload: { items: [{ name: 'A' }] },
      });
      expect(res.statusCode).toBe(404);
    });

    it('DELETE /bulk returns error when bulk ops disabled', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/widgets/bulk',
        payload: { ids: ['id1'] },
      });
      // "bulk" is not a valid UUID, so it hits the /:id route and fails validation
      expect([400, 404]).toContain(res.statusCode);
    });
  });

  describe('auth-protected entity (global authz)', () => {
    beforeEach(async () => {
      const { config } = await import('../../src/config.js');
      (config as { AUTH_ENABLED: boolean }).AUTH_ENABLED = true;

      const result = await buildRouteTestApp(makeEntityConfig());
      app = result.app;
      prisma = result.prisma;
    });

    afterAll(async () => {
      const { config } = await import('../../src/config.js');
      (config as { AUTH_ENABLED: boolean }).AUTH_ENABLED = false;
    });

    it('GET / returns 401 without token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/widgets' });
      expect(res.statusCode).toBe(401);
    });

    it('GET / succeeds with wildcard permission', async () => {
      const token = app.jwt.sign({ sub: 'user-1', permissions: ['*:*.*'] });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/widgets',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('GET / succeeds with matching resource:action.scope permission', async () => {
      const token = app.jwt.sign({ sub: 'user-1', permissions: ['widgets:read.all'] });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/widgets',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('GET / returns 403 with wrong resource permission', async () => {
      const token = app.jwt.sign({ sub: 'user-1', permissions: ['other:read.all'] });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/widgets',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('GET /:id maps to resource:read.one', async () => {
      const id = crypto.randomUUID();
      prisma._records[id] = { id, name: 'W', created_at: '', updated_at: '' };
      const token = app.jwt.sign({ sub: 'user-1', permissions: ['widgets:read.one'] });
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/widgets/${id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('POST / maps to resource:create.one', async () => {
      const token = app.jwt.sign({ sub: 'user-1', permissions: ['widgets:create.one'] });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/widgets/',
        payload: { name: 'New' },
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(201);
    });

    it('wildcard action matches any scope', async () => {
      const token = app.jwt.sign({ sub: 'user-1', permissions: ['widgets:read.*'] });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/widgets',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('entity without auth', () => {
    beforeEach(async () => {
      const result = await buildRouteTestApp(makeEntityConfig());
      app = result.app;
      prisma = result.prisma;
    });

    it('GET / works without auth when not protected', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/widgets' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('expand with relations', () => {
    beforeEach(async () => {
      const result = await buildRouteTestApp(
        makeEntityConfig({
          relations: {
            category: { model: 'Category', field: 'category_id' },
          },
        }),
      );
      app = result.app;
      prisma = result.prisma;
    });

    it('GET / with expand=category passes include to query', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/widgets?expand=category',
      });
      expect(res.statusCode).toBe(200);
    });

    it('GET /:id with expand=category passes include to query', async () => {
      const created = await prisma.widget.create({ data: { name: 'Expandable' } });
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/widgets/${created.id}?expand=category`,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('parseRawQuery edge cases', () => {
    beforeEach(async () => {
      const result = await buildRouteTestApp(makeEntityConfig());
      app = result.app;
      prisma = result.prisma;
    });

    it('GET / with no query string', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/widgets' });
      expect(res.statusCode).toBe(200);
      expect(res.json().pagination.current_page).toBe(1);
      expect(res.json().pagination.page_size).toBe(10);
    });

    it('GET / with invalid page defaults to 1', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/widgets?page=0' });
      expect(res.statusCode).toBe(200);
      expect(res.json().pagination.current_page).toBe(1);
    });

    it('GET / with huge page_size clamps to 100', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/widgets?page_size=500' });
      expect(res.statusCode).toBe(200);
      expect(res.json().pagination.page_size).toBe(100);
    });

    it('GET / with custom filter params', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/widgets?name=TestWidget',
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
