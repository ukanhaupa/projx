import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { init } from '../src/init.js';
import { detectComponents } from '../src/detect.js';
import { discoverComponentPaths, upsertComponentMarker } from '../src/utils.js';
import * as utilsModule from '../src/utils.js';
import type { Component } from '../src/utils.js';

vi.mock('@clack/prompts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clack/prompts')>();
  return {
    ...actual,
    confirm: vi.fn(),
    select: vi.fn(),
    isCancel: (v: unknown) => v === Symbol.for('clack.cancel'),
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execSync: vi.fn(actual.execSync) };
});

import * as p from '@clack/prompts';

const CANCEL = Symbol.for('clack.cancel');

const REPO_DIR = join(import.meta.dirname, '../..');

async function gitFixture(dir: string): Promise<void> {
  execSync('git init --quiet', { cwd: dir });
  execSync('git -c core.hooksPath=/dev/null add -A', { cwd: dir });
  execSync(
    'git -c core.hooksPath=/dev/null -c user.email=a@a -c user.name=a commit --allow-empty -m init --quiet',
    { cwd: dir },
  );
}

describe('init workflow', () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp)
      await rm(tmp, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
  });

  it('detects components in an existing project structure', async () => {
    tmp = join(tmpdir(), `projx-init-${Date.now()}`);
    await mkdir(tmp, { recursive: true });

    await mkdir(join(tmp, 'backend'));
    await writeFile(
      join(tmp, 'backend/pyproject.toml'),
      '[project]\ndependencies = ["fastapi"]',
    );

    await mkdir(join(tmp, 'web'));
    await writeFile(
      join(tmp, 'web/package.json'),
      JSON.stringify({ dependencies: { react: '^19' } }),
    );

    await mkdir(join(tmp, 'tests'));
    await writeFile(
      join(tmp, 'tests/package.json'),
      JSON.stringify({ devDependencies: { '@playwright/test': '^1' } }),
    );

    const detected = await detectComponents(tmp);
    expect(detected).toHaveLength(3);

    const map = Object.fromEntries(
      detected.map((d) => [d.component, d.directory]),
    );
    expect(map.fastapi).toBe('backend');
    expect(map.vitejs).toBe('web');
    expect(map.e2e).toBe('tests');
  });

  it('writes markers and discovers paths correctly', async () => {
    tmp = join(tmpdir(), `projx-init-${Date.now()}`);
    await mkdir(tmp, { recursive: true });

    await mkdir(join(tmp, 'backend'));
    await upsertComponentMarker(join(tmp, 'backend'), 'fastapi');

    await mkdir(join(tmp, 'web'));
    await upsertComponentMarker(join(tmp, 'web'), 'vitejs');

    const paths = await discoverComponentPaths(tmp, [
      'fastapi',
      'vitejs',
    ] as Component[]);
    expect(paths.fastapi).toBe('backend');
    expect(paths.vitejs).toBe('web');
  });

  it('detection + marker + discovery roundtrip', async () => {
    tmp = join(tmpdir(), `projx-init-${Date.now()}`);
    await mkdir(tmp, { recursive: true });

    await mkdir(join(tmp, 'backend'));
    await writeFile(
      join(tmp, 'backend/package.json'),
      JSON.stringify({ dependencies: { fastify: '^5' } }),
    );

    await mkdir(join(tmp, 'vitejs'));
    await writeFile(
      join(tmp, 'vitejs/package.json'),
      JSON.stringify({ dependencies: { react: '^19' } }),
    );

    const detected = await detectComponents(tmp);
    expect(detected).toHaveLength(2);

    for (const d of detected) {
      await upsertComponentMarker(join(tmp, d.directory), d.component);
    }

    const components = detected.map((d) => d.component) as Component[];
    const paths = await discoverComponentPaths(tmp, components);
    expect(paths.fastify).toBe('backend');
    expect(paths.vitejs).toBe('vitejs');
  });

  it('init in an empty git repo writes a bare .projx without prompting', async () => {
    tmp = join(tmpdir(), `projx-init-bare-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
    execSync('git init --quiet', { cwd: tmp });
    execSync(
      'git -c user.email=a@a -c user.name=a commit --allow-empty -m init --quiet',
      { cwd: tmp },
    );

    await init(tmp, REPO_DIR);

    expect(existsSync(join(tmp, '.projx'))).toBe(true);
    const cfg = JSON.parse(await readFile(join(tmp, '.projx'), 'utf-8'));
    expect(cfg.defaultsApplied).toBe(true);
    expect(cfg.skip).toEqual([]);
    expect(cfg.version).toMatch(/^\d+\.\d+\.\d+/);

    expect(existsSync(join(tmp, 'docker-compose.yml'))).toBe(false);
    expect(existsSync(join(tmp, 'scripts/setup.sh'))).toBe(false);
    expect(existsSync(join(tmp, 'fastify'))).toBe(false);
  });
});

describe('init — guard rails', () => {
  let tmp: string;
  const origExit = process.exit;

  afterEach(async () => {
    if (tmp)
      await rm(tmp, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    process.exit = origExit;
  });

  it('exits when .projx already exists', async () => {
    tmp = join(tmpdir(), `projx-init-already-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
    execSync('git init --quiet', { cwd: tmp });
    await writeFile(join(tmp, '.projx'), '{}');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('EXIT');
    });

    await expect(init(tmp, REPO_DIR)).rejects.toThrow('EXIT');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits outside a git repo', async () => {
    tmp = join(tmpdir(), `projx-init-no-git-${Date.now()}`);
    await mkdir(tmp, { recursive: true });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('EXIT');
    });

    await expect(init(tmp, REPO_DIR)).rejects.toThrow('EXIT');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when working tree has uncommitted changes', async () => {
    tmp = join(tmpdir(), `projx-init-dirty-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
    execSync('git init --quiet', { cwd: tmp });
    execSync(
      'git -c user.email=a@a -c user.name=a commit --allow-empty -m init --quiet',
      { cwd: tmp },
    );
    await writeFile(join(tmp, 'stray.txt'), 'uncommitted\n');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('EXIT');
    });

    await expect(init(tmp, REPO_DIR)).rejects.toThrow('EXIT');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('init — detected components', () => {
  let tmp: string;
  const origExit = process.exit;
  const origIsTTY = process.stdin.isTTY;

  afterEach(async () => {
    if (tmp)
      await rm(tmp, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    process.exit = origExit;
    Object.defineProperty(process.stdin, 'isTTY', {
      value: origIsTTY,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('registers a confirmed component and reports conflicts when a root file differs', async () => {
    tmp = join(tmpdir(), `projx-init-confirm-${Date.now()}`);
    await mkdir(join(tmp, 'fastify'), { recursive: true });
    await writeFile(
      join(tmp, 'fastify/package.json'),
      JSON.stringify({ name: 'old-api', dependencies: { fastify: '^5' } }),
    );
    await writeFile(join(tmp, 'package-lock.json'), '{}');
    await writeFile(
      join(tmp, '.editorconfig'),
      'root = false\n[*]\nindent_size = 8\n',
    );
    await gitFixture(tmp);

    vi.mocked(p.confirm).mockResolvedValue(true as never);
    const warnSpy = vi.spyOn(p.log, 'warn');

    await init(tmp, REPO_DIR);

    expect(p.confirm).toHaveBeenCalledTimes(1);
    expect(existsSync(join(tmp, 'fastify/.projx-component'))).toBe(true);
    const marker = JSON.parse(
      await readFile(join(tmp, 'fastify/.projx-component'), 'utf-8'),
    );
    expect(marker.component).toBe('fastify');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('differ from your code'),
    );
  });

  it('configures core.hooksPath when .githooks exists after apply', async () => {
    tmp = join(tmpdir(), `projx-init-hooks-${Date.now()}`);
    await mkdir(join(tmp, 'fastify'), { recursive: true });
    await writeFile(
      join(tmp, 'fastify/package.json'),
      JSON.stringify({ name: 'old-api', dependencies: { fastify: '^5' } }),
    );
    await writeFile(join(tmp, 'package-lock.json'), '{}');
    await mkdir(join(tmp, '.githooks'), { recursive: true });
    await writeFile(join(tmp, '.githooks/pre-commit'), '#!/bin/sh\n');
    await gitFixture(tmp);

    vi.mocked(p.confirm).mockResolvedValue(true as never);

    await init(tmp, REPO_DIR);

    const hooksPath = execSync('git config core.hooksPath', { cwd: tmp })
      .toString()
      .trim();
    expect(hooksPath).toBe('.githooks');
  });

  it('applies a clean template when the detected dir does not collide (merged/clean path)', async () => {
    tmp = join(tmpdir(), `projx-init-clean-${Date.now()}`);
    await mkdir(join(tmp, 'infra'), { recursive: true });
    await writeFile(join(tmp, 'infra/variables.tf'), 'variable "region" {}\n');
    await gitFixture(tmp);

    vi.mocked(p.confirm).mockResolvedValue(true as never);

    await init(tmp, REPO_DIR);

    expect(existsSync(join(tmp, 'infra/.projx-component'))).toBe(true);
    expect(existsSync(join(tmp, 'infra/stack/versions.tf'))).toBe(true);
  });

  it('prompts for the package manager when no lockfile is present (TTY)', async () => {
    tmp = join(tmpdir(), `projx-init-pm-${Date.now()}`);
    await mkdir(join(tmp, 'fastify'), { recursive: true });
    await writeFile(
      join(tmp, 'fastify/package.json'),
      JSON.stringify({ name: 'old-api', dependencies: { fastify: '^5' } }),
    );
    await gitFixture(tmp);

    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });
    vi.mocked(p.confirm).mockResolvedValue(true as never);
    vi.mocked(p.select).mockResolvedValue('pnpm' as never);

    await init(tmp, REPO_DIR);

    expect(p.select).toHaveBeenCalledTimes(1);
    const cfg = JSON.parse(await readFile(join(tmp, '.projx'), 'utf-8'));
    expect(cfg.packageManager).toBe('pnpm');
  });

  it('detects the package manager from a component-dir lockfile without prompting', async () => {
    tmp = join(tmpdir(), `projx-init-pm-component-${Date.now()}`);
    await mkdir(join(tmp, 'fastify'), { recursive: true });
    await writeFile(
      join(tmp, 'fastify/package.json'),
      JSON.stringify({ name: 'old-api', dependencies: { fastify: '^5' } }),
    );
    await writeFile(
      join(tmp, 'fastify/pnpm-lock.yaml'),
      'lockfileVersion: 9.0\n',
    );
    await gitFixture(tmp);

    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      configurable: true,
    });
    vi.mocked(p.confirm).mockResolvedValue(true as never);
    vi.mocked(p.select).mockClear();

    await init(tmp, REPO_DIR);

    expect(p.select).not.toHaveBeenCalled();
    const cfg = JSON.parse(await readFile(join(tmp, '.projx'), 'utf-8'));
    expect(cfg.packageManager).toBe('pnpm');
  });

  it('exits 0 when the package-manager prompt is cancelled', async () => {
    tmp = join(tmpdir(), `projx-init-pm-cancel-${Date.now()}`);
    await mkdir(join(tmp, 'fastify'), { recursive: true });
    await writeFile(
      join(tmp, 'fastify/package.json'),
      JSON.stringify({ name: 'old-api', dependencies: { fastify: '^5' } }),
    );
    await gitFixture(tmp);

    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });
    vi.mocked(p.confirm).mockResolvedValue(true as never);
    vi.mocked(p.select).mockResolvedValue(CANCEL as never);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('EXIT');
    });

    await expect(init(tmp, REPO_DIR)).rejects.toThrow('EXIT');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('warns and exits 0 when every detected component is rejected', async () => {
    tmp = join(tmpdir(), `projx-init-reject-${Date.now()}`);
    await mkdir(join(tmp, 'fastify'), { recursive: true });
    await writeFile(
      join(tmp, 'fastify/package.json'),
      JSON.stringify({ name: 'old-api', dependencies: { fastify: '^5' } }),
    );
    await gitFixture(tmp);

    vi.mocked(p.confirm).mockResolvedValue(false as never);
    const warnSpy = vi.spyOn(p.log, 'warn');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('EXIT');
    });

    await expect(init(tmp, REPO_DIR)).rejects.toThrow('EXIT');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No components selected'),
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits 0 when a component confirmation is cancelled', async () => {
    tmp = join(tmpdir(), `projx-init-confirm-cancel-${Date.now()}`);
    await mkdir(join(tmp, 'fastify'), { recursive: true });
    await writeFile(
      join(tmp, 'fastify/package.json'),
      JSON.stringify({ name: 'old-api', dependencies: { fastify: '^5' } }),
    );
    await gitFixture(tmp);

    vi.mocked(p.confirm).mockResolvedValue(CANCEL as never);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('EXIT');
    });

    await expect(init(tmp, REPO_DIR)).rejects.toThrow('EXIT');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('treats a project as clean when git status throws', async () => {
    tmp = join(tmpdir(), `projx-init-status-throw-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
    await gitFixture(tmp);

    const real = vi.mocked(execSync).getMockImplementation()!;
    vi.mocked(execSync).mockImplementation(((cmd: unknown, opts?: unknown) => {
      if (String(cmd).includes('status --porcelain')) {
        throw new Error('git status failed');
      }
      return real(cmd as never, opts as never);
    }) as typeof execSync);

    await init(tmp, REPO_DIR);
    vi.mocked(execSync).mockImplementation(real as typeof execSync);

    expect(existsSync(join(tmp, '.projx'))).toBe(true);
  });

  it('exits 1 when template download fails for detected components', async () => {
    tmp = join(tmpdir(), `projx-init-dl-fail-${Date.now()}`);
    await mkdir(join(tmp, 'fastify'), { recursive: true });
    await writeFile(
      join(tmp, 'fastify/package.json'),
      JSON.stringify({ name: 'old-api', dependencies: { fastify: '^5' } }),
    );
    await writeFile(join(tmp, 'package-lock.json'), '{}');
    await gitFixture(tmp);

    vi.mocked(p.confirm).mockResolvedValue(true as never);
    vi.spyOn(utilsModule, 'downloadRepo').mockRejectedValue(
      new Error('network down'),
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('EXIT');
    });

    await expect(init(tmp, REPO_DIR)).rejects.toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 when template download fails for a bare init', async () => {
    tmp = join(tmpdir(), `projx-init-dl-fail-bare-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
    await gitFixture(tmp);

    vi.spyOn(utilsModule, 'downloadRepo').mockRejectedValue(
      new Error('network down'),
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('EXIT');
    });

    await expect(init(tmp, REPO_DIR)).rejects.toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
