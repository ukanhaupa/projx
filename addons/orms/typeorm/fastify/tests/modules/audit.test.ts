import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Column, Entity, In, PrimaryGeneratedColumn } from 'typeorm';
import { dataSource } from '../../src/db/data-source.js';
import { entities } from '../../src/entities/index.js';
import { AuditLog } from '../../src/entities/audit-log.js';
import { registerEntityRoutes } from '../../src/modules/_base/index.js';
import {
  auditedBulkUpdate,
  auditedCreate,
} from '../../src/modules/_base/audit.js';
import { runWithUserId } from '../../src/utils/request-context.js';

@Entity({ name: 'widgets' })
class Widget {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'int', default: 0 })
  qty!: number;
}

const url = '/api/v1/widgets';

function widgetRepo() {
  return dataSource.getRepository(Widget);
}

function auditRepo() {
  return dataSource.getRepository(AuditLog);
}

async function buildHarness(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(
    async (instance) => {
      registerEntityRoutes(instance, {
        name: 'Widget',
        apiPrefix: '/widgets',
        tag: 'widgets',
        entity: Widget,
        searchableFields: ['name'],
        bulkOperations: true,
      });
    },
    { prefix: url },
  );
  await app.ready();
  return app;
}

async function auditRows(tableName: string) {
  return auditRepo().find({
    where: { tableName },
    order: { performedAt: 'ASC' },
  });
}

