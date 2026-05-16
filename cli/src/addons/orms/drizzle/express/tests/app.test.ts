import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('Express Drizzle app', () => {
  it('exposes empty generated metadata until entities are added', async () => {
    const res = await request(buildApp()).get('/api/v1/_meta');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entities: [], orm: 'drizzle' });
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
