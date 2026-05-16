import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import type { Model, ModelStatic } from 'sequelize';
import { ApiError } from '../../errors.js';
import { registerInRegistry } from './registry.js';
import {
  buildOrder,
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

export interface SequelizeEntityConfig {
  name: string;
  apiPrefix: string;
  tag: string;
  model: ModelStatic<Model>;
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

function attributes(model: ModelStatic<Model>): Set<string> {
  return new Set(Object.keys(model.getAttributes()));
}

export function registerEntityRoutes(
  config: SequelizeEntityConfig,
): express.Router {
  registerInRegistry({ name: config.name, apiPrefix: config.apiPrefix });
  const router = express.Router();
  const pk = config.primaryKey ?? 'id';
  const attrs = attributes(config.model);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rawQs = req.originalUrl.split('?')[1] ?? '';
      const query = parseRawQuery(rawQs);
      const filterWhere = buildWhere(attrs, query.filters);
      const searchWhere = buildSearchWhere(
        config.searchableFields ?? [],
        query.search,
      );
      const where = combineWhere(filterWhere, searchWhere);
      const order = buildOrder(attrs, query.order_by);
      const { rows, count } = await config.model.findAndCountAll({
        where,
        order,
        limit: query.page_size,
        offset: (query.page - 1) * query.page_size,
      });
      res.json({
        data: rows.map((r) => r.toJSON()),
        pagination: buildPagination(query.page, query.page_size, count),
      });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const record = await config.model.findOne({
        where: { [pk]: String(req.params.id) },
      });
      if (!record) throw new ApiError(404, 'Not found', 'not_found');
      res.json(record.toJSON());
    }),
  );

  if (config.readonly) return router;

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const data = req.body as Record<string, unknown>;
      await config.beforeCreate?.(req, data);
      const created = await config.model.create(data);
      const record = created.toJSON() as Record<string, unknown>;
      if (config.afterCreate) {
        try {
          await config.afterCreate(req, record);
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
      const existing = await config.model.findOne({ where: { [pk]: id } });
      if (!existing) throw new ApiError(404, 'Not found', 'not_found');
      const before = existing.toJSON() as Record<string, unknown>;
      await existing.update(data);
      const after = existing.toJSON() as Record<string, unknown>;
      if (config.afterUpdate) {
        try {
          await config.afterUpdate(req, before, after);
        } catch (err) {
          req.log?.error?.(
            { err, entity: config.name, record_id: id },
            'afterUpdate hook failed (record persisted; hook is best-effort)',
          );
        }
      }
      res.json(after);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      if (config.beforeDelete) await config.beforeDelete(req, id);
      const removed = await config.model.destroy({ where: { [pk]: id } });
      if (removed === 0) throw new ApiError(404, 'Not found', 'not_found');
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
      const rows = await config.model.bulkCreate(items);
      res
        .status(201)
        .json({ data: rows.map((r) => r.toJSON()), count: rows.length });
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
      await config.model.destroy({ where: { [pk]: ids } });
      res.status(204).send();
    }),
  );

  return router;
}
