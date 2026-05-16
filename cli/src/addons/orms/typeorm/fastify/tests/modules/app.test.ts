import { describe, expect, it, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';

describe('Fastify TypeORM app', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('exposes empty generated metadata until entities are added', async () => {
    app = await buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/v1/_meta' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ entities: [], orm: 'typeorm' });
  });
});
