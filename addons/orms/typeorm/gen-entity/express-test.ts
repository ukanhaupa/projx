import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { __ENTITY_PASCAL__ } from '../src/entities/__ENTITY_KEBAB__.js';
import { dataSource, closeDatabase } from '../src/db/data-source.js';

const app = buildApp();

describe('__ENTITY_PASCAL__ CRUD', () => {
  beforeAll(async () => {
    if (!dataSource.isInitialized) await dataSource.initialize();
    await dataSource.synchronize(true);
  });

  beforeEach(async () => {
    await dataSource.getRepository(__ENTITY_PASCAL__).clear();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('POST creates a record', async () => {
    const res = await request(app).post('/api/v1__API_PREFIX__').send(__SAMPLE_PAYLOAD__);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject(__SAMPLE_PAYLOAD__);
  });

  it('GET / lists records with pagination', async () => {
    await request(app).post('/api/v1__API_PREFIX__').send(__SAMPLE_PAYLOAD__);
    const res = await request(app).get('/api/v1__API_PREFIX__');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ current_page: 1, total_records: 1 });
  });

  it('GET /:id returns one record', async () => {
    const created = await request(app).post('/api/v1__API_PREFIX__').send(__SAMPLE_PAYLOAD__);
    const { id } = created.body as { id: string };
    const res = await request(app).get(`/api/v1__API_PREFIX__/${id}`);
    expect(res.status).toBe(200);
  });

  it('GET /:id returns 404 when not found', async () => {
    const res = await request(app).get(
      '/api/v1__API_PREFIX__/00000000-0000-0000-0000-000000000000',
    );
    expect(res.status).toBe(404);
  });

  it('PATCH /:id updates a record', async () => {
    const created = await request(app).post('/api/v1__API_PREFIX__').send(__SAMPLE_PAYLOAD__);
    const { id } = created.body as { id: string };
    const res = await request(app).patch(`/api/v1__API_PREFIX__/${id}`).send(__UPDATE_PAYLOAD__);
    expect(res.status).toBe(200);
  });

  it('DELETE /:id removes a record', async () => {
    const created = await request(app).post('/api/v1__API_PREFIX__').send(__SAMPLE_PAYLOAD__);
    const { id } = created.body as { id: string };
    const del = await request(app).delete(`/api/v1__API_PREFIX__/${id}`);
    expect(del.status).toBe(204);
    const get = await request(app).get(`/api/v1__API_PREFIX__/${id}`);
    expect(get.status).toBe(404);
  });
});
