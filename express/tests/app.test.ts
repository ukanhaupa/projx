import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('Express app', () => {
  it('returns health status', async () => {
    const res = await request(buildApp()).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'healthy', checks: { app: 'ok' } });
  });

  it('propagates a caller request id', async () => {
    const res = await request(buildApp())
      .get('/api/health')
      .set('x-request-id', 'req-test');

    expect(res.headers['x-request-id']).toBe('req-test');
  });

  it('returns structured errors with request id', async () => {
    const res = await request(buildApp())
      .get('/missing')
      .set('x-request-id', 'req-missing');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({
      code: 'not_found',
      request_id: 'req-missing',
    });
  });

  it('exposes entity metadata', async () => {
    const res = await request(buildApp()).get('/api/v1/_meta');

    expect(res.status).toBe(200);
    expect(res.body.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'AuditLog',
          table_name: 'audit_logs',
          api_prefix: '/audit-logs',
        }),
      ]),
    );
  });
});
