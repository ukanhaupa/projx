import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  disposePrismaClient,
  getPrismaClient,
} from '../src/lib/prisma-client.js';
import {
  findMigrationChecksumDrift,
  formatMigrationDriftError,
  type MigrationChecksum,
} from './helpers/migration-checksum.js';

export default async function globalSetup(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Configure .env.test (or the environment) so tests run against a real database.',
    );
  }

  execFileSync(
    'prisma',
    ['db', 'push', '--skip-generate', '--accept-data-loss'],
    { stdio: 'inherit' },
  );

  if (process.env.SKIP_MIGRATION_DRIFT_CHECK === '1') return;

  const migrationsDir = join(process.cwd(), 'prisma/migrations');
  if (!existsSync(migrationsDir)) return;

  const prisma = getPrismaClient();
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
    await disposePrismaClient();
  }
}
