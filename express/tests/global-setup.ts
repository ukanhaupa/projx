import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  findMigrationChecksumDrift,
  formatMigrationDriftError,
  type MigrationChecksum,
} from './helpers/migration-checksum.js';

export default async function globalSetup(): Promise<void> {
  if (process.env.SKIP_MIGRATION_DRIFT_CHECK === '1') return;
  if (!process.env.DATABASE_URL) return;

  const migrationsDir = join(process.cwd(), 'prisma/migrations');
  if (!existsSync(migrationsDir)) return;

  const prisma = new PrismaClient();
  try {
    const applied = await prisma.$queryRaw<MigrationChecksum[]>`
      SELECT migration_name, checksum
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL
    `;
    const drift = await findMigrationChecksumDrift(migrationsDir, applied);
    if (drift.length > 0) {
      throw new Error(formatMigrationDriftError(drift));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('_prisma_migrations')) return;
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}
