import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';

describe('rate limit', () => {
  it('returns 429 once the per-window quota is exceeded', async () => {
    const app = Fastify({ trustProxy: true });
    await app.register(rateLimit, { max: 3, timeWindow: '1 minute' });
    app.get('/ping', async () => ({ ok: true }));

    const headers = { 'x-forwarded-for': '203.0.113.1' };
    for (let i = 0; i < 3; i++) {
      const ok = await app.inject({ method: 'GET', url: '/ping', headers });
      expect(ok.statusCode).toBe(200);
    }
    const blocked = await app.inject({ method: 'GET', url: '/ping', headers });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({
      statusCode: 429,
      error: expect.stringMatching(/Too Many Requests/i),
    });

    await app.close();
  });

  it('keys per-IP so different clients have independent quotas', async () => {
    const app = Fastify({ trustProxy: true });
    await app.register(rateLimit, { max: 3, timeWindow: '1 minute' });
    app.get('/ping', async () => ({ ok: true }));

    const ipA = { 'x-forwarded-for': '203.0.113.10' };
    const ipB = { 'x-forwarded-for': '203.0.113.11' };
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'GET', url: '/ping', headers: ipA });
    }
    const blockedA = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: ipA,
    });
    expect(blockedA.statusCode).toBe(429);
    const okB = await app.inject({ method: 'GET', url: '/ping', headers: ipB });
    expect(okB.statusCode).toBe(200);

    await app.close();
  });

  it('app.ts wires the rate-limit plugin into buildApp', async () => {
    const { buildApp } = await import('../../src/app.js');
    const app = await buildApp({ logger: false });
    expect(app.hasDecorator('rateLimit')).toBe(true);
    await app.close();
  });
});
