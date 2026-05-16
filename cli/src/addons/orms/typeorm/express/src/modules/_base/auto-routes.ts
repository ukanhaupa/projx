import express, { type NextFunction, type Request, type Response } from 'express';
import type { EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { dataSource } from '../../db/data-source.js';
import { ApiError } from '../../errors.js';
import { registerInRegistry } from './registry.js';
import {
  buildOrder,
  buildPagination,
  buildSearchWheres,
  buildWhere,
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

export interface TypeormEntityConfig<T extends ObjectLiteral> {
  name: string;
  apiPrefix: string;
  tag: string;
  entity: EntityTarget<T>;
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

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}

function columnNames<T extends ObjectLiteral>(repo: Repository<T>): Set<string> {
  return new Set(repo.metadata.columns.map((c) => c.propertyName));
}

export function registerEntityRoutes<T extends ObjectLiteral>(
  config: TypeormEntityConfig<T>,
): express.Router {
  registerInRegistry({ name: config.name, apiPrefix: config.apiPrefix });
  const router = express.Router();
  const pk = config.primaryKey ?? 'id';

  function repo(): Repository<T> {
    return dataSource.getRepository(config.entity);
  }

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rawQs = req.originalUrl.split('?')[1] ?? '';
      const query = parseRawQuery(rawQs);
      const r = repo();
      const cols = columnNames(r);
      const filterWhere = buildWhere<T>(cols, query.filters);
      const searchWheres = buildSearchWheres<T>(config.searchableFields ?? [], query.search);
      const where =
        searchWheres.length > 0 ? searchWheres.map((s) => ({ ...filterWhere, ...s })) : filterWhere;
      const order = buildOrder<T>(cols, query.order_by);
      const [rows, count] = await r.findAndCount({
        where,
        order,
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      });
      res.json({
        data: rows,
        pagination: buildPagination(query.page, query.page_size, count),
      });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const record = await repo().findOne({ where: { [pk]: String(req.params.id) } as never });
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
      const r = repo();
      const entity = r.create(data as never);
      const record = (await r.save(entity)) as Record<string, unknown>;
      if (config.afterCreate) {
        try {
          await config.afterCreate(req, record);
        } catch (err) {
          req.log?.error?.(
            { err, entity: config.name, record_id: (record as { id?: string }).id },
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
      const r = repo();
      const existing = await r.findOne({ where: { [pk]: id } as never });
      if (!existing) throw new ApiError(404, 'Not found', 'not_found');
      const before = { ...(existing as Record<string, unknown>) };
      Object.assign(existing, data);
      const saved = (await r.save(existing)) as Record<string, unknown>;
      if (config.afterUpdate) {
        try {
          await config.afterUpdate(req, before, saved);
        } catch (err) {
          req.log?.error?.(
            { err, entity: config.name, record_id: id },
            'afterUpdate hook failed (record persisted; hook is best-effort)',
          );
        }
      }
      res.json(saved);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      if (config.beforeDelete) await config.beforeDelete(req, id);
      const result = await repo().delete({ [pk]: id } as never);
      if (!result.affected) throw new ApiError(404, 'Not found', 'not_found');
      res.status(204).send();
    }),
  );

  if (!config.bulkOperations) return router;

  router.post(
    '/bulk',
    asyncHandler(async (req, res) => {
      const { items } = req.body as { items: Record<string, unknown>[] };
      if (!Array.isArray(items) || items.length === 0) {
        throw new ApiError(400, 'items must be a non-empty array', 'validation_error');
      }
      for (const item of items) {
        await config.beforeCreate?.(req, item);
      }
      const r = repo();
      const entities = r.create(items as never);
      const rows = (await r.save(entities)) as unknown as Record<string, unknown>[];
      res.status(201).json({ data: rows, count: rows.length });
    }),
  );

  router.delete(
    '/bulk',
    asyncHandler(async (req, res) => {
      const { ids } = req.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new ApiError(400, 'ids must be a non-empty array', 'validation_error');
      }
      await repo().delete(ids as never);
      res.status(204).send();
    }),
  );

  return router;
}
