import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { __ENTITY_PASCAL__ } from '../../src/entities/__ENTITY_KEBAB__.js';
import { dataSource } from '../../src/db/data-source.js';

describe('__ENTITY_PASCAL__ CRUD', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await dataSource.synchronize(true);
    await app.ready();
  });

  beforeEach(async () => {
    await dataSource.getRepository(__ENTITY_PASCAL__).clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST creates a record', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1__API_PREFIX__',
      payload: __SAMPLE_PAYLOAD__,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject(__SAMPLE_PAYLOAD__);
  });

  it('GET / lists records with pagination', async () => {
    await app.inject({ method: 'POST', url: '/api/v1__API_PREFIX__', payload: __SAMPLE_PAYLOAD__ });
    const res = await app.inject({ method: 'GET', url: '/api/v1__API_PREFIX__' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toMatchObject({ current_page: 1, total_records: 1 });
  });

  it('GET /:id returns one record', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1__API_PREFIX__',
      payload: __SAMPLE_PAYLOAD__,
    });
    const { id } = created.json() as { id: string };
    const res = await app.inject({ method: 'GET', url: `/api/v1__API_PREFIX__/${id}` });
    expect(res.statusCode).toBe(200);
  });

  it('GET /:id returns 404 when not found', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1__API_PREFIX__/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /:id updates a record', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1__API_PREFIX__',
      payload: __SAMPLE_PAYLOAD__,
    });
    const { id } = created.json() as { id: string };
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1__API_PREFIX__/${id}`,
      payload: __UPDATE_PAYLOAD__,
    });
    expect(res.statusCode).toBe(200);
  });

  it('DELETE /:id removes a record', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1__API_PREFIX__',
      payload: __SAMPLE_PAYLOAD__,
    });
    const { id } = created.json() as { id: string };
    const del = await app.inject({ method: 'DELETE', url: `/api/v1__API_PREFIX__/${id}` });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: `/api/v1__API_PREFIX__/${id}` });
    expect(get.statusCode).toBe(404);
  });
});
