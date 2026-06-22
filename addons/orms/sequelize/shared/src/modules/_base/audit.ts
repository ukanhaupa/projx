import type { Model, ModelStatic, WhereOptions } from 'sequelize';
import { getRequestUserId } from '../../utils/request-context.js';
import { AuditLog } from '../../models/audit-log.js';

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE';

const AUDIT_SKIP_TABLES = new Set([AuditLog.tableName]);

const SYSTEM_ACTOR = 'system';

function actor(): string {
  return getRequestUserId() ?? SYSTEM_ACTOR;
}

function serializeJson(value: unknown): unknown {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value));
}

function plain(
  record: Model | Record<string, unknown>,
): Record<string, unknown> {
  return typeof (record as Model).toJSON === 'function'
    ? ((record as Model).toJSON() as Record<string, unknown>)
    : (record as Record<string, unknown>);
}

function recordId(row: Record<string, unknown>, primaryKey: string): string {
  return String(row[primaryKey] ?? '');
}

async function writeRow(
  tableName: string,
  id: string,
  action: AuditAction,
  oldValue: unknown,
  newValue: unknown,
): Promise<void> {
  if (AUDIT_SKIP_TABLES.has(tableName)) return;
  try {
    await AuditLog.create({
      table_name: tableName,
      record_id: id,
      action,
      old_value: serializeJson(oldValue),
      new_value: serializeJson(newValue),
      performed_by: actor(),
    });
  } catch {
    // best-effort: a failed audit write must not fail the originating request
  }
}

export async function auditCreate(
  model: ModelStatic<Model>,
  primaryKey: string,
  record: Model | Record<string, unknown>,
): Promise<void> {
  const row = plain(record);
  await writeRow(
    model.tableName,
    recordId(row, primaryKey),
    'INSERT',
    null,
    row,
  );
}

export async function auditBulkCreate(
  model: ModelStatic<Model>,
  primaryKey: string,
  records: Array<Model | Record<string, unknown>>,
): Promise<void> {
  for (const record of records) {
    await auditCreate(model, primaryKey, record);
  }
}

export async function auditUpdate(
  model: ModelStatic<Model>,
  primaryKey: string,
  before: Record<string, unknown>,
  after: Model | Record<string, unknown>,
): Promise<void> {
  const afterRow = plain(after);
  await writeRow(
    model.tableName,
    recordId(afterRow, primaryKey),
    'UPDATE',
    before,
    afterRow,
  );
}

export async function auditDelete(
  model: ModelStatic<Model>,
  primaryKey: string,
  before: Record<string, unknown>,
): Promise<void> {
  await writeRow(
    model.tableName,
    recordId(before, primaryKey),
    'DELETE',
    before,
    null,
  );
}

export async function auditBulkUpdate(
  model: ModelStatic<Model>,
  primaryKey: string,
  where: WhereOptions,
  apply: () => Promise<unknown>,
): Promise<unknown> {
  const olds = (await model.findAll({ where })).map((r) => plain(r));
  const result = await apply();
  const ids = olds.map((row) => row[primaryKey]).filter((id) => id != null);
  const news =
    ids.length > 0
      ? (
          await model.findAll({ where: { [primaryKey]: ids } as WhereOptions })
        ).map((r) => plain(r))
      : [];
  const newById = new Map(news.map((row) => [recordId(row, primaryKey), row]));
  for (const old of olds) {
    const id = recordId(old, primaryKey);
    await writeRow(model.tableName, id, 'UPDATE', old, newById.get(id) ?? null);
  }
  return result;
}

export async function auditBulkDelete(
  model: ModelStatic<Model>,
  primaryKey: string,
  where: WhereOptions,
  apply: () => Promise<unknown>,
): Promise<unknown> {
  const olds = (await model.findAll({ where })).map((r) => plain(r));
  const result = await apply();
  for (const old of olds) {
    await writeRow(
      model.tableName,
      recordId(old, primaryKey),
      'DELETE',
      old,
      null,
    );
  }
  return result;
}
