import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  resolveInstanceOrm,
  readComponentMarker,
  writeComponentMarker,
  upsertComponentMarker,
  discoverComponentsFromMarkers,
} from '../src/utils.js';
import { scaffold } from '../src/scaffold.js';
import { add } from '../src/add.js';
import { update } from '../src/update.js';

const REPO_DIR = join(import.meta.dirname, '../..');

describe('resolveInstanceOrm', () => {
  it('uses the instance orm when set, regardless of the global', () => {
    expect(resolveInstanceOrm('fastify', 'drizzle', 'prisma')).toBe('drizzle');
    expect(resolveInstanceOrm('go', 'ent', 'gorm')).toBe('ent');
  });

  it('falls back to the global orm when it matches the component family', () => {
    expect(resolveInstanceOrm('fastify', undefined, 'sequelize')).toBe(
      'sequelize',
    );
    expect(resolveInstanceOrm('go', undefined, 'sqlc')).toBe('sqlc');
  });

  it('ignores a cross-family global and uses the family default', () => {
    expect(resolveInstanceOrm('go', undefined, 'prisma')).toBe('gorm');
    expect(resolveInstanceOrm('fastify', undefined, 'sqlc')).toBe('prisma');
    expect(resolveInstanceOrm('rust', undefined, 'prisma')).toBe('seaorm');
    expect(resolveInstanceOrm('laravel', undefined, 'gorm')).toBe('eloquent');
  });

  it('returns the family default when no orm is known', () => {
    expect(resolveInstanceOrm('fastify', undefined, undefined)).toBe('prisma');
    expect(resolveInstanceOrm('go', undefined, undefined)).toBe('gorm');
  });

  it('returns undefined for non-backend components', () => {
    expect(resolveInstanceOrm('vitejs', undefined, 'prisma')).toBeUndefined();
    expect(resolveInstanceOrm('e2e', undefined, 'drizzle')).toBeUndefined();
  });
});

describe('component marker orm round-trip', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('persists and reads back a per-instance orm', async () => {
    dir = await mkdtemp(join(tmpdir(), 'projx-marker-orm-'));
    await writeComponentMarker(dir, {
      component: 'fastify',
      skip: [],
      orm: 'drizzle',
    });
    const marker = await readComponentMarker(dir);
    expect(marker?.orm).toBe('drizzle');
  });

  it('omits orm from the marker when not set', async () => {
    dir = await mkdtemp(join(tmpdir(), 'projx-marker-orm-'));
    await writeComponentMarker(dir, { component: 'fastify', skip: [] });
    const raw = await readFile(join(dir, '.projx-component'), 'utf-8');
    expect(raw).not.toContain('orm');
  });

  it('preserves an existing orm when a later write omits it', async () => {
    dir = await mkdtemp(join(tmpdir(), 'projx-marker-orm-'));
    await writeComponentMarker(dir, {
      component: 'go',
      skip: [],
      orm: 'ent',
    });
    await upsertComponentMarker(dir, 'go', ['main.go']);
    const marker = await readComponentMarker(dir);
    expect(marker?.orm).toBe('ent');
    expect(marker?.skip).toEqual(['main.go']);
  });

  it('ignores an unknown orm value in a marker', async () => {
    dir = await mkdtemp(join(tmpdir(), 'projx-marker-orm-'));
    await writeComponentMarker(dir, { component: 'fastify', skip: [] });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(dir, '.projx-component'),
      JSON.stringify({ component: 'fastify', skip: [], orm: 'mongoose' }),
    );
    const marker = await readComponentMarker(dir);
    expect(marker?.orm).toBeUndefined();
  });
});

describe('discoverComponentsFromMarkers surfaces per-instance orm', () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it('reads orm off each instance marker', async () => {
    dest = join(tmpdir(), `projx-discover-orm-${Date.now()}`);
    await scaffold(
      { name: 'disc', components: ['fastify'], git: false, install: false },
      dest,
      REPO_DIR,
    );
    await writeComponentMarker(join(dest, 'fastify'), {
      component: 'fastify',
      skip: [],
      orm: 'drizzle',
    });

    const { instances } = await discoverComponentsFromMarkers(dest);
    const fastify = instances.find((i) => i.path === 'fastify');
    expect(fastify?.orm).toBe('drizzle');
  });
});

