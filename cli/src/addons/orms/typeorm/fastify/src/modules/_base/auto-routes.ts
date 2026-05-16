import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { dataSource } from '../../db/data-source.js';
import { registerInRegistry } from './registry.js';
import {
  buildOrder,
  buildPagination,
  buildSearchWheres,
  buildWhere,
  parseRawQuery,
} from './query-engine.js';

export type BeforeCreateHook = (
  request: FastifyRequest,
  data: Record<string, unknown>,
) => void | Promise<void>;
export type AfterCreateHook = (
  request: FastifyRequest,
  record: Record<string, unknown>,
) => void | Promise<void>;
export type BeforeUpdateHook = (
  request: FastifyRequest,
  reply: FastifyReply,
  data: Record<string, unknown>,
) => void | Promise<void>;
export type AfterUpdateHook = (
  request: FastifyRequest,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) => void | Promise<void>;
export type BeforeDeleteHook = (
  request: FastifyRequest,
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

function columnNames<T extends ObjectLiteral>(repo: Repository<T>): Set<string> {
  return new Set(repo.metadata.columns.map((c) => c.propertyName));
}

export function registerEntityRoutes<T extends ObjectLiteral>(
  app: FastifyInstance,
  config: TypeormEntityConfig<T>,
): void {
  registerInRegistry({ name: config.name, apiPrefix: config.apiPrefix });
  const pk = config.primaryKey ?? 'id';

  function repo(): Repository<T> {
    return dataSource.getRepository(config.entity);
  }

  app.get('/', { schema: { tags: [config.tag] } }, async (request, reply) => {
    const rawQs = request.url.split('?')[1] ?? '';
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
    return reply.send({
      data: rows,
      pagination: buildPagination(query.page, query.page_size, count),
    });
  });

  app.get('/:id', { schema: { tags: [config.tag] } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const r = repo();
    const record = await r.findOne({ where: { [pk]: id } as never });
    if (!record) return reply.status(404).send({ detail: 'Not found', request_id: request.id });
    return reply.send(record);
  });

  if (config.readonly) return;

  app.post('/', { schema: { tags: [config.tag] } }, async (request, reply) => {
    const data = request.body as Record<string, unknown>;
    await config.beforeCreate?.(request, data);
    const r = repo();
    const entity = r.create(data as never);
    const record = (await r.save(entity)) as Record<string, unknown>;
    if (config.afterCreate) {
      try {
        await config.afterCreate(request, record);
      } catch (err) {
        request.log.error(
          { err, entity: config.name, record_id: (record as { id?: string }).id },
          'afterCreate hook failed (record persisted; hook is best-effort)',
        );
      }
    }
    return reply.status(201).send(record);
  });

  app.patch('/:id', { schema: { tags: [config.tag] } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as Record<string, unknown>;
    if (!data || Object.keys(data).length === 0) {
      return reply
        .status(400)
        .send({ detail: 'Request body cannot be empty', request_id: request.id });
    }
    if (config.beforeUpdate) {
      await config.beforeUpdate(request, reply, data);
      if (reply.sent) return;
    }
    const r = repo();
    const existing = await r.findOne({ where: { [pk]: id } as never });
    if (!existing) return reply.status(404).send({ detail: 'Not found', request_id: request.id });
    const before = { ...(existing as Record<string, unknown>) };
    Object.assign(existing, data);
    const saved = (await r.save(existing)) as Record<string, unknown>;
    if (config.afterUpdate) {
      try {
        await config.afterUpdate(request, before, saved);
      } catch (err) {
        request.log.error(
          { err, entity: config.name, record_id: id },
          'afterUpdate hook failed (record persisted; hook is best-effort)',
        );
      }
    }
    return reply.send(saved);
  });

  app.delete('/:id', { schema: { tags: [config.tag] } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (config.beforeDelete) await config.beforeDelete(request, id);
    const r = repo();
    const result = await r.delete({ [pk]: id } as never);
    if (!result.affected) {
      return reply.status(404).send({ detail: 'Not found', request_id: request.id });
    }
    return reply.status(204).send();
  });

  if (!config.bulkOperations) return;

  app.post('/bulk', { schema: { tags: [config.tag] } }, async (request, reply) => {
    const { items } = request.body as { items: Record<string, unknown>[] };
    if (!Array.isArray(items) || items.length === 0) {
      return reply
        .status(400)
        .send({ detail: 'items must be a non-empty array', request_id: request.id });
    }
    for (const item of items) {
      await config.beforeCreate?.(request, item);
    }
    const r = repo();
    const entities = r.create(items as never);
    const rows = (await r.save(entities)) as unknown as Record<string, unknown>[];
    return reply.status(201).send({ data: rows, count: rows.length });
  });

  app.delete('/bulk', { schema: { tags: [config.tag] } }, async (request, reply) => {
    const { ids } = request.body as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply
        .status(400)
        .send({ detail: 'ids must be a non-empty array', request_id: request.id });
    }
    const r = repo();
    await r.delete(ids as never);
    return reply.status(204).send();
  });
}
