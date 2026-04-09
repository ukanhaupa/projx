import fp from 'fastify-plugin';
import { Prisma, PrismaClient } from '@prisma/client';

const AUDIT_ACTIONS: Record<string, string> = {
  create: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
};

const SKIP_MODELS = new Set(['AuditLog']);

let _currentUser = 'system';

function serializeJson(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value == null) return Prisma.DbNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

type LogFn = (msg: string, ...args: unknown[]) => void;

function buildExtendedClient(base: PrismaClient, log: LogFn) {
  return base.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        const action = AUDIT_ACTIONS[operation];
        if (!action || !model || SKIP_MODELS.has(model)) {
          return query(args);
        }

        const user = _currentUser;
        const delegate = (
          base as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>
        )[model.charAt(0).toLowerCase() + model.slice(1)];

        if (operation === 'update' || operation === 'delete') {
          let oldValue: unknown = null;
          if (delegate?.findUnique && (args as Record<string, unknown>).where) {
            try {
              oldValue = await delegate.findUnique({
                where: (args as Record<string, unknown>).where,
              });
            } catch {
              // best-effort
            }
          }

          const result = await query(args);

          try {
            const where = (args as Record<string, unknown>).where as Record<string, unknown>;
            const recordId = where?.id ?? (result as Record<string, unknown>)?.id ?? '';
            await base.auditLog.create({
              data: {
                table_name: model,
                record_id: String(recordId),
                action,
                old_value: serializeJson(oldValue),
                new_value: action === 'DELETE' ? Prisma.DbNull : serializeJson(result),
                performed_by: user,
              },
            });
          } catch (err) {
            log('Failed to write audit log', err);
          }

          return result;
        }

        const result = await query(args);

        if (operation === 'create') {
          try {
            await base.auditLog.create({
              data: {
                table_name: model,
                record_id: String((result as Record<string, unknown>)?.id ?? ''),
                action,
                old_value: Prisma.DbNull,
                new_value: serializeJson(result),
                performed_by: user,
              },
            });
          } catch (err) {
            log('Failed to write audit log', err);
          }
        }

        return result;
      },
    },
  });
}

export type ExtendedPrismaClient = ReturnType<typeof buildExtendedClient>;

export default fp(async (fastify) => {
  const base = new PrismaClient({
    log: [
      { level: 'query', emit: 'event' },
      { level: 'error', emit: 'stdout' },
    ],
  });

  base.$on('query', (e) => {
    fastify.log.debug({ query: e.query, duration: e.duration }, 'prisma query');
  });

  const prisma = buildExtendedClient(base, (msg, ...args) => fastify.log.warn({ args }, msg));

  await base.$connect();
  fastify.decorate('prisma', prisma);

  fastify.addHook('onRequest', async (request) => {
    _currentUser = request.authUser?.email ?? request.authUser?.sub ?? 'system';
  });

  fastify.addHook('onClose', async () => {
    await base.$disconnect();
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    prisma: ExtendedPrismaClient;
  }
}