describe('heterogeneous ORMs within one project', () => {
  let dest: string;

  afterEach(async () => {
    if (dest)
      await rm(dest, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
  });

  it('add <type> --name <dir> --orm <x> gives the new instance its own ORM', async () => {
    dest = join(tmpdir(), `projx-hetero-orm-${Date.now()}`);
    await scaffold(
      { name: 'hetero', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await add(
      dest,
      ['fastify'],
      REPO_DIR,
      true,
      'worker',
      undefined,
      'drizzle',
    );

    expect(existsSync(join(dest, 'fastify/prisma/schema.prisma'))).toBe(true);
    expect(existsSync(join(dest, 'fastify/drizzle.config.ts'))).toBe(false);

    expect(existsSync(join(dest, 'worker/drizzle.config.ts'))).toBe(true);
    expect(existsSync(join(dest, 'worker/prisma/schema.prisma'))).toBe(false);

    const workerPkg = JSON.parse(
      await readFile(join(dest, 'worker/package.json'), 'utf-8'),
    );
    expect(workerPkg.dependencies['drizzle-orm']).toBeTruthy();

    const workerMarker = JSON.parse(
      await readFile(join(dest, 'worker/.projx-component'), 'utf-8'),
    );
    expect(workerMarker.orm).toBe('drizzle');

    const fastifyMarker = JSON.parse(
      await readFile(join(dest, 'fastify/.projx-component'), 'utf-8'),
    );
    expect(fastifyMarker.orm).toBeUndefined();

    const setup = await readFile(join(dest, 'scripts/setup.sh'), 'utf-8');
    expect(setup).toContain('drizzle-kit push --force');
    expect(setup).toContain('prisma migrate dev');

    const ci = await readFile(join(dest, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toContain('drizzle-kit push --force');
    expect(ci).toContain('prisma migrate deploy');

    const fastifyDockerfile = await readFile(
      join(dest, 'fastify/Dockerfile'),
      'utf-8',
    );
    expect(fastifyDockerfile).toContain('prisma migrate deploy');
    expect(fastifyDockerfile).not.toContain('drizzle-kit');

    const workerDockerfile = await readFile(
      join(dest, 'worker/Dockerfile'),
      'utf-8',
    );
    expect(workerDockerfile).toContain('drizzle-kit push --force');
    expect(workerDockerfile).not.toContain('prisma migrate');
  }, 90000);

  it('keeps each instance on its own ORM through update', async () => {
    dest = join(tmpdir(), `projx-hetero-update-${Date.now()}`);
    await scaffold(
      { name: 'heteroup', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );
    await add(
      dest,
      ['fastify'],
      REPO_DIR,
      true,
      'worker',
      undefined,
      'drizzle',
    );
    execSync('git add -A', { cwd: dest, stdio: 'pipe' });
    try {
      execSync("git -c core.hooksPath=/dev/null commit -m 'add worker'", {
        cwd: dest,
        stdio: 'pipe',
      });
    } catch {
      // add already committed; tree is clean
    }

    await update(dest, REPO_DIR);

    expect(existsSync(join(dest, 'worker/drizzle.config.ts'))).toBe(true);
    expect(existsSync(join(dest, 'fastify/prisma/schema.prisma'))).toBe(true);

    const workerMarker = await readComponentMarker(join(dest, 'worker'));
    expect(workerMarker?.orm).toBe('drizzle');

    const setup = await readFile(join(dest, 'scripts/setup.sh'), 'utf-8');
    expect(setup).toContain('drizzle-kit push --force');
    expect(setup).toContain('prisma migrate dev');
  }, 90000);

  it('rejects an ORM whose family does not match the added component', async () => {
    dest = join(tmpdir(), `projx-orm-mismatch-${Date.now()}`);
    await scaffold(
      { name: 'mismatch', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await expect(
      add(dest, ['go'], REPO_DIR, true, undefined, undefined, 'drizzle'),
    ).rejects.toThrow(/drizzle/);
  }, 60000);
});
