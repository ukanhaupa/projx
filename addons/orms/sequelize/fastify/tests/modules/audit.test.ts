import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../../src/db/client.js';
import { AuditLog } from '../../src/models/audit-log.js';
import { registerEntityRoutes } from '../../src/modules/_base/index.js';
import { auditBulkUpdate } from '../../src/modules/_base/audit.js';
import { runWithUserId } from '../../src/utils/request-context.js';

class Widget extends Model {
  declare id: string;
  declare name: string;
  declare qty: number;
}

Widget.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: { type: DataTypes.TEXT, allowNull: false },
    qty: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  { sequelize, modelName: 'Widget', tableName: 'widgets' },
);

async function buildHarness(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(
    async (instance) => {
      registerEntityRoutes(instance, {
        name: 'Widget',
        apiPrefix: '/widgets',
        tag: 'widgets',
        model: Widget,
        searchableFields: ['name'],
        bulkOperations: true,
      });
    },
    { prefix: '/api/v1/widgets' },
  );
  await app.ready();
  return app;
}

async function auditRows(tableName: string): Promise<
  Array<{
    table_name: string;
    record_id: string;
    action: string;
    old_value: unknown;
    new_value: unknown;
    performed_by: string;
  }>
> {
  const rows = await AuditLog.findAll({
    where: { table_name: tableName },
    order: [['createdAt', 'ASC']],
  });
  return rows.map((r) => r.toJSON());
}

describe('Sequelize audit logging', () => {
  let app: FastifyInstance;
  const url = '/api/v1/widgets';

  beforeAll(async () => {
    await sequelize.sync({ force: true });
    app = await buildHarness();
  });

  beforeEach(async () => {
    await AuditLog.destroy({ where: {}, truncate: true });
    await Widget.destroy({ where: {}, truncate: true });
  });

  afterAll(async () => {
    await app.close();
    await sequelize.close();
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
      table_name: 'widgets',
      record_id: id,
      action: 'INSERT',
      old_value: null,
      performed_by: 'system',
    });
    expect(rows[0].new_value).toMatchObject({ name: 'alpha', qty: 3 });
  });

  it('writes one UPDATE row with old pre-image and new post-image', async () => {
    const created = await app.inject({
      method: 'POST',
      url,
      payload: { name: 'beta', qty: 1 },
    });
    const { id } = created.json() as { id: string };
    await AuditLog.destroy({ where: {}, truncate: true });

    const res = await app.inject({
      method: 'PATCH',
      url: `${url}/${id}`,
      payload: { qty: 9 },
    });
    expect(res.statusCode).toBe(200);

    const rows = await auditRows('widgets');
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('UPDATE');
    expect(rows[0].record_id).toBe(id);
    expect(rows[0].old_value).toMatchObject({ qty: 1 });
    expect(rows[0].new_value).toMatchObject({ qty: 9 });
  });

  it('writes one DELETE row with old pre-image and null new_value', async () => {
    const created = await app.inject({
      method: 'POST',
      url,
      payload: { name: 'gamma', qty: 5 },
    });
    const { id } = created.json() as { id: string };
    await AuditLog.destroy({ where: {}, truncate: true });

    const res = await app.inject({ method: 'DELETE', url: `${url}/${id}` });
    expect(res.statusCode).toBe(204);

    const rows = await auditRows('widgets');
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('DELETE');
    expect(rows[0].record_id).toBe(id);
    expect(rows[0].old_value).toMatchObject({ name: 'gamma', qty: 5 });
    expect(rows[0].new_value).toBeNull();
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
    expect(rows.every((r) => r.old_value === null)).toBe(true);
    expect(new Set(rows.map((r) => r.record_id))).toEqual(
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
    await AuditLog.destroy({ where: {}, truncate: true });

    const res = await app.inject({
      method: 'DELETE',
      url: `${url}/bulk`,
      payload: { ids: created },
    });
    expect(res.statusCode).toBe(204);

    const rows = await auditRows('widgets');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.action === 'DELETE')).toBe(true);
    expect(rows.every((r) => r.new_value === null)).toBe(true);
    expect(new Set(rows.map((r) => r.record_id))).toEqual(new Set(created));
    const qtys = rows
      .map((r) => (r.old_value as { qty: number }).qty)
      .sort((a, b) => a - b);
    expect(qtys).toEqual([10, 20]);
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
    expect(rows[0].performed_by).toBe('auditor@example.com');
  });

  it('writes one UPDATE row per affected row on bulk update', async () => {
    const ids = await Promise.all(
      ['p', 'q'].map((name) =>
        app
          .inject({ method: 'POST', url, payload: { name, qty: 1 } })
          .then((r) => (r.json() as { id: string }).id),
      ),
    );
    await AuditLog.destroy({ where: {}, truncate: true });

    await auditBulkUpdate(Widget, 'id', { id: ids }, () =>
      Widget.update({ qty: 7 }, { where: { id: ids } }),
    );

    const rows = await auditRows('widgets');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.action === 'UPDATE')).toBe(true);
    expect(new Set(rows.map((r) => r.record_id))).toEqual(new Set(ids));
    expect(rows.every((r) => (r.old_value as { qty: number }).qty === 1)).toBe(
      true,
    );
    expect(rows.every((r) => (r.new_value as { qty: number }).qty === 7)).toBe(
      true,
    );
  });

  it('never audits the audit_logs table itself', async () => {
    const app2 = Fastify({ logger: false });
    await app2.register(
      async (instance) => {
        registerEntityRoutes(instance, {
          name: 'AuditLog',
          apiPrefix: '/audit',
          tag: 'audit',
          model: AuditLog,
        });
      },
      { prefix: '/api/v1/audit' },
    );
    await app2.ready();

    const res = await app2.inject({
      method: 'POST',
      url: '/api/v1/audit',
      payload: {
        table_name: 'x',
        record_id: 'y',
        action: 'INSERT',
        performed_by: 'system',
      },
    });
    expect(res.statusCode).toBe(201);

    const total = await AuditLog.count();
    expect(total).toBe(1);
    const selfRows = await AuditLog.count({
      where: { table_name: AuditLog.tableName },
    });
    expect(selfRows).toBe(0);
    await app2.close();
  });
});
