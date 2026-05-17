import { describe, expect, it, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';

describe('Fastify Drizzle app', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('does not expose /api/v1/_meta', async () => {
    app = await buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/v1/_meta' });

    expect(res.statusCode).toBe(404);
  });
});
