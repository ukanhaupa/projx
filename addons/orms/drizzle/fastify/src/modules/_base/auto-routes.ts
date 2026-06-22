import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, inArray, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { getRequestUserId } from '../../utils/request-context.js';
import {
  auditDelete,
  auditInsert,
  auditUpdate,
  SYSTEM_ACTOR,
  type AuditContext,
} from './audit.js';
import {
  buildOrderBy,
  buildPagination,
  buildSearchWhere,
  buildWhere,
  combineWhere,
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
  app: FastifyInstance,
  config: DrizzleEntityConfig,
): void {
  const pk = pkColumn(config) as Parameters<typeof eq>[0];
  const primaryKey = config.primaryKey ?? 'id';

  function auditContext(request: FastifyRequest): AuditContext {
    return {
      db: app.db,
      table: config.table,
      primaryKey,
      actor: getRequestUserId() ?? SYSTEM_ACTOR,
      logError: (err) =>
        request.log.error(
          { err, entity: config.name },
          'failed to write audit log',
        ),
    };
  }

  app.get('/', { schema: { tags: [config.tag] } }, async (request, reply) => {
    const rawQs = request.url.split('?')[1] ?? '';
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

    const baseSelect = app.db.select().from(config.table);
    const baseCount = app.db
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

    return reply.send({
      data: rows,
      pagination: buildPagination(query.page, query.page_size, Number(count)),
    });
  });

  app.get(
    '/:id',
    { schema: { tags: [config.tag] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const [record] = await app.db
        .select()
        .from(config.table)
        .where(eq(pk, id))
        .limit(1);
      if (!record)
        return reply
          .status(404)
          .send({ detail: 'Not found', request_id: request.id });
      return reply.send(record);
    },
  );

  if (config.readonly) return;

  app.post('/', { schema: { tags: [config.tag] } }, async (request, reply) => {
    const data = request.body as Record<string, unknown>;
    await config.beforeCreate?.(request, data);
    const [record] = await app.db
      .insert(config.table)
      .values(data as never)
      .returning();
    await auditInsert(auditContext(request), [
      record as Record<string, unknown>,
    ]);
    if (config.afterCreate) {
      try {
        await config.afterCreate(request, record as Record<string, unknown>);
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
      const [existing] = await app.db
        .select()
        .from(config.table)
        .where(eq(pk, id))
        .limit(1);
      const before = (existing as Record<string, unknown>) ?? null;
      const [record] = await app.db
        .update(config.table)
        .set(data as never)
        .where(eq(pk, id))
        .returning();
      if (!record) {
        return reply
          .status(404)
          .send({ detail: 'Not found', request_id: request.id });
      }
      await auditUpdate(
        auditContext(request),
        before,
        record as Record<string, unknown>,
      );
      if (config.afterUpdate && before) {
        try {
          await config.afterUpdate(
            request,
            before,
            record as Record<string, unknown>,
          );
        } catch (err) {
          request.log.error(
            { err, entity: config.name, record_id: id },
            'afterUpdate hook failed (record persisted; hook is best-effort)',
          );
        }
      }
      return reply.send(record);
    },
  );

  app.delete(
    '/:id',
    { schema: { tags: [config.tag] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (config.beforeDelete) await config.beforeDelete(request, id);
      const deleted = await app.db
        .delete(config.table)
        .where(eq(pk, id))
        .returning();
      if (deleted.length === 0) {
        return reply
          .status(404)
          .send({ detail: 'Not found', request_id: request.id });
      }
      await auditDelete(
        auditContext(request),
        deleted as Record<string, unknown>[],
      );
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
      const rows = await app.db
        .insert(config.table)
        .values(items as never)
        .returning();
      await auditInsert(
        auditContext(request),
        rows as Record<string, unknown>[],
      );
      return reply.status(201).send({ data: rows, count: rows.length });
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
      const deleted = await app.db
        .delete(config.table)
        .where(inArray(pk as Parameters<typeof inArray>[0], ids))
        .returning();
      await auditDelete(
        auditContext(request),
        deleted as Record<string, unknown>[],
      );
      return reply.status(204).send();
    },
  );
}
