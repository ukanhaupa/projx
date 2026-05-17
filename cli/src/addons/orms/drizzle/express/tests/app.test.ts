import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('Express Drizzle app', () => {
  it('does not expose /api/v1/_meta', async () => {
    const res = await request(buildApp()).get('/api/v1/_meta');

    expect(res.status).toBe(404);
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
});
