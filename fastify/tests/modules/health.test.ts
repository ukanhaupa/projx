import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/app.js';

describe('Health endpoint', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /api/health returns healthy status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('healthy');
    expect(body.checks.app).toBe('ok');
    expect(body.checks.database).toBe('ok');
  });

  it('GET /api/health/live returns healthy without touching the database', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health/live' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('healthy');
    expect(body.checks).toBeUndefined();
  });

  it('GET /api/health/ready reports database readiness', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health/ready' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('healthy');
    expect(body.checks.database).toBe('ok');
  });
});
