import { In, type ObjectLiteral, type Repository } from 'typeorm';
import { dataSource } from '../../db/data-source.js';
import { AuditLog } from '../../entities/audit-log.js';
import { getRequestUserId } from '../../utils/request-context.js';

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE';

const SYSTEM_ACTOR = 'system';

let auditTableName: string | undefined;

function isAuditTable(tableName: string): boolean {
  auditTableName ??= dataSource.getMetadata(AuditLog).tableName;
  return tableName === auditTableName;
}

export type AuditLogger = (message: string, error: unknown) => void;

const noopLogger: AuditLogger = () => {};

type JsonRecord = Record<string, unknown>;

function serializeJson(value: unknown): JsonRecord | null {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value)) as JsonRecord;
}

function tableNameOf<T extends ObjectLiteral>(repo: Repository<T>): string {
  return repo.metadata.tableName;
}

function primaryKeyOf<T extends ObjectLiteral>(repo: Repository<T>): string {
  return repo.metadata.primaryColumns[0]?.propertyName ?? 'id';
}

async function writeAudit(
  tableName: string,
  recordId: unknown,
  action: AuditAction,
  oldValue: JsonRecord | null,
  newValue: JsonRecord | null,
  log: AuditLogger,
): Promise<void> {
  if (isAuditTable(tableName)) return;
  try {
    const auditRepo = dataSource.getRepository(AuditLog);
    const row = auditRepo.create({
      tableName,
      recordId: String(recordId ?? ''),
      action,
      oldValue,
      newValue,
      performedBy: getRequestUserId() ?? SYSTEM_ACTOR,
    });
    await auditRepo.save(row);
  } catch (err) {
    log('Failed to write audit log', err);
  }
}

export async function auditedCreate<T extends ObjectLiteral>(
  repo: Repository<T>,
  entity: T,
  log: AuditLogger = noopLogger,
): Promise<T> {
  const saved = await repo.save(entity);
  const pk = primaryKeyOf(repo);
  const record = saved as unknown as Record<string, unknown>;
  await writeAudit(
    tableNameOf(repo),
    record[pk],
    'INSERT',
    null,
    serializeJson(saved),
    log,
  );
  return saved;
}

export async function auditedCreateMany<T extends ObjectLiteral>(
  repo: Repository<T>,
  entities: T[],
  log: AuditLogger = noopLogger,
): Promise<T[]> {
  const saved = await repo.save(entities);
  const pk = primaryKeyOf(repo);
  const tableName = tableNameOf(repo);
  for (const row of saved) {
    const record = row as unknown as Record<string, unknown>;
    await writeAudit(
      tableName,
      record[pk],
      'INSERT',
      null,
      serializeJson(row),
      log,
    );
  }
  return saved;
}

export async function auditedBulkUpdate<T extends ObjectLiteral>(
  repo: Repository<T>,
  criteria: Record<string, unknown>,
  apply: () => Promise<unknown>,
  log: AuditLogger = noopLogger,
): Promise<unknown> {
  const pk = primaryKeyOf(repo);
  const tableName = tableNameOf(repo);
  const olds = await repo.find({ where: criteria as never });
  const result = await apply();
  const ids = olds
    .map((row) => (row as unknown as Record<string, unknown>)[pk])
    .filter((id) => id != null) as unknown[];
  const news =
    ids.length > 0
      ? await repo.find({ where: { [pk]: In(ids as never[]) } as never })
      : [];
  const newById = new Map(
    news.map((row) => {
      const record = row as unknown as Record<string, unknown>;
      return [record[pk], row];
    }),
  );
  for (const old of olds) {
    const record = old as unknown as Record<string, unknown>;
    const id = record[pk];
    await writeAudit(
      tableName,
      id,
      'UPDATE',
      serializeJson(old),
      serializeJson(newById.get(id) ?? null),
      log,
    );
  }
  return result;
}

export async function auditedUpdate<T extends ObjectLiteral>(
  repo: Repository<T>,
  before: T,
  entity: T,
  log: AuditLogger = noopLogger,
): Promise<T> {
  const pk = primaryKeyOf(repo);
  const beforeSnapshot = serializeJson(before);
  const saved = await repo.save(entity);
  const record = saved as unknown as Record<string, unknown>;
  await writeAudit(
    tableNameOf(repo),
    record[pk],
    'UPDATE',
    beforeSnapshot,
    serializeJson(saved),
    log,
  );
  return saved;
}

export async function auditedDelete<T extends ObjectLiteral>(
  repo: Repository<T>,
  criteria: Record<string, unknown>,
  log: AuditLogger = noopLogger,
): Promise<{ affected: number }> {
  const pk = primaryKeyOf(repo);
  const olds = await repo.find({ where: criteria as never });
  const result = await repo.delete(criteria as never);
  const tableName = tableNameOf(repo);
  for (const old of olds) {
    const record = old as unknown as Record<string, unknown>;
    await writeAudit(
      tableName,
      record[pk],
      'DELETE',
      serializeJson(old),
      null,
      log,
    );
  }
  return { affected: result.affected ?? olds.length };
}

export async function auditedDeleteMany<T extends ObjectLiteral>(
  repo: Repository<T>,
  ids: string[],
  log: AuditLogger = noopLogger,
): Promise<{ affected: number }> {
  const pk = primaryKeyOf(repo);
  const olds = await repo.find({ where: { [pk]: In(ids) } as never });
  const result = await repo.delete(ids as never);
  const tableName = tableNameOf(repo);
  for (const old of olds) {
    const record = old as unknown as Record<string, unknown>;
    await writeAudit(
      tableName,
      record[pk],
      'DELETE',
      serializeJson(old),
      null,
      log,
    );
  }
  return { affected: result.affected ?? olds.length };
}
