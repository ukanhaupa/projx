import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Model, ModelStatic } from 'sequelize';
import {
  buildOrder,
  buildPagination,
  buildSearchWhere,
  buildWhere,
  combineWhere,
  parseRawQuery,
} from './query-engine.js';
import {
  auditBulkCreate,
  auditBulkDelete,
  auditCreate,
  auditDelete,
  auditUpdate,
} from './audit.js';

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

function attributes(model: ModelStatic<Model>): Set<string> {
  return new Set(Object.keys(model.getAttributes()));
}

export function registerEntityRoutes(
  app: FastifyInstance,
  config: SequelizeEntityConfig,
): void {
  const pk = config.primaryKey ?? 'id';
  const attrs = attributes(config.model);

  app.get('/', { schema: { tags: [config.tag] } }, async (request, reply) => {
    const rawQs = request.url.split('?')[1] ?? '';
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
    return reply.send({
      data: rows.map((r) => r.toJSON()),
      pagination: buildPagination(query.page, query.page_size, count),
    });
  });

  app.get(
    '/:id',
    { schema: { tags: [config.tag] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const record = await config.model.findOne({ where: { [pk]: id } });
      if (!record)
        return reply
          .status(404)
          .send({ detail: 'Not found', request_id: request.id });
      return reply.send(record.toJSON());
    },
  );

  if (config.readonly) return;

  app.post('/', { schema: { tags: [config.tag] } }, async (request, reply) => {
    const data = request.body as Record<string, unknown>;
    await config.beforeCreate?.(request, data);
    const created = await config.model.create(data);
    const record = created.toJSON() as Record<string, unknown>;
    await auditCreate(config.model, pk, record);
    if (config.afterCreate) {
      try {
        await config.afterCreate(request, record);
      } catch (err) {
        request.log.error(
          {
            err,
            entity: config.name,
            record_id: (record as { id?: string }).id,
          },
          'afterCreate hook failed (record persisted; hook is best-effort)',
        );
      }
    }
    return reply.status(201).send(record);
  });

  app.patch(
    '/:id',
    { schema: { tags: [config.tag] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const data = request.body as Record<string, unknown>;
      if (!data || Object.keys(data).length === 0) {
        return reply.status(400).send({
          detail: 'Request body cannot be empty',
          request_id: request.id,
        });
      }
      if (config.beforeUpdate) {
        await config.beforeUpdate(request, reply, data);
        if (reply.sent) return;
      }
      const existing = await config.model.findOne({ where: { [pk]: id } });
      if (!existing)
        return reply
          .status(404)
          .send({ detail: 'Not found', request_id: request.id });
      const before = existing.toJSON() as Record<string, unknown>;
      await existing.update(data);
      const after = existing.toJSON() as Record<string, unknown>;
      await auditUpdate(config.model, pk, before, after);
      if (config.afterUpdate) {
        try {
          await config.afterUpdate(request, before, after);
        } catch (err) {
          request.log.error(
            { err, entity: config.name, record_id: id },
            'afterUpdate hook failed (record persisted; hook is best-effort)',
          );
        }
      }
      return reply.send(after);
    },
  );

  app.delete(
    '/:id',
    { schema: { tags: [config.tag] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (config.beforeDelete) await config.beforeDelete(request, id);
      const existing = await config.model.findOne({ where: { [pk]: id } });
      if (!existing) {
        return reply
          .status(404)
          .send({ detail: 'Not found', request_id: request.id });
      }
      const before = existing.toJSON() as Record<string, unknown>;
      await config.model.destroy({ where: { [pk]: id } });
      await auditDelete(config.model, pk, before);
      return reply.status(204).send();
    },
  );

  if (!config.bulkOperations) return;

  app.post(
    '/bulk',
    { schema: { tags: [config.tag] } },
    async (request, reply) => {
      const { items } = request.body as { items: Record<string, unknown>[] };
      if (!Array.isArray(items) || items.length === 0) {
        return reply.status(400).send({
          detail: 'items must be a non-empty array',
          request_id: request.id,
        });
      }
      for (const item of items) {
        await config.beforeCreate?.(request, item);
      }
      const rows = await config.model.bulkCreate(items);
      await auditBulkCreate(config.model, pk, rows);
      return reply
        .status(201)
        .send({ data: rows.map((r) => r.toJSON()), count: rows.length });
    },
  );

  app.delete(
    '/bulk',
    { schema: { tags: [config.tag] } },
    async (request, reply) => {
      const { ids } = request.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({
          detail: 'ids must be a non-empty array',
          request_id: request.id,
        });
      }
      await auditBulkDelete(config.model, pk, { [pk]: ids }, () =>
        config.model.destroy({ where: { [pk]: ids } }),
      );
      return reply.status(204).send();
    },
  );
}
