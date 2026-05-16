import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { eq, inArray, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { DbClient } from '../../db/client.js';
import { ApiError } from '../../errors.js';
import { registerInRegistry } from './registry.js';
import {
  buildOrderBy,
  buildPagination,
  buildSearchWhere,
  buildWhere,
  combineWhere,
  parseRawQuery,
} from './query-engine.js';

export type BeforeCreateHook = (
  request: Request,
  data: Record<string, unknown>,
) => void | Promise<void>;
export type AfterCreateHook = (
  request: Request,
  record: Record<string, unknown>,
) => void | Promise<void>;
export type BeforeUpdateHook = (
  request: Request,
  response: Response,
  data: Record<string, unknown>,
) => void | Promise<void>;
export type AfterUpdateHook = (
  request: Request,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) => void | Promise<void>;
export type BeforeDeleteHook = (
  request: Request,
  recordId: string,
) => void | Promise<void>;

export interface DrizzleEntityConfig {
  name: string;
  apiPrefix: string;
  tag: string;
  table: PgTable;
  primaryKey?: string;
  searchableFields?: string[];
  readonly?: boolean;
  bulkOperations?: boolean;
  beforeCreate?: BeforeCreateHook;
  afterCreate?: AfterCreateHook;
  beforeUpdate?: BeforeUpdateHook;
  afterUpdate?: AfterUpdateHook;
  beforeDelete?: BeforeDeleteHook;
}

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

function asyncHandler(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}

function column(table: PgTable, key: string): unknown {
  return (table as unknown as Record<string, unknown>)[key];
}

function pkColumn(config: DrizzleEntityConfig): unknown {
  const key = config.primaryKey ?? 'id';
  const col = column(config.table, key);
  if (!col) {
    throw new Error(
      `Primary key column "${key}" not found on table ${config.name}`,
    );
  }
  return col;
}

export function registerEntityRoutes(
  config: DrizzleEntityConfig,
  db: DbClient,
): express.Router {
  registerInRegistry({ name: config.name, apiPrefix: config.apiPrefix });
  const router = express.Router();
  const pk = pkColumn(config) as Parameters<typeof eq>[0];

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rawQs = req.originalUrl.split('?')[1] ?? '';
      const query = parseRawQuery(rawQs);
      const filterWhere = buildWhere(config.table, query.filters);
      const searchWhere = buildSearchWhere(
        config.table,
        config.searchableFields ?? [],
        query.search,
      );
      const where = combineWhere(filterWhere, searchWhere);
      const order = buildOrderBy(config.table, query.order_by);
      const offset = (query.page - 1) * query.page_size;

      const baseSelect = db.select().from(config.table);
      const baseCount = db
        .select({ count: sql<number>`count(*)::int` })
        .from(config.table);

      const rows = await (where
        ? baseSelect
            .where(where)
            .orderBy(...order)
            .limit(query.page_size)
            .offset(offset)
        : baseSelect
            .orderBy(...order)
            .limit(query.page_size)
            .offset(offset));
      const [{ count }] = await (where ? baseCount.where(where) : baseCount);

      res.json({
        data: rows,
        pagination: buildPagination(query.page, query.page_size, Number(count)),
      });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const [record] = await db
        .select()
        .from(config.table)
        .where(eq(pk, String(req.params.id)))
        .limit(1);
      if (!record) throw new ApiError(404, 'Not found', 'not_found');
      res.json(record);
    }),
  );

  if (config.readonly) return router;

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const data = req.body as Record<string, unknown>;
      await config.beforeCreate?.(req, data);
      const [record] = await db
        .insert(config.table)
        .values(data as never)
        .returning();
      if (config.afterCreate) {
        try {
          await config.afterCreate(req, record as Record<string, unknown>);
        } catch (err) {
          req.log?.error?.(
            {
              err,
              entity: config.name,
              record_id: (record as { id?: string }).id,
            },
            'afterCreate hook failed (record persisted; hook is best-effort)',
          );
        }
      }
      res.status(201).json(record);
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const data = req.body as Record<string, unknown>;
      if (!data || Object.keys(data).length === 0) {
        throw new ApiError(400, 'Request body cannot be empty', 'empty_body');
      }
      if (config.beforeUpdate) {
        await config.beforeUpdate(req, res, data);
        if (res.headersSent) return;
      }
      let before: Record<string, unknown> | null = null;
      if (config.afterUpdate) {
        const [existing] = await db
          .select()
          .from(config.table)
          .where(eq(pk, id))
          .limit(1);
        before = (existing as Record<string, unknown>) ?? null;
      }
      const [record] = await db
        .update(config.table)
        .set(data as never)
        .where(eq(pk, id))
        .returning();
      if (!record) throw new ApiError(404, 'Not found', 'not_found');
      if (config.afterUpdate && before) {
        try {
          await config.afterUpdate(
            req,
            before,
            record as Record<string, unknown>,
          );
        } catch (err) {
          req.log?.error?.(
            { err, entity: config.name, record_id: id },
            'afterUpdate hook failed (record persisted; hook is best-effort)',
          );
        }
      }
      res.json(record);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      if (config.beforeDelete) await config.beforeDelete(req, id);
      const deleted = await db
        .delete(config.table)
        .where(eq(pk, id))
        .returning();
      if (deleted.length === 0)
        throw new ApiError(404, 'Not found', 'not_found');
      res.status(204).send();
    }),
  );

  if (!config.bulkOperations) return router;

  router.post(
    '/bulk',
    asyncHandler(async (req, res) => {
      const { items } = req.body as { items: Record<string, unknown>[] };
      if (!Array.isArray(items) || items.length === 0) {
        throw new ApiError(
          400,
          'items must be a non-empty array',
          'validation_error',
        );
      }
      for (const item of items) {
        await config.beforeCreate?.(req, item);
      }
      const rows = await db
        .insert(config.table)
        .values(items as never)
        .returning();
      res.status(201).json({ data: rows, count: rows.length });
    }),
  );

  router.delete(
    '/bulk',
    asyncHandler(async (req, res) => {
      const { ids } = req.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new ApiError(
          400,
          'ids must be a non-empty array',
          'validation_error',
        );
      }
      await db
        .delete(config.table)
        .where(inArray(pk as Parameters<typeof inArray>[0], ids));
      res.status(204).send();
    }),
  );

  return router;
}
