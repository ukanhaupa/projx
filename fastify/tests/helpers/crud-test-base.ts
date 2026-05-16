import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { TObject, TProperties } from '@sinclair/typebox';
import { buildTestApp } from './app.js';

export interface CrudTestConfig {
  entityName: string;
  basePath: string;
  createPayload?: Record<string, unknown>;
  createSchema?: TObject<TProperties>;
  payloadOverrides?: Record<string, unknown>;
  updatePayload: Record<string, unknown>;
  uniqueField?: string;
  uniqueFields?: string[];
  prismaModel: string;
}

type SchemaLike = {
  type?: string;
  format?: string;
  properties?: Record<string, SchemaLike>;
  anyOf?: SchemaLike[];
  items?: SchemaLike;
  default?: unknown;
};

function defaultValueFor(key: string, schema: SchemaLike): unknown {
  if (schema.default !== undefined) return schema.default;
  const union = schema.anyOf?.find((item) => item.type !== 'null');
  if (union) return defaultValueFor(key, union);

  switch (schema.type) {
    case 'string':
      if (schema.format === 'uuid') return crypto.randomUUID();
      if (schema.format === 'date-time') return '2030-01-01T00:00:00.000Z';
      if (schema.format === 'date') return '2030-01-01';
      return `test-${key.replaceAll('_', '-')}`;
    case 'integer':
    case 'number':
      return 1;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return null;
  }
}

export function buildCreatePayload(
  createSchema: TObject<TProperties>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const properties = (
    createSchema as unknown as { properties?: Record<string, SchemaLike> }
  ).properties;
  if (!properties) return { ...overrides };

  const payload: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(properties)) {
    payload[key] = defaultValueFor(key, schema);
  }
  return { ...payload, ...overrides };
}

export function resolveUniqueFields(
  config: Pick<CrudTestConfig, 'uniqueField' | 'uniqueFields'>,
): string[] {
  return [
    ...new Set([
      ...(config.uniqueField ? [config.uniqueField] : []),
      ...(config.uniqueFields ?? []),
    ]),
  ];
}

export function describeCrudEntity(config: CrudTestConfig) {
  describe(config.entityName, () => {
    let app: FastifyInstance;
    const createPayload =
      config.createPayload ??
      (config.createSchema
        ? buildCreatePayload(config.createSchema, config.payloadOverrides)
        : undefined);
    if (!createPayload) {
      throw new Error(
        `${config.entityName}: createPayload or createSchema is required`,
      );
    }
    const uniqueFields = resolveUniqueFields(config);

    beforeEach(async () => {
      app = await buildTestApp();
      const model = (
        app.prisma as unknown as Record<
          string,
          { deleteMany: () => Promise<void> }
        >
      )[
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
        payload: createPayload,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      for (const [key, value] of Object.entries(createPayload)) {
        expect(body[key]).toBe(value);
      }
    });

    it(`GET ${config.basePath}/:id returns the record`, async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: config.basePath,
        payload: createPayload,
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
        payload: createPayload,
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
        payload: createPayload,
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
            ...Object.fromEntries(
              uniqueFields.map((field) => [
                field,
                `${createPayload[field]}-${i}`,
              ]),
            ),
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
        payload: createPayload,
      });

      const res = await app.inject({
        method: 'GET',
        url: `${config.basePath}?order_by=-created_at`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThan(0);
    });

    for (const uniqueField of uniqueFields) {
      it(`POST ${config.basePath} duplicate ${uniqueField} returns 409`, async () => {
        const firstPayload = { ...createPayload };
        const secondPayload = {
          ...createPayload,
          ...Object.fromEntries(
            uniqueFields
              .filter((field) => field !== uniqueField)
              .map((field) => [field, `${createPayload[field]}-duplicate`]),
          ),
        };

        await app.inject({
          method: 'POST',
          url: config.basePath,
          payload: firstPayload,
        });

        const res = await app.inject({
          method: 'POST',
          url: config.basePath,
          payload: secondPayload,
        });
        expect(res.statusCode).toBe(409);
        expect(res.json().detail).toBeDefined();
      });
    }
  });
}
