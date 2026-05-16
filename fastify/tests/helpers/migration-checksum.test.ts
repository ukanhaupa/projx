import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach } from 'vitest';
import {
  calculateMigrationChecksums,
  findMigrationChecksumDrift,
  formatMigrationDriftError,
} from './migration-checksum.js';

describe('migration checksum guard', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('detects edited migration files before tests hit runtime failures', async () => {
    dir = await mkdtemp(join(tmpdir(), 'projx-migrations-'));
    await mkdir(join(dir, '20260512000000_init'));
    await writeFile(
      join(dir, '20260512000000_init/migration.sql'),
      'CREATE TABLE users();\n',
    );

    const checksums = await calculateMigrationChecksums(dir);
    const drift = await findMigrationChecksumDrift(dir, [
      { migration_name: '20260512000000_init', checksum: 'stale-checksum' },
    ]);

    expect(checksums[0].migration_name).toBe('20260512000000_init');
    expect(drift).toEqual([
      {
        migration_name: '20260512000000_init',
        expected: 'stale-checksum',
        actual: checksums[0].checksum,
      },
    ]);
    expect(formatMigrationDriftError(drift)).toContain(
      'TEST DB MIGRATION DRIFT DETECTED',
    );
  });
});
