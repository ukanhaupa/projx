import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyGomodOverrides,
  ormGoDockerfileSource,
  type OrmManifest,
} from '../src/baseline.js';

describe('applyGomodOverrides', () => {
  let dir: string;
  let goModPath: string;

  beforeEach(async () => {
    dir = await import('node:fs/promises').then((m) =>
      m.mkdtemp(join(tmpdir(), 'projx-gomod-')),
    );
    goModPath = join(dir, 'go.mod');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns silently when go.mod does not exist', async () => {
    await applyGomodOverrides(goModPath, { add: { 'a/b': 'v1.0.0' } });
    expect(existsSync(goModPath)).toBe(false);
  });

  it('appends a new require block when go.mod has none', async () => {
    await writeFile(goModPath, 'module example.com/app\n\ngo 1.25\n');
    await applyGomodOverrides(goModPath, {
      add: { 'entgo.io/ent': 'v0.14.1' },
    });
    const out = await readFile(goModPath, 'utf-8');
    expect(out).toContain('require (');
    expect(out).toContain('entgo.io/ent v0.14.1');
  });

  it('skips appending when no additions and no existing block', async () => {
    const original = 'module example.com/app\n\ngo 1.25\n';
    await writeFile(goModPath, original);
    await applyGomodOverrides(goModPath, { remove: ['nothing/here'] });
    const out = await readFile(goModPath, 'utf-8');
    expect(out).toBe(original);
  });

  it('removes and upgrades modules inside an existing require block', async () => {
    await writeFile(
      goModPath,
      [
        'module example.com/app',
        '',
        'go 1.25',
        '',
        'require (',
        '\tgorm.io/gorm v1.25.0',
        '\tgorm.io/driver/postgres v1.5.0',
        '\tgithub.com/keep/me v1.0.0',
        ')',
        '',
      ].join('\n'),
    );

    await applyGomodOverrides(goModPath, {
      remove: ['gorm.io/gorm', 'gorm.io/driver/postgres'],
      add: { 'entgo.io/ent': 'v0.14.1', 'github.com/keep/me': 'v1.2.3' },
    });

    const out = await readFile(goModPath, 'utf-8');
    expect(out).not.toContain('gorm.io/gorm');
    expect(out).not.toContain('gorm.io/driver/postgres');
    expect(out).toContain('github.com/keep/me v1.2.3');
    expect(out).toContain('entgo.io/ent v0.14.1');
  });

  it('preserves non-module lines inside require block (comments, blank)', async () => {
    await writeFile(
      goModPath,
      [
        'module example.com/app',
        '',
        'go 1.25',
        '',
        'require (',
        '\t// indirect deps below',
        '\tgithub.com/x/y v0.1.0',
        ')',
        '',
      ].join('\n'),
    );
    await applyGomodOverrides(goModPath, { add: {} });
    const out = await readFile(goModPath, 'utf-8');
    expect(out).toContain('// indirect deps below');
    expect(out).toContain('github.com/x/y v0.1.0');
  });
});

describe('ormGoDockerfileSource', () => {
  it('emits multi-stage distroless Dockerfile with no extras', () => {
    const manifest: OrmManifest = {
      name: 'foo',
      displayName: 'Foo',
      frameworks: ['go'],
      removeFromBase: [],
    };
    const out = ormGoDockerfileSource(manifest);
    expect(out).toContain('FROM golang:1.25-alpine AS builder');
    expect(out).toContain('FROM gcr.io/distroless/static-debian12:nonroot');
    expect(out).toContain('CGO_ENABLED=0');
    expect(out).toContain('USER nonroot');
    expect(out).not.toMatch(/^COPY {2}\.\/$/m);
  });

  it('includes COPY for extraConfigFiles when present', () => {
    const manifest = {
      name: 'sqlc',
      displayName: 'sqlc',
      frameworks: ['go'],
      removeFromBase: [],
      dockerfile: { extraConfigFiles: ['sqlc.yaml', 'migrations'] },
    } as unknown as OrmManifest;
    const out = ormGoDockerfileSource(manifest);
    expect(out).toContain('COPY sqlc.yaml migrations ./');
  });

  it('runs preBuild step before final build', () => {
    const manifest = {
      name: 'ent',
      displayName: 'ent',
      frameworks: ['go'],
      removeFromBase: [],
      dockerfile: { preBuild: 'go generate ./...' },
    } as unknown as OrmManifest;
    const out = ormGoDockerfileSource(manifest);
    expect(out).toMatch(/RUN go generate \.\/\.\.\.\n/);
    expect(out.indexOf('RUN go generate')).toBeLessThan(
      out.indexOf('go build'),
    );
  });
});

describe('applyOrmAddon via scaffold (framework=go branch)', () => {
  let dest: string;

  beforeEach(async () => {
    dest = join(tmpdir(), `projx-go-orm-${Date.now()}`);
  });

  afterEach(async () => {
    await rm(dest, { recursive: true, force: true });
  });

  it('scaffolds a Go project with --orm=sqlc and emits the Go Dockerfile', async () => {
    const { scaffold } = await import('../src/scaffold.js');
    const REPO_DIR = join(import.meta.dirname, '../..');

    await scaffold(
      {
        name: 'go-sqlc-test',
        components: ['go'],
        orm: 'sqlc',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const dockerfile = await readFile(join(dest, 'go/Dockerfile'), 'utf-8');
    expect(dockerfile).toContain('FROM golang:1.25-alpine AS builder');
    expect(dockerfile).toContain('FROM gcr.io/distroless/static-debian12');
    expect(dockerfile).toContain('COPY sqlc.yaml migrations ./');
    expect(existsSync(join(dest, 'go/sqlc.yaml'))).toBe(true);
    expect(existsSync(join(dest, 'go/main.go'))).toBe(true);
    expect(existsSync(join(dest, 'go/internal/entities/auto_routes.go'))).toBe(
      true,
    );
  }, 60000);

  it('scaffolds a Go project with --orm=ent and applies gomodOverrides', async () => {
    const { scaffold } = await import('../src/scaffold.js');
    const REPO_DIR = join(import.meta.dirname, '../..');

    await scaffold(
      {
        name: 'go-ent-test',
        components: ['go'],
        orm: 'ent',
        git: false,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const dockerfile = await readFile(join(dest, 'go/Dockerfile'), 'utf-8');
    expect(dockerfile).toContain('FROM golang:1.25-alpine AS builder');
    expect(existsSync(join(dest, 'go/ent/schema/post.go'))).toBe(true);
    expect(existsSync(join(dest, 'go/main.go'))).toBe(true);
  }, 60000);
});
