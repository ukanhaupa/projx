import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { errorHandler, notFoundHandler } from '../../src/errors.js';
import { registerEntityRoutes, type EntityConfig } from '../../src/modules/_base/index.js';

const WidgetSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const CreateWidgetSchema = z.object({
  name: z.string(),
});

const UpdateWidgetSchema = z.object({
  name: z.string().optional(),
});

type RecordMap = Record<string, Record<string, unknown>>;

function makeMockPrisma() {
  const records: RecordMap = {};

  return {
    widget: {
      findMany: vi
        .fn()
        .mockImplementation(async () => Object.values(records).map((r) => ({ ...r }))),
      findUnique: vi
        .fn()
        .mockImplementation(async (args: { where: { id: string } }) =>
          records[args.where.id] ? { ...records[args.where.id] } : null,
        ),
      count: vi.fn().mockImplementation(async () => Object.keys(records).length),
      create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
        if (
          Object.values(records).some(
            (record) => record.code === args.data.code && args.data.code !== undefined,
          )
        ) {
          const error = new Error('Unique constraint failed') as Error & {
            code: string;
            meta: { target: string[] };
          };
          error.code = 'P2002';
          error.meta = { target: ['code'] };
          throw error;
        }
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
      createMany: vi.fn().mockImplementation(async (args: { data: Record<string, unknown>[] }) => {
        for (const item of args.data) {
          const id = crypto.randomUUID();
          records[id] = {
            id,
            ...item,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        }
        return { count: args.data.length };
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

function entityConfig(overrides: Partial<EntityConfig> = {}): EntityConfig {
  return {
    name: 'Widget',
    tableName: 'widgets',
    prismaModel: 'Widget',
    apiPrefix: '/widgets',
    tags: ['widgets'],
    readonly: false,
    softDelete: false,
    bulkOperations: true,
    columnNames: ['id', 'name', 'code', 'created_at', 'updated_at'],
    searchableFields: ['name'],
    schema: WidgetSchema,
    createSchema: CreateWidgetSchema,
    updateSchema: UpdateWidgetSchema,
    beforeCreateFields: ['code'],
    beforeCreate: (_request, data) => {
      data.code = data.code ?? crypto.randomUUID();
    },
    ...overrides,
  };
}

function buildRouteApp(config: EntityConfig = entityConfig()) {
  const app = express();
  app.use(express.json());
  const prisma = makeMockPrisma();
  app.use('/api/v1/widgets', registerEntityRoutes(config, prisma));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, prisma };
}

describe('Express registerEntityRoutes', () => {
  it('creates, lists, updates, and deletes records', async () => {
    const { app } = buildRouteApp();

    const created = await request(app).post('/api/v1/widgets').send({ name: 'first' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('first');
    expect(created.body.code).toBeDefined();

    const list = await request(app).get('/api/v1/widgets?page=1&page_size=5&search=first');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.pagination.total_records).toBe(1);

    const updated = await request(app)
      .patch(`/api/v1/widgets/${created.body.id}`)
      .send({ name: 'updated' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('updated');

    const removed = await request(app).delete(`/api/v1/widgets/${created.body.id}`);
    expect(removed.status).toBe(204);
  });

  it('validates create payloads', async () => {
    const { app } = buildRouteApp();
    const res = await request(app).post('/api/v1/widgets').send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('maps duplicate Prisma errors to 409', async () => {
    const config = entityConfig({
      createSchema: z.object({
        name: z.string(),
        code: z.string(),
      }),
      beforeCreate: undefined,
      beforeCreateFields: undefined,
    });
    const { app } = buildRouteApp(config);

    expect(
      (await request(app).post('/api/v1/widgets').send({ name: 'first', code: 'W1' })).status,
    ).toBe(201);
    const duplicate = await request(app)
      .post('/api/v1/widgets')
      .send({ name: 'second', code: 'W1' });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toMatchObject({ code: 'conflict', target: ['code'] });
  });

  it('supports bulk operations', async () => {
    const { app } = buildRouteApp();
    const created = await request(app)
      .post('/api/v1/widgets/bulk')
      .send({ items: [{ name: 'one' }, { name: 'two' }] });

    expect(created.status).toBe(201);
    expect(created.body.count).toBe(2);
  });

  describe('lifecycle hooks', () => {
    it('POST / runs afterCreate after the record is persisted', async () => {
      const calls: Array<{ kind: string; payload: unknown }> = [];
      const { app } = buildRouteApp(
        entityConfig({
          afterCreate: (_req, record) => {
            calls.push({ kind: 'afterCreate', payload: record });
          },
        }),
      );

      const res = await request(app).post('/api/v1/widgets').send({ name: 'AfterHook' });
      expect(res.status).toBe(201);
      expect(calls).toHaveLength(1);
      expect((calls[0].payload as { name: string }).name).toBe('AfterHook');
    });

    it('POST / succeeds even when afterCreate throws (best-effort)', async () => {
      const { app } = buildRouteApp(
        entityConfig({
          afterCreate: () => {
            throw new Error('after-create boom');
          },
        }),
      );

      const res = await request(app).post('/api/v1/widgets').send({ name: 'AfterThrows' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('AfterThrows');
    });

    it('PATCH /:id runs beforeUpdate and short-circuits when response is sent', async () => {
      const { app, prisma } = buildRouteApp(
        entityConfig({
          beforeUpdate: (_req, res, data) => {
            if ((data as { name?: string }).name === 'BLOCKED') {
              res.status(409).json({ error: { code: 'name_blocked', message: 'name is blocked' } });
            }
          },
        }),
      );

      const created = await request(app).post('/api/v1/widgets').send({ name: 'Original' });
      expect(created.status).toBe(201);

      const res = await request(app)
        .patch(`/api/v1/widgets/${created.body.id}`)
        .send({ name: 'BLOCKED' });
      expect(res.status).toBe(409);
      expect(prisma.widget.update).not.toHaveBeenCalled();
    });

    it('PATCH /:id runs afterUpdate with the before and after records', async () => {
      const calls: Array<{ before: unknown; after: unknown }> = [];
      const { app } = buildRouteApp(
        entityConfig({
          afterUpdate: (_req, before, after) => {
            calls.push({ before, after });
          },
        }),
      );

      const created = await request(app).post('/api/v1/widgets').send({ name: 'Before' });
      expect(created.status).toBe(201);

      const res = await request(app)
        .patch(`/api/v1/widgets/${created.body.id}`)
        .send({ name: 'After' });
      expect(res.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect((calls[0].before as { name: string }).name).toBe('Before');
      expect((calls[0].after as { name: string }).name).toBe('After');
    });

    it('DELETE /:id runs beforeDelete and can block via thrown error', async () => {
      const { app, prisma } = buildRouteApp(
        entityConfig({
          beforeDelete: (_req, recordId) => {
            if (recordId) throw new Error('delete forbidden');
          },
        }),
      );

      const created = await request(app).post('/api/v1/widgets').send({ name: 'KeepMe' });
      expect(created.status).toBe(201);

      const res = await request(app).delete(`/api/v1/widgets/${created.body.id}`);
      expect(res.status).toBe(500);
      expect(prisma.widget.delete).not.toHaveBeenCalled();
    });
  });
});
