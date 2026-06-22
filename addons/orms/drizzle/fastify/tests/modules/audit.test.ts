import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { asc, eq, sql } from 'drizzle-orm';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { db } from '../../src/db/client.js';
import { auditLogs } from '../../src/db/schema.js';
import { registerEntityRoutes } from '../../src/modules/_base/index.js';
import { runWithUserId } from '../../src/utils/request-context.js';

const widgets = pgTable('audit_widgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
});

const PREFIX = '/widgets';

interface AuditRow {
  table_name: string;
  record_id: string;
  action: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  performed_by: string;
}

async function buildAuditApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  await app.register(
    async (instance) => {
      registerEntityRoutes(instance, {
        name: 'Widget',
        apiPrefix: PREFIX,
        tag: 'widgets',
        table: widgets,
        searchableFields: ['name'],
        bulkOperations: true,
      });
    },
    { prefix: PREFIX },
  );
  await app.ready();
  return app;
}

async function readAudit(): Promise<AuditRow[]> {
  const rows = await db
    .select({
      table_name: auditLogs.tableName,
      record_id: auditLogs.recordId,
      action: auditLogs.action,
      old_value: auditLogs.oldValue,
      new_value: auditLogs.newValue,
      performed_by: auditLogs.performedBy,
    })
    .from(auditLogs)
    .orderBy(asc(auditLogs.createdAt));
  return rows as AuditRow[];
}

describe('Drizzle audit logging', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS audit_widgets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL)`,
    );
    app = await buildAuditApp();
  });

  afterAll(async () => {
    await app.close();
    await db.execute(sql`DROP TABLE IF EXISTS audit_widgets`);
  });

  beforeEach(async () => {
    await db.delete(widgets);
    await db.delete(auditLogs);
  });

  async function createWidget(name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: PREFIX,
      payload: { name },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }

  it('writes one INSERT row on create', async () => {
    const id = await createWidget('alpha');
    const rows = await readAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      table_name: 'audit_widgets',
      record_id: id,
      action: 'INSERT',
      old_value: null,
      new_value: { id, name: 'alpha' },
      performed_by: 'system',
    });
  });

  it('writes one UPDATE row with old and new images', async () => {
    const id = await createWidget('alpha');
    await db.delete(auditLogs);
    const res = await app.inject({
      method: 'PATCH',
      url: `${PREFIX}/${id}`,
      payload: { name: 'beta' },
    });
    expect(res.statusCode).toBe(200);
    const rows = await readAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'UPDATE',
      record_id: id,
      old_value: { id, name: 'alpha' },
      new_value: { id, name: 'beta' },
    });
  });

  it('writes one DELETE row with old image and null new', async () => {
    const id = await createWidget('alpha');
    await db.delete(auditLogs);
    const res = await app.inject({ method: 'DELETE', url: `${PREFIX}/${id}` });
    expect(res.statusCode).toBe(204);
    const rows = await readAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'DELETE',
      record_id: id,
      old_value: { id, name: 'alpha' },
      new_value: null,
    });
  });

  it('writes one INSERT row per item on bulk create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${PREFIX}/bulk`,
      payload: { items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] },
    });
    expect(res.statusCode).toBe(201);
    const created = (res.json() as { data: { id: string; name: string }[] })
      .data;
    const rows = await readAudit();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.action === 'INSERT')).toBe(true);
    expect(new Set(rows.map((r) => r.record_id))).toEqual(
      new Set(created.map((c) => c.id)),
    );
    for (const c of created) {
      const match = rows.find((r) => r.record_id === c.id);
      expect(match?.new_value).toMatchObject({ name: c.name });
      expect(match?.old_value).toBeNull();
    }
  });

  it('writes one DELETE row per affected row on bulk delete', async () => {
    const a = await createWidget('a');
    const b = await createWidget('b');
    await db.delete(auditLogs);
    const res = await app.inject({
      method: 'DELETE',
      url: `${PREFIX}/bulk`,
      payload: { ids: [a, b] },
    });
    expect(res.statusCode).toBe(204);
    const rows = await readAudit();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.action === 'DELETE')).toBe(true);
    expect(new Set(rows.map((r) => r.record_id))).toEqual(new Set([a, b]));
    expect(rows.every((r) => r.new_value === null)).toBe(true);
  });

  it('records the request actor when present', async () => {
    await runWithUserId('auditor@example.com', async () => {
      await app.inject({
        method: 'POST',
        url: PREFIX,
        payload: { name: 'tracked' },
      });
    });
    const rows = await readAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0].performed_by).toBe('auditor@example.com');
  });

  it('never audits the audit_logs table itself', async () => {
    const app2 = Fastify({ logger: false });
    app2.decorate('db', db);
    await app2.register(
      async (instance) => {
        registerEntityRoutes(instance, {
          name: 'AuditLog',
          apiPrefix: '/audit',
          tag: 'audit',
          table: auditLogs,
        });
      },
      { prefix: '/audit' },
    );
    await app2.ready();
    const res = await app2.inject({
      method: 'POST',
      url: '/audit',
      payload: {
        tableName: 'x',
        recordId: 'y',
        action: 'INSERT',
        performedBy: 'system',
      },
    });
    expect(res.statusCode).toBe(201);
    const inserted = res.json() as { id: string };
    const rows = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(eq(auditLogs.id, inserted.id));
    expect(rows).toHaveLength(1);
    const total = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs);
    expect(Number(total[0].count)).toBe(1);
    await app2.close();
  });
});
