import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { z } from 'zod';
import type { PrismaLike } from '../../prisma.js';
import { ApiError } from '../../errors.js';
import {
  ensureEffectiveHiddenFields,
  type EntityConfig,
  type EntitySchema,
} from './entity-registry.js';
import { BaseRepository } from './repository.js';
import { BaseService } from './service.js';
import { formatPaginatedResponse, type QueryParams } from './query-engine.js';
import { buildIncludeFromExpand, parseExpandParam } from './expand.js';

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

function parseRawQuery(req: Request): QueryParams {
  const rawUrl = new URL(req.originalUrl, 'http://localhost');
  const page = Math.max(1, Number(rawUrl.searchParams.get('page')) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(rawUrl.searchParams.get('page_size')) || 10),
  );

  const result: QueryParams = {
    page,
    page_size: pageSize,
    order_by: rawUrl.searchParams.get('order_by') ?? undefined,
    search: rawUrl.searchParams.get('search') ?? undefined,
    expand: rawUrl.searchParams.get('expand') ?? undefined,
  };

  for (const [key, value] of rawUrl.searchParams.entries()) {
    if (['page', 'page_size', 'order_by', 'search', 'expand'].includes(key))
      continue;
    result[key] = value;
  }

  return result;
}

function parseBody(
  schema: EntitySchema,
  body: unknown,
): Record<string, unknown> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(422, z.prettifyError(result.error), 'validation_error');
  }
  return result.data as Record<string, unknown>;
}

export function registerEntityRoutes(
  entityConfig: EntityConfig,
  prisma: PrismaLike,
): express.Router {
  const router = express.Router();
  const hiddenFields = ensureEffectiveHiddenFields(entityConfig);
  const repo = new BaseRepository(prisma, entityConfig.prismaModel, {
    columnNames: entityConfig.columnNames ?? [],
    searchableFields: entityConfig.searchableFields,
    softDelete: entityConfig.softDelete,
    hiddenFields,
  });
  const service = new BaseService(repo);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const query = parseRawQuery(req);
      const expandFields = parseExpandParam(query.expand);
      const include = buildIncludeFromExpand(expandFields, entityConfig);
      const { data, total } = await service.list(query, include);
      res.json(
        formatPaginatedResponse(data, total, query.page, query.page_size),
      );
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const query = parseRawQuery(req);
      const expandFields = parseExpandParam(query.expand);
      const include = buildIncludeFromExpand(expandFields, entityConfig);
      const record = await service.get(String(req.params.id), include);
      res.json(record);
    }),
  );

  if (entityConfig.readonly) return router;

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const data = parseBody(entityConfig.createSchema, req.body);
      await entityConfig.beforeCreate?.(req, data);
      const record = await service.create(data);
      if (entityConfig.afterCreate) {
        try {
          await entityConfig.afterCreate(
            req,
            record as Record<string, unknown>,
          );
        } catch (err) {
          req.log?.error?.(
            {
              err,
              entity: entityConfig.name,
              record_id: (record as { id?: string }).id,
            },
            'afterCreate hook failed (record persisted; hook is best-effort)',
          );
        }
      }
      res.status(201).json(record);
    }),
  );

  if (entityConfig.bulkOperations) {
    router.post(
      '/bulk',
      asyncHandler(async (req, res) => {
        const result = z
          .object({ items: z.array(entityConfig.createSchema) })
          .safeParse(req.body);
        if (!result.success) {
          throw new ApiError(
            422,
            z.prettifyError(result.error),
            'validation_error',
          );
        }
        for (const item of result.data.items) {
          await entityConfig.beforeCreate?.(
            req,
            item as Record<string, unknown>,
          );
        }
        const created = await service.bulkCreate(
          result.data.items as Record<string, unknown>[],
        );
        res.status(201).json({ data: created, count: created.count });
      }),
    );

    router.delete(
      '/bulk',
      asyncHandler(async (req, res) => {
        const result = z
          .object({ ids: z.array(z.string().uuid()) })
          .safeParse(req.body);
        if (!result.success) {
          throw new ApiError(
            422,
            z.prettifyError(result.error),
            'validation_error',
          );
        }
        await service.bulkDelete(result.data.ids);
        res.status(204).send();
      }),
    );
  }

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const data = parseBody(entityConfig.updateSchema, req.body);
      if (Object.keys(data).length === 0) {
        throw new ApiError(400, 'Request body cannot be empty', 'empty_body');
      }
      const recordId = String(req.params.id);
      if (entityConfig.beforeUpdate) {
        await entityConfig.beforeUpdate(req, res, data);
        if (res.headersSent) return;
      }
      const before = entityConfig.afterUpdate
        ? ((await service.get(recordId)) as Record<string, unknown> | null)
        : null;
      const record = await service.update(recordId, data);
      if (entityConfig.afterUpdate && before) {
        try {
          await entityConfig.afterUpdate(
            req,
            before,
            record as Record<string, unknown>,
          );
        } catch (err) {
          req.log?.error?.(
            { err, entity: entityConfig.name, record_id: recordId },
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
      const recordId = String(req.params.id);
      if (entityConfig.beforeDelete) {
        await entityConfig.beforeDelete(req, recordId);
      }
      await service.delete(recordId);
      res.status(204).send();
    }),
  );

  return router;
}
