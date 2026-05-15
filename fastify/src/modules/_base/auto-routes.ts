import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ensureEffectiveHiddenFields, type EntityConfig } from './entity-registry.js';
import { BaseRepository } from './repository.js';
import { BaseService } from './service.js';
import { formatPaginatedResponse, type QueryParams } from './query-engine.js';
import { parseExpandParam, buildIncludeFromExpand } from './expand.js';
import { computeScopeFilters } from '../../plugins/authz.js';
import type { AuthUser } from '../../plugins/auth.js';
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

async function getScopeFilters(
  request: FastifyRequest,
  entityConfig: EntityConfig,
): Promise<Record<string, unknown> | null> {
  const user = request.authUser as (AuthUser & Record<string, unknown>) | undefined;
  return computeScopeFilters(user, entityConfig.tableName, new Set(entityConfig.columnNames ?? []));
}

export function registerEntityRoutes(fastify: FastifyInstance, entityConfig: EntityConfig): void {
  const hiddenFields = ensureEffectiveHiddenFields(entityConfig);
  const repo = new BaseRepository(fastify.prisma, entityConfig.prismaModel, {
    columnNames: entityConfig.columnNames ?? [],
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
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = parseRawQuery(request);
      const scopeFilters = await getScopeFilters(request, entityConfig);
      if (scopeFilters) Object.assign(query, scopeFilters);
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
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const scopeFilters = await getScopeFilters(request, entityConfig);
      if (scopeFilters) {
        const query: QueryParams = {
          page: 1,
          page_size: 1,
          ...scopeFilters,
          id: request.params.id,
        };
        const { data } = await service.list(query);
        if (!data.length) return reply.status(404).send({ detail: 'Not found' });
        const expandFields = parseExpandParam(parseRawQuery(request).expand);
        if (expandFields.length) {
          const include = buildIncludeFromExpand(expandFields, entityConfig);
          const record = await service.get(request.params.id, include);
          return reply.send(record);
        }
        return reply.send(data[0]);
      }
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
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const data = request.body as Record<string, unknown>;
      const scopeFilters = await getScopeFilters(request, entityConfig);
      if (scopeFilters) Object.assign(data, scopeFilters);
      await entityConfig.beforeCreate?.(request, data);
      const record = await service.create(data);
      if (entityConfig.afterCreate) {
        try {
          await entityConfig.afterCreate(request, record as Record<string, unknown>);
        } catch (err) {
          request.log.error(
            { err, entity: entityConfig.name, record_id: (record as { id?: string }).id },
            'afterCreate hook failed (record persisted; hook is best-effort)',
          );
        }
      }
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
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const data = request.body as Record<string, unknown>;
      if (!data || Object.keys(data).length === 0) {
        return reply
          .status(400)
          .send({ detail: 'Request body cannot be empty', request_id: request.id });
      }
      const scopeFilters = await getScopeFilters(request, entityConfig);
      if (scopeFilters) {
        const query: QueryParams = {
          page: 1,
          page_size: 1,
          ...scopeFilters,
          id: request.params.id,
        };
        const { data: accessible } = await service.list(query);
        if (!accessible.length) return reply.status(404).send({ detail: 'Not found' });
      }
      if (entityConfig.beforeUpdate) {
        await entityConfig.beforeUpdate(request, reply, data);
        if (reply.sent) return;
      }
      const before = entityConfig.afterUpdate
        ? ((await service.get(request.params.id)) as Record<string, unknown> | null)
        : null;
      const record = await service.update(request.params.id, data);
      if (entityConfig.afterUpdate && before) {
        try {
          await entityConfig.afterUpdate(request, before, record as Record<string, unknown>);
        } catch (err) {
          request.log.error(
            { err, entity: entityConfig.name, record_id: request.params.id },
            'afterUpdate hook failed (record persisted; hook is best-effort)',
          );
        }
      }
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
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const scopeFilters = await getScopeFilters(request, entityConfig);
      if (scopeFilters) {
        const query: QueryParams = {
          page: 1,
          page_size: 1,
          ...scopeFilters,
          id: request.params.id,
        };
        const { data: accessible } = await service.list(query);
        if (!accessible.length) return reply.status(404).send({ detail: 'Not found' });
      }
      if (entityConfig.beforeDelete) {
        await entityConfig.beforeDelete(request, request.params.id);
      }
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
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { items } = request.body as { items: Record<string, unknown>[] };
      const scopeFilters = await getScopeFilters(request, entityConfig);
      if (scopeFilters) {
        for (const item of items) Object.assign(item, scopeFilters);
      }
      for (const item of items) {
        await entityConfig.beforeCreate?.(request, item);
      }
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
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { ids } = request.body as { ids: string[] };
      const scopeFilters = await getScopeFilters(request, entityConfig);
      if (scopeFilters) {
        const query: QueryParams = { page: 1, page_size: ids.length, ...scopeFilters };
        const { data: accessible } = await service.list(query);
        const accessibleIds = (accessible as Array<{ id: string }>).map((r) => r.id);
        const filtered = ids.filter((id) => accessibleIds.includes(id));
        if (filtered.length) await service.bulkDelete(filtered);
      } else {
        await service.bulkDelete(ids);
      }
      return reply.status(204).send();
    },
  );
}
