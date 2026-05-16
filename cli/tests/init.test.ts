import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { init } from '../src/init.js';
import { detectComponents } from '../src/detect.js';
import { discoverComponentPaths, upsertComponentMarker } from '../src/utils.js';
import type { Component } from '../src/utils.js';

const REPO_DIR = join(import.meta.dirname, '../..');

describe('init workflow', () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
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
    expect(map.frontend).toBe('web');
    expect(map.e2e).toBe('tests');
  });

  it('writes markers and discovers paths correctly', async () => {
    tmp = join(tmpdir(), `projx-init-${Date.now()}`);
    await mkdir(tmp, { recursive: true });

    await mkdir(join(tmp, 'backend'));
    await upsertComponentMarker(join(tmp, 'backend'), 'fastapi');

    await mkdir(join(tmp, 'web'));
    await upsertComponentMarker(join(tmp, 'web'), 'frontend');

    const paths = await discoverComponentPaths(tmp, [
      'fastapi',
      'frontend',
    ] as Component[]);
    expect(paths.fastapi).toBe('backend');
    expect(paths.frontend).toBe('web');
  });

  it('detection + marker + discovery roundtrip', async () => {
    tmp = join(tmpdir(), `projx-init-${Date.now()}`);
    await mkdir(tmp, { recursive: true });

    await mkdir(join(tmp, 'backend'));
    await writeFile(
      join(tmp, 'backend/package.json'),
      JSON.stringify({ dependencies: { fastify: '^5' } }),
    );

    await mkdir(join(tmp, 'frontend'));
    await writeFile(
      join(tmp, 'frontend/package.json'),
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
    expect(paths.frontend).toBe('frontend');
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
    expect(cfg.skip).toContain('scripts/setup.sh');
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
    if (tmp) await rm(tmp, { recursive: true, force: true });
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
