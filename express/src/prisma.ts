import pino from 'pino';
import { Prisma, type PrismaClient } from '@prisma/client';
import { getPrismaClient } from './lib/prisma-client.js';
import { getRequestUserId } from './utils/request-context.js';

type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE';

// What to audit is derived from the operation name, never an allowlist of ops.
// Prisma's naming is total and stable: every write is create*/update*/upsert/delete*;
// everything else (find*/count/aggregate/groupBy) is a read. A new Prisma write op
// is therefore audited by default instead of being silently dropped.
function writeActionFor(operation: string): AuditAction | null {
  if (operation.startsWith('create')) return 'INSERT';
  if (operation === 'upsert' || operation.startsWith('update')) return 'UPDATE';
  if (operation.startsWith('delete')) return 'DELETE';
  return null;
}

// Models excluded from the audit trail (the audit table itself, plus any
// high-churn/non-business plumbing a project adds — refresh/verification tokens,
// idempotency keys). This is a SEPARATE concern from any tenant-scoping skip set:
// a model exempt from scoping is not automatically exempt from auditing.
const AUDIT_SKIP_MODELS = new Set(['AuditLog']);

const SYSTEM_ACTOR = 'system';

const auditLogger = pino({ name: 'prisma-audit' });

function serializeJson(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value == null) return Prisma.DbNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

type LogFn = (msg: string, ...args: unknown[]) => void;
type Delegate = Record<string, (...args: unknown[]) => Promise<unknown>>;
type QueryFn = (args: unknown) => Promise<unknown>;

function buildExtendedClient(base: PrismaClient, log: LogFn) {
  // Audit rows are written through the BASE (non-extended) client. That keeps them
  // out of this interceptor (no audit-of-audit recursion) but also out of the
  // caller's transaction: a rolled-back caller tx still leaves its audit rows.
  // The trade is deliberate — the trail records attempted writes, not only
  // committed ones. (Raw SQL — $executeRaw / $queryRawUnsafe — never reaches this
  // interceptor and is never audited; use DB triggers for a tamper-proof trail.)
  async function runAudit(
    model: string,
    operation: string,
    action: AuditAction,
    args: unknown,
    query: QueryFn,
    delegate: Delegate | undefined,
  ): Promise<unknown> {
    const user = getRequestUserId() ?? SYSTEM_ACTOR;
    const argRecord = (args as Record<string, unknown>) ?? {};
    const where = argRecord.where as Record<string, unknown> | undefined;

    async function writeAudit(
      recordId: unknown,
      auditAction: AuditAction,
      oldValue: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
      newValue: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
    ): Promise<void> {
      try {
        await base.auditLog.create({
          data: {
            table_name: model,
            record_id: String(recordId ?? ''),
            action: auditAction,
            old_value: oldValue,
            new_value: newValue,
            performed_by: user,
          },
        });
      } catch (err) {
        log('Failed to write audit log', err);
      }
    }

    async function lookupExisting(): Promise<unknown> {
      if (!delegate?.findUnique || !where) return null;
      try {
        return await delegate.findUnique({ where });
      } catch {
        return null;
      }
    }

    async function lookupMatching(): Promise<Array<Record<string, unknown>>> {
      if (!delegate?.findMany) return [];
      try {
        return (await delegate.findMany(where ? { where } : {})) as Array<
          Record<string, unknown>
        >;
      } catch {
        return [];
      }
    }

    switch (operation) {
      // createMany returns only { count } with no row ids — record a single
      // summary row rather than dropping the write from the trail.
      case 'createMany': {
        const result = await query(args);
        await writeAudit(
          '',
          'INSERT',
          Prisma.DbNull,
          serializeJson({
            data: argRecord.data ?? null,
            count: (result as { count?: number })?.count ?? null,
          }),
        );
        return result;
      }

      case 'createManyAndReturn': {
        const result = await query(args);
        const rows = Array.isArray(result)
          ? (result as Array<Record<string, unknown>>)
          : [];
        for (const row of rows) {
          await writeAudit(row.id, 'INSERT', Prisma.DbNull, serializeJson(row));
        }
        return result;
      }

      case 'deleteMany': {
        const olds = await lookupMatching();
        const result = await query(args);
        for (const old of olds) {
          await writeAudit(old.id, 'DELETE', serializeJson(old), Prisma.DbNull);
        }
        return result;
      }

      case 'updateMany':
      case 'updateManyAndReturn': {
        const olds = await lookupMatching();
        const result = await query(args);
        const ids = olds.map((row) => row.id).filter((id) => id != null);
        const news =
          ids.length && delegate?.findMany
            ? ((await delegate
                .findMany({ where: { id: { in: ids } } })
                .catch(() => [])) as Array<Record<string, unknown>>)
            : [];
        const newById = new Map(news.map((row) => [row.id, row]));
        for (const old of olds) {
          await writeAudit(
            old.id,
            'UPDATE',
            serializeJson(old),
            serializeJson(newById.get(old.id) ?? null),
          );
        }
        return result;
      }

      case 'upsert': {
        const existing = await lookupExisting();
        const result = await query(args);
        const recordId = (result as Record<string, unknown>)?.id ?? where?.id;
        await writeAudit(
          recordId,
          existing ? 'UPDATE' : 'INSERT',
          existing ? serializeJson(existing) : Prisma.DbNull,
          serializeJson(result),
        );
        return result;
      }

      case 'update':
      case 'delete': {
        const oldValue = await lookupExisting();
        const result = await query(args);
        const recordId = (result as Record<string, unknown>)?.id ?? where?.id;
        await writeAudit(
          recordId,
          action,
          serializeJson(oldValue),
          operation === 'delete' ? Prisma.DbNull : serializeJson(result),
        );
        return result;
      }

      default: {
        // single create
        const result = await query(args);
        await writeAudit(
          (result as Record<string, unknown>)?.id,
          'INSERT',
          Prisma.DbNull,
          serializeJson(result),
        );
        return result;
      }
    }
  }

  return base.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        const action = writeActionFor(operation);
        if (!action || !model || AUDIT_SKIP_MODELS.has(model)) {
          return query(args);
        }

        const delegate = (base as unknown as Record<string, Delegate>)[
          model.charAt(0).toLowerCase() + model.slice(1)
        ];

        return runAudit(
          model,
          operation,
          action,
          args,
          query as QueryFn,
          delegate,
        );
      },
    },
  });
}

export type ExtendedPrismaClient = ReturnType<typeof buildExtendedClient>;

let extended: ExtendedPrismaClient | undefined;

function getExtendedClient(): ExtendedPrismaClient {
  if (!extended) {
    extended = buildExtendedClient(getPrismaClient(), (msg, ...args) =>
      auditLogger.warn({ args }, msg),
    );
  }
  return extended;
}

const lazyTarget = {} as Record<string, unknown>;
export const prisma = new Proxy(lazyTarget, {
  get(_target, prop) {
    const client = getExtendedClient();
    return Reflect.get(client, prop, client);
  },
}) as unknown as ReturnType<typeof getPrismaClient>;

export type PrismaLike = object & {
  $connect?: () => Promise<void>;
  $disconnect?: () => Promise<void>;
};
