import { getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { DbClient } from '../../db/client.js';
import { auditLogs } from '../../db/schema.js';

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE';

export const SYSTEM_ACTOR = 'system';

const AUDIT_SKIP_TABLES = new Set<string>([getTableName(auditLogs)]);

type Row = Record<string, unknown>;

function serialize(value: unknown): unknown {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value));
}

function recordId(row: Row, primaryKey: string): string {
  return String(row[primaryKey] ?? '');
}

async function writeRows(
  db: DbClient,
  tableName: string,
  rows: Array<{
    action: AuditAction;
    recordId: string;
    oldValue: unknown;
    newValue: unknown;
  }>,
  actor: string,
  logError: (err: unknown) => void,
): Promise<void> {
  if (rows.length === 0) return;
  try {
    await db.insert(auditLogs).values(
      rows.map((entry) => ({
        tableName,
        recordId: entry.recordId,
        action: entry.action,
        oldValue: serialize(entry.oldValue),
        newValue: serialize(entry.newValue),
        performedBy: actor,
      })),
    );
  } catch (err) {
    logError(err);
  }
}

export interface AuditContext {
  db: DbClient;
  table: PgTable;
  primaryKey: string;
  actor: string;
  logError: (err: unknown) => void;
}

function tableName(table: PgTable): string {
  return getTableName(table);
}

export function isAudited(table: PgTable): boolean {
  return !AUDIT_SKIP_TABLES.has(tableName(table));
}

export async function auditInsert(
  ctx: AuditContext,
  created: Row[],
): Promise<void> {
  if (!isAudited(ctx.table)) return;
  await writeRows(
    ctx.db,
    tableName(ctx.table),
    created.map((row) => ({
      action: 'INSERT' as const,
      recordId: recordId(row, ctx.primaryKey),
      oldValue: null,
      newValue: row,
    })),
    ctx.actor,
    ctx.logError,
  );
}

export async function auditUpdate(
  ctx: AuditContext,
  before: Row | null,
  after: Row,
): Promise<void> {
  if (!isAudited(ctx.table)) return;
  await writeRows(
    ctx.db,
    tableName(ctx.table),
    [
      {
        action: 'UPDATE',
        recordId: recordId(after, ctx.primaryKey),
        oldValue: before,
        newValue: after,
      },
    ],
    ctx.actor,
    ctx.logError,
  );
}

export async function auditDelete(
  ctx: AuditContext,
  deleted: Row[],
): Promise<void> {
  if (!isAudited(ctx.table)) return;
  await writeRows(
    ctx.db,
    tableName(ctx.table),
    deleted.map((row) => ({
      action: 'DELETE' as const,
      recordId: recordId(row, ctx.primaryKey),
      oldValue: row,
      newValue: null,
    })),
    ctx.actor,
    ctx.logError,
  );
}
