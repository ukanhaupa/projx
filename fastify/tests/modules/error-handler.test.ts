import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import errorHandler from '../../src/plugins/error-handler.js';
import { NotFoundError, BusinessRuleError } from '../../src/errors.js';

describe('Error Handler Plugin', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(errorHandler);

    app.get('/p2002', async () => {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.0.0',
        meta: { target: ['email'] },
      });
    });

    app.get('/p2003', async () => {
      throw new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
        code: 'P2003',
        clientVersion: '6.0.0',
        meta: { field_name: 'category_id' },
      });
    });

    app.get('/p2025', async () => {
      throw new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '6.0.0',
        meta: {},
      });
    });

    app.get('/not-found', async () => {
      throw new NotFoundError('User', 'abc-123');
    });

    app.get('/business-rule', async () => {
      throw new BusinessRuleError('Cannot delete a shipped order');
    });

    app.get('/unexpected', async () => {
      throw new Error('something broke');
    });

    app.post(
      '/validation',
      {
        schema: {
          body: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } },
          },
        },
      },
      async () => ({ ok: true }),
    );

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('P2002 unique constraint → 409', async () => {
    const res = await app.inject({ method: 'GET', url: '/p2002' });
    expect(res.statusCode).toBe(409);
    expect(res.json().detail).toContain('already exists');
    expect(res.json().detail).toContain('email');
    expect(res.json().request_id).toBeDefined();
  });

  it('P2003 FK constraint → 409', async () => {
    const res = await app.inject({ method: 'GET', url: '/p2003' });
    expect(res.statusCode).toBe(409);
    expect(res.json().detail).toContain('referenced');
    expect(res.json().request_id).toBeDefined();
  });

  it('P2025 record not found → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/p2025' });
    expect(res.statusCode).toBe(404);
    expect(res.json().detail).toBe('Record not found');
    expect(res.json().request_id).toBeDefined();
  });

  it('NotFoundError → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/not-found' });
    expect(res.statusCode).toBe(404);
    expect(res.json().detail).toContain('User');
    expect(res.json().request_id).toBeDefined();
  });

  it('BusinessRuleError → 422', async () => {
    const res = await app.inject({ method: 'GET', url: '/business-rule' });
    expect(res.statusCode).toBe(422);
    expect(res.json().detail).toBe('Cannot delete a shipped order');
    expect(res.json().request_id).toBeDefined();
  });

  it('unexpected error → 500', async () => {
    const res = await app.inject({ method: 'GET', url: '/unexpected' });
    expect(res.statusCode).toBe(500);
    expect(res.json().detail).toBe('Internal server error');
    expect(res.json().request_id).toBeDefined();
  });

  it('schema validation → 400 with detail/request_id shape', async () => {
    const res = await app.inject({ method: 'POST', url: '/validation', payload: {} });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.detail).toBeDefined();
    expect(body.request_id).toBeDefined();
    expect(body.statusCode).toBeUndefined();
    expect(body.error).toBeUndefined();
    expect(body.message).toBeUndefined();
  });
});
