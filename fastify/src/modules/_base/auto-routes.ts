import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ensureEffectiveHiddenFields, type EntityConfig } from './entity-registry.js';
import { BaseRepository } from './repository.js';
import { BaseService } from './service.js';
import { formatPaginatedResponse, type QueryParams } from './query-engine.js';
import { parseExpandParam, buildIncludeFromExpand } from './expand.js';
import * as querystring from 'node:querystring';

const ErrorSchema = Type.Object({
  detail: Type.String(),
  request_id: Type.Optional(Type.String()),
});

const BulkDeleteSchema = Type.Object({
  ids: Type.Array(Type.String({ format: 'uuid' })),
});

function parseRawQuery(request: FastifyRequest): QueryParams {
  const rawQs = request.url.split('?')[1] ?? '';
  const parsed = querystring.parse(rawQs);

  const page = Math.max(1, Number(parsed.page) || 1);
  const page_size = Math.min(100, Math.max(1, Number(parsed.page_size) || 10));

  const result: QueryParams = {
    page,
    page_size,
    order_by: typeof parsed.order_by === 'string' ? parsed.order_by : undefined,
    search: typeof parsed.search === 'string' ? parsed.search : undefined,
    expand: typeof parsed.expand === 'string' ? parsed.expand : undefined,
  };

  for (const [key, value] of Object.entries(parsed)) {
    if (['page', 'page_size', 'order_by', 'search', 'expand'].includes(key)) continue;
    if (typeof value === 'string') result[key] = value;
  }

  return result;
}

function buildAuthHooks(fastify: FastifyInstance, entityConfig: EntityConfig, operation?: string) {
  if (!entityConfig.auth?.protected) return {};

  const hooks: { onRequest: unknown[] } = { onRequest: [fastify.authenticate] };
  const permission =
    entityConfig.auth.permissions?.[operation as keyof typeof entityConfig.auth.permissions];
  if (permission) {
    hooks.onRequest.push(fastify.authorize(permission));
  }
  return hooks;
}

export function registerEntityRoutes(fastify: FastifyInstance, entityConfig: EntityConfig): void {
  const hiddenFields = ensureEffectiveHiddenFields(entityConfig);
  const repo = new BaseRepository(fastify.prisma, entityConfig.prismaModel, {
    columnNames: entityConfig.columnNames,
    searchableFields: entityConfig.searchableFields,
    softDelete: entityConfig.softDelete,
    hiddenFields,
  });
  const service = new BaseService(repo);
  const tag = entityConfig.tags;

  fastify.get(
    '/',
    {
      schema: {
        tags: tag,
      },
      ...buildAuthHooks(fastify, entityConfig, 'list'),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = parseRawQuery(request);
      const expandFields = parseExpandParam(query.expand);
      const include = buildIncludeFromExpand(expandFields, entityConfig);
      const { data, total } = await service.list(query, include);
      return reply.send(formatPaginatedResponse(data, total, query.page, query.page_size));
    },
  );

  fastify.get(
    '/:id',
    {
      schema: {
        tags: tag,
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
      ...buildAuthHooks(fastify, entityConfig, 'get'),
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const query = parseRawQuery(request);
      const expandFields = parseExpandParam(query.expand);
      const include = buildIncludeFromExpand(expandFields, entityConfig);
      const record = await service.get(request.params.id, include);
      return reply.send(record);
    },
  );

  if (entityConfig.readonly) return;

  fastify.post(
    '/',
    {
      schema: {
        tags: tag,
        body: entityConfig.createSchema,
        response: {
          201: entityConfig.schema,
          409: ErrorSchema,
          422: ErrorSchema,
        },
      },
      ...buildAuthHooks(fastify, entityConfig, 'create'),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const data = request.body as Record<string, unknown>;
      const record = await service.create(data);
      return reply.status(201).send(record);
    },
  );

  fastify.patch(
    '/:id',
    {
      schema: {
        tags: tag,
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: entityConfig.updateSchema,
        response: {
          200: entityConfig.schema,
          404: ErrorSchema,
          409: ErrorSchema,
          422: ErrorSchema,
        },
      },
      ...buildAuthHooks(fastify, entityConfig, 'update'),
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const data = request.body as Record<string, unknown>;
      if (!data || Object.keys(data).length === 0) {
        return reply
          .status(400)
          .send({ detail: 'Request body cannot be empty', request_id: request.id });
      }
      const record = await service.update(request.params.id, data);
      return reply.send(record);
    },
  );

  fastify.delete(
    '/:id',
    {
      schema: {
        tags: tag,
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: {
          204: Type.Null(),
          404: ErrorSchema,
        },
      },
      ...buildAuthHooks(fastify, entityConfig, 'delete'),
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await service.delete(request.params.id);
      return reply.status(204).send();
    },
  );

  if (!entityConfig.bulkOperations) return;

  fastify.post(
    '/bulk',
    {
      schema: {
        tags: tag,
        body: Type.Object({
          items: Type.Array(entityConfig.createSchema),
        }),
        response: {
          201: Type.Object({ data: Type.Any(), count: Type.Number() }),
          409: ErrorSchema,
        },
      },
      ...buildAuthHooks(fastify, entityConfig, 'create'),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { items } = request.body as { items: Record<string, unknown>[] };
      const result = await service.bulkCreate(items);
      return reply.status(201).send({ data: result, count: (result as { count: number }).count });
    },
  );

  fastify.delete(
    '/bulk',
    {
      schema: {
        tags: tag,
        body: BulkDeleteSchema,
        response: {
          204: Type.Null(),
        },
      },
      ...buildAuthHooks(fastify, entityConfig, 'delete'),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { ids } = request.body as { ids: string[] };
      await service.bulkDelete(ids);
      return reply.status(204).send();
    },
  );
}
