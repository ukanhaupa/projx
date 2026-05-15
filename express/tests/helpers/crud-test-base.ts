import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { z } from 'zod';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/prisma.js';

export interface CrudTestConfig {
  entityName: string;
  basePath: string;
  createPayload?: Record<string, unknown>;
  createSchema?: z.ZodObject<Record<string, z.ZodType>>;
  payloadOverrides?: Record<string, unknown>;
  updatePayload: Record<string, unknown>;
  uniqueField?: string;
  uniqueFields?: string[];
  prismaModel: string;
}

type SchemaDef = {
  type?: string;
  checks?: Array<{ def?: { check?: string; format?: string } }>;
  innerType?: { def?: SchemaDef };
  shape?: Record<string, { def?: SchemaDef }>;
};

type ModelDelegate = {
  deleteMany: () => Promise<unknown>;
};

function formatOf(def: SchemaDef): string | undefined {
  return def.checks?.map((check) => check.def).find((defn) => defn?.format)?.format;
}

function defaultValueFor(key: string, def: SchemaDef): unknown {
  if (def.type === 'optional' || def.type === 'nullable') {
    return defaultValueFor(key, def.innerType?.def ?? {});
  }
  if (def.type === 'string') {
    const format = formatOf(def);
    if (format === 'uuid') return crypto.randomUUID();
    if (format === 'datetime') return '2030-01-01T00:00:00.000Z';
    if (format === 'date') return '2030-01-01';
    return `test-${key.replaceAll('_', '-')}`;
  }
  if (def.type === 'number') return 1;
  if (def.type === 'boolean') return false;
  if (def.type === 'array') return [];
  if (def.type === 'object') return {};
  return null;
}

export function buildCreatePayload(
  createSchema: z.ZodObject<Record<string, z.ZodType>>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const shape = createSchema.shape;
  const payload: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(shape)) {
    payload[key] = defaultValueFor(key, (schema as unknown as { def?: SchemaDef }).def ?? {});
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
    const app = buildApp();
    const createPayload =
      config.createPayload ??
      (config.createSchema
        ? buildCreatePayload(config.createSchema, config.payloadOverrides)
        : undefined);
    if (!createPayload) {
      throw new Error(`${config.entityName}: createPayload or createSchema is required`);
    }
    const uniqueFields = resolveUniqueFields(config);

    beforeEach(async () => {
      const delegate = (prisma as unknown as Record<string, ModelDelegate>)[
        config.prismaModel.charAt(0).toLowerCase() + config.prismaModel.slice(1)
      ];
      await delegate.deleteMany();
    });

    afterAll(async () => {
      await prisma.$disconnect?.();
    });

    it(`GET ${config.basePath} returns empty list`, async () => {
      const res = await request(app).get(config.basePath);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.current_page).toBe(1);
      expect(res.body.pagination.total_records).toBe(0);
    });

    it(`POST ${config.basePath} creates a record`, async () => {
      const res = await request(app).post(config.basePath).send(createPayload);
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      for (const [key, value] of Object.entries(createPayload)) {
        expect(res.body[key]).toBe(value);
      }
    });

    it(`GET ${config.basePath}/:id returns the record`, async () => {
      const created = await request(app).post(config.basePath).send(createPayload);
      const res = await request(app).get(`${config.basePath}/${created.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(created.body.id);
    });

    it(`PATCH ${config.basePath}/:id updates the record`, async () => {
      const created = await request(app).post(config.basePath).send(createPayload);
      const res = await request(app)
        .patch(`${config.basePath}/${created.body.id}`)
        .send(config.updatePayload);
      expect(res.status).toBe(200);
      for (const [key, value] of Object.entries(config.updatePayload)) {
        expect(res.body[key]).toBe(value);
      }
    });

    it(`DELETE ${config.basePath}/:id removes the record`, async () => {
      const created = await request(app).post(config.basePath).send(createPayload);
      const res = await request(app).delete(`${config.basePath}/${created.body.id}`);
      expect(res.status).toBe(204);
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

        const first = await request(app).post(config.basePath).send(firstPayload);
        expect(first.status).toBe(201);

        const second = await request(app).post(config.basePath).send(secondPayload);
        expect(second.status).toBe(409);
        expect(second.body.error.code).toBe('conflict');
      });
    }
  });
}
