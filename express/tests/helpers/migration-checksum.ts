import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface MigrationChecksum {
  migration_name: string;
  checksum: string;
}

export interface MigrationDrift {
  migration_name: string;
  expected: string;
  actual: string;
}

export async function calculateMigrationChecksums(
  migrationsDir: string,
): Promise<MigrationChecksum[]> {
  if (!existsSync(migrationsDir)) return [];
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrations: MigrationChecksum[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const migrationPath = join(migrationsDir, entry.name, 'migration.sql');
    if (!existsSync(migrationPath)) continue;
    const sql = await readFile(migrationPath);
    migrations.push({
      migration_name: entry.name,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }

  return migrations.sort((a, b) => a.migration_name.localeCompare(b.migration_name));
}

export async function findMigrationChecksumDrift(
  migrationsDir: string,
  appliedMigrations: MigrationChecksum[],
): Promise<MigrationDrift[]> {
  const current = new Map(
    (await calculateMigrationChecksums(migrationsDir)).map((migration) => [
      migration.migration_name,
      migration.checksum,
    ]),
  );

  return appliedMigrations
    .map((migration) => ({
      migration_name: migration.migration_name,
      expected: migration.checksum,
      actual: current.get(migration.migration_name) ?? '',
    }))
    .filter((migration) => migration.actual && migration.actual !== migration.expected);
}

export function formatMigrationDriftError(drift: MigrationDrift[]): string {
  const rows = drift
    .map((item) => `  - ${item.migration_name}: database=${item.expected}, file=${item.actual}`)
    .join('\n');
  return [
    '',
    'TEST DB MIGRATION DRIFT DETECTED',
    rows,
    '',
    'The recorded checksum in _prisma_migrations no longer matches migration.sql on disk.',
    'Run:',
    '',
    '  npx prisma migrate reset --force',
    '',
    'before running tests again.',
  ].join('\n');
}
