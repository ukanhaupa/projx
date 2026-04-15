import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, superuserHeaders } from '../helpers/app.js';

describe('AuditLogs (readonly)', () => {
  let app: FastifyInstance;
  let headers: Record<string, string>;

  beforeEach(async () => {
    app = await buildTestApp();
    headers = superuserHeaders(app);
    await app.prisma.auditLog.deleteMany();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /api/v1/audit-logs returns empty list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual([]);
    expect(body.pagination.total_records).toBe(0);
  });

  it('GET /api/v1/audit-logs/:id returns 404 when not found', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs/00000000-0000-0000-0000-000000000000',
      headers,
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/v1/audit-logs returns seeded records', async () => {
    await app.prisma.auditLog.create({
      data: {
        table_name: 'products',
        record_id: '123',
        action: 'INSERT',
        performed_by: 'test-user',
        new_value: { name: 'Test' },
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].action).toBe('INSERT');
  });

  it('POST /api/v1/audit-logs is not available (readonly)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/audit-logs',
      headers,
      payload: {
        table_name: 'test',
        record_id: '1',
        action: 'INSERT',
        performed_by: 'test',
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/v1/audit-logs/:id is not available (readonly)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/audit-logs/00000000-0000-0000-0000-000000000000',
      headers,
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /api/v1/audit-logs/:id is not available (readonly)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/audit-logs/00000000-0000-0000-0000-000000000000',
      headers,
      payload: { action: 'UPDATE' },
    });
    expect(res.statusCode).toBe(404);
  });
});
