import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectComponents } from '../src/detect.js';
import {
  GO_ORM_PROVIDERS,
  NODE_ORM_PROVIDERS,
  ORM_PROVIDERS,
  ormBackendFamily,
  type OrmProvider,
} from '../src/utils.js';

describe('ORM_PROVIDERS', () => {
  it('contains the new Go ORMs alongside Node ORMs', () => {
    expect(ORM_PROVIDERS).toContain('sqlc');
    expect(ORM_PROVIDERS).toContain('ent');
    expect(ORM_PROVIDERS).toContain('gorm');
    expect(ORM_PROVIDERS).toContain('prisma');
  });

  it('splits providers into node and go families', () => {
    for (const orm of NODE_ORM_PROVIDERS) {
      expect(ormBackendFamily(orm as OrmProvider)).toBe('node');
    }
    for (const orm of GO_ORM_PROVIDERS) {
      expect(ormBackendFamily(orm as OrmProvider)).toBe('go');
    }
  });

  it('keeps families disjoint', () => {
    const overlap = (NODE_ORM_PROVIDERS as readonly string[]).filter((o) =>
      (GO_ORM_PROVIDERS as readonly string[]).includes(o),
    );
    expect(overlap).toEqual([]);
  });
});

describe('CLI cross-validation of --orm vs --components', () => {
  const CLI = join(import.meta.dirname, '../dist/index.js');

  function runCli(argv: string[]): { code: number; stderr: string } {
    try {
      execSync(`node "${CLI}" ${argv.join(' ')}`, {
        stdio: 'pipe',
        env: { ...process.env, NO_COLOR: '1' },
      });
      return { code: 0, stderr: '' };
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer };
      return {
        code: e.status ?? 1,
        stderr: e.stderr ? e.stderr.toString() : '',
      };
    }
  }

  let dest: string;

  beforeEach(() => {
    dest = join(tmpdir(), `projx-cli-orm-${Date.now()}`);
  });

  afterEach(async () => {
    await rm(dest, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  });

  it('rejects --orm sqlc with --components fastify', () => {
    const result = runCli([
      dest,
      '--components',
      'fastify',
      '--orm',
      'sqlc',
      '--no-git',
      '--no-install',
    ]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/sqlc/);
    expect(result.stderr).toMatch(/go/i);
  });

  it('rejects --orm prisma with --components go only', () => {
    const result = runCli([
      dest,
      '--components',
      'go',
      '--orm',
      'prisma',
      '--no-git',
      '--no-install',
    ]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/prisma/);
  });

  it('rejects an unknown --orm value', () => {
    const result = runCli([
      dest,
      '--components',
      'go',
      '--orm',
      'bogus',
      '--no-git',
      '--no-install',
    ]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/Invalid --orm/);
  });
});

describe('detect picks up Go ORM signals', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `projx-detect-go-orm-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  });

  it('flags sqlc when sqlc.yaml is present alongside go.mod', async () => {
    await mkdir(join(tmp, 'api'));
    await writeFile(join(tmp, 'api/go.mod'), 'module example.com/api\n');
    await writeFile(
      join(tmp, 'api/sqlc.yaml'),
      'version: "2"\nsql:\n  - schema: schema.sql\n',
    );

    const results = await detectComponents(tmp);
    const go = results.find((r) => r.component === 'go');
    expect(go).toBeDefined();
    expect(go?.orm).toBe('sqlc');
    expect(go?.evidence).toMatch(/sqlc/);
  });

  it('flags ent when ent/schema/ is present alongside go.mod', async () => {
    await mkdir(join(tmp, 'api/ent/schema'), { recursive: true });
    await writeFile(join(tmp, 'api/go.mod'), 'module example.com/api\n');
    await writeFile(join(tmp, 'api/ent/schema/user.go'), 'package schema\n');

    const results = await detectComponents(tmp);
    const go = results.find((r) => r.component === 'go');
    expect(go).toBeDefined();
    expect(go?.orm).toBe('ent');
    expect(go?.evidence).toMatch(/ent/);
  });

  it('leaves orm undefined for a vanilla Go module', async () => {
    await mkdir(join(tmp, 'api'));
    await writeFile(join(tmp, 'api/go.mod'), 'module example.com/api\n');

    const results = await detectComponents(tmp);
    const go = results.find((r) => r.component === 'go');
    expect(go).toBeDefined();
    expect(go?.orm).toBeUndefined();
  });
});
