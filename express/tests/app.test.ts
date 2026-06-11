import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

function authHeader(): string {
  const token = jwt.sign(
    { sub: 'app-test-user', permissions: [] },
    process.env.JWT_SECRET as string,
  );
  return `Bearer ${token}`;
}

describe('Express app', () => {
  it('reports liveness without touching the database', async () => {
    const res = await request(buildApp()).get('/api/health/live');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'healthy' });
  });

  it('propagates a caller request id', async () => {
    const res = await request(buildApp())
      .get('/api/health/live')
      .set('x-request-id', 'req-test');

    expect(res.headers['x-request-id']).toBe('req-test');
  });

  it('returns structured errors with request id', async () => {
    const res = await request(buildApp())
      .get('/missing')
      .set('authorization', authHeader())
      .set('x-request-id', 'req-missing');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      code: 'not_found',
      request_id: 'req-missing',
    });
  });

  it('rejects unknown paths without credentials', async () => {
    const res = await request(buildApp())
      .get('/missing')
      .set('x-request-id', 'req-unauthed');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      code: 'unauthorized',
      request_id: 'req-unauthed',
    });
  });

  it('builds the rate limiter without IPv6 keyGenerator validation errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      buildApp();
      const flagged = errorSpy.mock.calls
        .flat()
        .some((arg) => String(arg).includes('ipKeyGenerator'));
      expect(flagged).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not expose /api/v1/_meta', async () => {
    const res = await request(buildApp())
      .get('/api/v1/_meta')
      .set('authorization', authHeader());

    expect(res.status).toBe(404);
  });
});
