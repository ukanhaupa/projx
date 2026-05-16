import { describe, it, expect, afterEach } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffold } from '../src/scaffold.js';
import { pin, unpin } from '../src/pin.js';

const REPO_DIR = join(import.meta.dirname, '../..');

describe('pin', () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it('pins a root-level file to .projx skip', async () => {
    dest = join(tmpdir(), `projx-pin-root-${Date.now()}`);
    await scaffold(
      { name: 'pin-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await pin(dest, ['README.md', 'docker-compose.yml']);

    const config = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));
    expect(config.skip).toContain('README.md');
    expect(config.skip).toContain('docker-compose.yml');
  });

  it('pins a component file to component marker skip', async () => {
    dest = join(tmpdir(), `projx-pin-comp-${Date.now()}`);
    await scaffold(
      { name: 'pin-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await pin(dest, ['fastify/src/app.ts', 'fastify/Dockerfile']);

    const marker = JSON.parse(
      await readFile(join(dest, 'fastify/.projx-component'), 'utf-8'),
    );
    expect(marker.skip).toContain('src/app.ts');
    expect(marker.skip).toContain('Dockerfile');
  });

  it('does not duplicate existing patterns', async () => {
    dest = join(tmpdir(), `projx-pin-dedup-${Date.now()}`);
    await scaffold(
      { name: 'pin-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await pin(dest, ['README.md']);
    await pin(dest, ['README.md']);

    const config = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));
    const count = config.skip.filter((s: string) => s === 'README.md').length;
    expect(count).toBe(1);
  });

  it('rejects pinning .projx config files', async () => {
    dest = join(tmpdir(), `projx-pin-reject-${Date.now()}`);
    await scaffold(
      { name: 'pin-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const before = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));
    await pin(dest, ['.projx']);
    const after = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));
    expect(after.skip).toEqual(before.skip);
    expect(after.skip).not.toContain('.projx');
  });

  it('pins glob patterns', async () => {
    dest = join(tmpdir(), `projx-pin-glob-${Date.now()}`);
    await scaffold(
      { name: 'pin-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await pin(dest, ['fastify/src/**']);

    const marker = JSON.parse(
      await readFile(join(dest, 'fastify/.projx-component'), 'utf-8'),
    );
    expect(marker.skip).toContain('src/**');
  });
});

describe('unpin', () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it('removes a pinned root pattern', async () => {
    dest = join(tmpdir(), `projx-unpin-root-${Date.now()}`);
    await scaffold(
      { name: 'unpin-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await pin(dest, ['README.md', 'docker-compose.yml']);
    await unpin(dest, ['README.md']);

    const config = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));
    expect(config.skip).not.toContain('README.md');
    expect(config.skip).toContain('docker-compose.yml');
  });

  it('removes a pinned component pattern', async () => {
    dest = join(tmpdir(), `projx-unpin-comp-${Date.now()}`);
    await scaffold(
      { name: 'unpin-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await pin(dest, ['fastify/src/app.ts', 'fastify/Dockerfile']);
    await unpin(dest, ['fastify/src/app.ts']);

    const marker = JSON.parse(
      await readFile(join(dest, 'fastify/.projx-component'), 'utf-8'),
    );
    expect(marker.skip).not.toContain('src/app.ts');
    expect(marker.skip).toContain('Dockerfile');
  });

  it('can unpin a default skip pattern', async () => {
    dest = join(tmpdir(), `projx-unpin-last-${Date.now()}`);
    await scaffold(
      { name: 'unpin-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const before = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));
    expect(before.skip).toContain('README.md');

    await unpin(dest, ['README.md']);

    const after = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));
    expect(after.skip).not.toContain('README.md');
  });

  it("noop unpin a pattern that wasn't pinned in the first place", async () => {
    dest = join(tmpdir(), `projx-unpin-missing-${Date.now()}`);
    await scaffold(
      { name: 'miss-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const before = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));
    await unpin(dest, ['nonexistent-pattern.txt']);
    const after = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));

    expect(after.skip).toEqual(before.skip);
  });

  it("unpin a component pattern that wasn't pinned is a no-op", async () => {
    dest = join(tmpdir(), `projx-unpin-comp-missing-${Date.now()}`);
    await scaffold(
      {
        name: 'miss-comp-app',
        components: ['fastify'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const markerBefore = JSON.parse(
      await readFile(join(dest, 'fastify/.projx-component'), 'utf-8'),
    );
    await unpin(dest, ['fastify/src/app.ts']);
    const markerAfter = JSON.parse(
      await readFile(join(dest, 'fastify/.projx-component'), 'utf-8'),
    );

    expect(markerAfter.skip).toEqual(markerBefore.skip);
  });
});

describe('pin --list', () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it('listPins runs cleanly when there are pins', async () => {
    const { listPins } = await import('../src/pin.js');
    dest = join(tmpdir(), `projx-pin-list-${Date.now()}`);
    await scaffold(
      { name: 'list-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );
    await pin(dest, ['fastify/src/app.ts', 'docker-compose.yml']);

    await expect(listPins(dest)).resolves.not.toThrow();
  });

  it('listPins runs cleanly with no pins after unpinning defaults', async () => {
    const { listPins } = await import('../src/pin.js');
    dest = join(tmpdir(), `projx-pin-list-empty-${Date.now()}`);
    await scaffold(
      { name: 'empty-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const config = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));
    for (const pat of config.skip ?? []) await unpin(dest, [pat]);

    await expect(listPins(dest)).resolves.not.toThrow();
  });

  it('listPins exits when there is no .projx', async () => {
    const { listPins } = await import('../src/pin.js');
    const { vi } = await import('vitest');
    dest = join(tmpdir(), `projx-pin-list-no-projx-${Date.now()}`);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dest, { recursive: true });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('EXIT');
    });
    await expect(listPins(dest)).rejects.toThrow('EXIT');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