describe('TypeORM audit logging', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    dataSource.setOptions({ entities: [...entities, Widget] });
    if (!dataSource.isInitialized) await dataSource.initialize();
    await dataSource.synchronize(true);
    app = await buildHarness();
  });

  beforeEach(async () => {
    await auditRepo().clear();
    await widgetRepo().clear();
  });

  afterAll(async () => {
    await app.close();
    await dataSource.destroy();
  });

  it('writes one INSERT row on create with new_value and null old_value', async () => {
    const res = await app.inject({
      method: 'POST',
      url,
      payload: { name: 'alpha', qty: 3 },
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json() as { id: string };

    const rows = await auditRows('widgets');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tableName: 'widgets',
      recordId: id,
      action: 'INSERT',
      oldValue: null,
      performedBy: 'system',
    });
    expect(rows[0].newValue).toMatchObject({ name: 'alpha', qty: 3 });
  });

  it('writes one UPDATE row with old pre-image and new post-image', async () => {
    const created = await app.inject({
      method: 'POST',
      url,
      payload: { name: 'beta', qty: 1 },
    });
    const { id } = created.json() as { id: string };
    await auditRepo().clear();

    const res = await app.inject({
      method: 'PATCH',
      url: `${url}/${id}`,
      payload: { qty: 9 },
    });
    expect(res.statusCode).toBe(200);

    const rows = await auditRows('widgets');
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('UPDATE');
    expect(rows[0].recordId).toBe(id);
    expect(rows[0].oldValue).toMatchObject({ qty: 1 });
    expect(rows[0].newValue).toMatchObject({ qty: 9 });
  });

  it('writes one DELETE row with old pre-image and null new_value', async () => {
    const created = await app.inject({
      method: 'POST',
      url,
      payload: { name: 'gamma', qty: 5 },
    });
    const { id } = created.json() as { id: string };
    await auditRepo().clear();

    const res = await app.inject({ method: 'DELETE', url: `${url}/${id}` });
    expect(res.statusCode).toBe(204);

    const rows = await auditRows('widgets');
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('DELETE');
    expect(rows[0].recordId).toBe(id);
    expect(rows[0].oldValue).toMatchObject({ name: 'gamma', qty: 5 });
    expect(rows[0].newValue).toBeNull();
  });

  it('writes one INSERT row per row on bulk create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${url}/bulk`,
      payload: {
        items: [
          { name: 'b1', qty: 1 },
          { name: 'b2', qty: 2 },
          { name: 'b3', qty: 3 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: Array<{ id: string }>; count: number };

    const rows = await auditRows('widgets');
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.action === 'INSERT')).toBe(true);
    expect(rows.every((r) => r.oldValue === null)).toBe(true);
    expect(new Set(rows.map((r) => r.recordId))).toEqual(
      new Set(body.data.map((d) => d.id)),
    );
  });

  it('writes one DELETE row per affected row on bulk delete with pre-images', async () => {
    const created = await Promise.all(
      [10, 20].map((qty) =>
        app
          .inject({ method: 'POST', url, payload: { name: `d${qty}`, qty } })
          .then((r) => (r.json() as { id: string }).id),
      ),
    );
    await auditRepo().clear();

    const res = await app.inject({
      method: 'DELETE',
      url: `${url}/bulk`,
      payload: { ids: created },
    });
    expect(res.statusCode).toBe(204);

    const rows = await auditRows('widgets');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.action === 'DELETE')).toBe(true);
    expect(rows.every((r) => r.newValue === null)).toBe(true);
    expect(new Set(rows.map((r) => r.recordId))).toEqual(new Set(created));
    const qtys = rows
      .map((r) => (r.oldValue as { qty: number }).qty)
      .sort((a, b) => a - b);
    expect(qtys).toEqual([10, 20]);
  });

  it('writes one UPDATE row per affected row on bulk update', async () => {
    const ids = await Promise.all(
      ['p', 'q'].map((name) =>
        app
          .inject({ method: 'POST', url, payload: { name, qty: 1 } })
          .then((r) => (r.json() as { id: string }).id),
      ),
    );
    await auditRepo().clear();

    await auditedBulkUpdate(widgetRepo(), { id: In(ids) }, () =>
      widgetRepo().update(ids, { qty: 7 }),
    );

    const rows = await auditRows('widgets');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.action === 'UPDATE')).toBe(true);
    expect(new Set(rows.map((r) => r.recordId))).toEqual(new Set(ids));
    expect(rows.every((r) => (r.oldValue as { qty: number }).qty === 1)).toBe(
      true,
    );
    expect(rows.every((r) => (r.newValue as { qty: number }).qty === 7)).toBe(
      true,
    );
  });

  it('records the request actor when present', async () => {
    await runWithUserId('auditor@example.com', async () => {
      await app.inject({
        method: 'POST',
        url,
        payload: { name: 'tracked', qty: 1 },
      });
    });
    const rows = await auditRows('widgets');
    expect(rows).toHaveLength(1);
    expect(rows[0].performedBy).toBe('auditor@example.com');
  });

  it('lists, filters and searches without emitting audit rows for reads', async () => {
    await app.inject({
      method: 'POST',
      url: `${url}/bulk`,
      payload: {
        items: [
          { name: 'apple', qty: 1 },
          { name: 'apricot', qty: 2 },
          { name: 'banana', qty: 3 },
        ],
      },
    });
    await auditRepo().clear();

    const list = await app.inject({
      method: 'GET',
      url: `${url}?order_by=-qty&page=1&page_size=2`,
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as {
      data: Array<{ qty: number }>;
      pagination: { total_records: number };
    };
    expect(listBody.data[0].qty).toBe(3);
    expect(listBody.pagination.total_records).toBe(3);

    const search = await app.inject({ method: 'GET', url: `${url}?search=ap` });
    const searchBody = search.json() as { data: Array<{ name: string }> };
    expect(searchBody.data.map((r) => r.name).sort()).toEqual([
      'apple',
      'apricot',
    ]);

    const get = await app.inject({
      method: 'GET',
      url: `${url}/00000000-0000-0000-0000-000000000000`,
    });
    expect(get.statusCode).toBe(404);

    expect(await auditRepo().count()).toBe(0);
  });

  it('rejects empty and malformed mutation payloads without writing audit rows', async () => {
    const created = await app.inject({
      method: 'POST',
      url,
      payload: { name: 'delta', qty: 4 },
    });
    const { id } = created.json() as { id: string };
    await auditRepo().clear();

    const emptyPatch = await app.inject({
      method: 'PATCH',
      url: `${url}/${id}`,
      payload: {},
    });
    expect(emptyPatch.statusCode).toBe(400);

    const missingPatch = await app.inject({
      method: 'PATCH',
      url: `${url}/00000000-0000-0000-0000-000000000000`,
      payload: { qty: 1 },
    });
    expect(missingPatch.statusCode).toBe(404);

    const emptyBulkCreate = await app.inject({
      method: 'POST',
      url: `${url}/bulk`,
      payload: { items: [] },
    });
    expect(emptyBulkCreate.statusCode).toBe(400);

    const emptyBulkDelete = await app.inject({
      method: 'DELETE',
      url: `${url}/bulk`,
      payload: { ids: [] },
    });
    expect(emptyBulkDelete.statusCode).toBe(400);

    expect(await auditRepo().count()).toBe(0);
  });

  it('never audits the audit_logs table itself', async () => {
    const repo = auditRepo();
    const seeded = repo.create({
      tableName: 'widgets',
      recordId: 'seed',
      action: 'INSERT',
      oldValue: null,
      newValue: { name: 'seed' },
      performedBy: 'system',
    });
    await auditedCreate(repo, seeded);

    expect(await repo.count()).toBe(1);
    expect(
      await repo.count({ where: { tableName: repo.metadata.tableName } }),
    ).toBe(0);
  });
});
