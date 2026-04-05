import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './app.js';

export interface CrudTestConfig {
  entityName: string;
  basePath: string;
  createPayload: Record<string, unknown>;
  updatePayload: Record<string, unknown>;
  uniqueField?: string;
  prismaModel: string;
}

export function describeCrudEntity(config: CrudTestConfig) {
  describe(config.entityName, () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      app = await buildTestApp();
      const model = (app.prisma as unknown as Record<string, { deleteMany: () => Promise<void> }>)[
        config.prismaModel.charAt(0).toLowerCase() + config.prismaModel.slice(1)
      ];
      await model.deleteMany();
    });

    afterAll(async () => {
      if (app) await app.close();
    });

    it(`GET ${config.basePath} returns empty list`, async () => {
      const res = await app.inject({ method: 'GET', url: config.basePath });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toEqual([]);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.current_page).toBe(1);
      expect(body.pagination.total_records).toBe(0);
    });

    it(`POST ${config.basePath} creates a record`, async () => {
      const res = await app.inject({
        method: 'POST',
        url: config.basePath,
        payload: config.createPayload,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      for (const [key, value] of Object.entries(config.createPayload)) {
        expect(body[key]).toBe(value);
      }
    });

    it(`GET ${config.basePath}/:id returns the record`, async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: config.basePath,
        payload: config.createPayload,
      });
      const created = createRes.json();

      const res = await app.inject({
        method: 'GET',
        url: `${config.basePath}/${created.id}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(created.id);
    });

    it(`GET ${config.basePath}/:id returns 404 for non-existent`, async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${config.basePath}/00000000-0000-0000-0000-000000000000`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().detail).toBeDefined();
    });

    it(`PATCH ${config.basePath}/:id updates the record`, async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: config.basePath,
        payload: config.createPayload,
      });
      const created = createRes.json();

      const res = await app.inject({
        method: 'PATCH',
        url: `${config.basePath}/${created.id}`,
        payload: config.updatePayload,
      });
      expect(res.statusCode).toBe(200);
      for (const [key, value] of Object.entries(config.updatePayload)) {
        expect(res.json()[key]).toBe(value);
      }
    });

    it(`PATCH ${config.basePath}/:id returns 404 for non-existent`, async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${config.basePath}/00000000-0000-0000-0000-000000000000`,
        payload: config.updatePayload,
      });
      expect(res.statusCode).toBe(404);
    });

    it(`DELETE ${config.basePath}/:id removes the record`, async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: config.basePath,
        payload: config.createPayload,
      });
      const created = createRes.json();

      const res = await app.inject({
        method: 'DELETE',
        url: `${config.basePath}/${created.id}`,
      });
      expect(res.statusCode).toBe(204);

      const getRes = await app.inject({
        method: 'GET',
        url: `${config.basePath}/${created.id}`,
      });
      expect(getRes.statusCode).toBe(404);
    });

    it(`DELETE ${config.basePath}/:id returns 404 for non-existent`, async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `${config.basePath}/00000000-0000-0000-0000-000000000000`,
      });
      expect(res.statusCode).toBe(404);
    });

    it(`GET ${config.basePath} supports pagination`, async () => {
      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: 'POST',
          url: config.basePath,
          payload: {
            ...config.createPayload,
            ...(config.uniqueField
              ? { [config.uniqueField]: `${config.createPayload[config.uniqueField]}-${i}` }
              : {}),
          },
        });
      }

      const res = await app.inject({
        method: 'GET',
        url: `${config.basePath}?page=1&page_size=2`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(2);
      expect(body.pagination.total_records).toBe(3);
      expect(body.pagination.total_pages).toBe(2);
    });

    it(`GET ${config.basePath} supports sorting`, async () => {
      await app.inject({
        method: 'POST',
        url: config.basePath,
        payload: config.createPayload,
      });

      const res = await app.inject({
        method: 'GET',
        url: `${config.basePath}?order_by=-created_at`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThan(0);
    });

    if (config.uniqueField) {
      it(`POST ${config.basePath} duplicate returns 409`, async () => {
        await app.inject({
          method: 'POST',
          url: config.basePath,
          payload: config.createPayload,
        });

        const res = await app.inject({
          method: 'POST',
          url: config.basePath,
          payload: config.createPayload,
        });
        expect(res.statusCode).toBe(409);
        expect(res.json().detail).toBeDefined();
      });
    }
  });
}
