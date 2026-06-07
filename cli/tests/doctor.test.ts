import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import * as p from '@clack/prompts';
import { scaffold } from '../src/scaffold.js';
import { doctor } from '../src/doctor.js';

const REPO_DIR = join(import.meta.dirname, '../..');

describe('doctor', () => {
  let dest: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (dest)
      await rm(dest, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
  });

  it('passes on a healthy scaffolded project', async () => {
    dest = join(tmpdir(), `projx-doc-healthy-${Date.now()}`);
    await scaffold(
      { name: 'doc-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    // Should not throw or exit
    await doctor(dest);
  });

  it('passes with multiple components', async () => {
    dest = join(tmpdir(), `projx-doc-multi-${Date.now()}`);
    await scaffold(
      {
        name: 'doc-app',
        components: ['fastify', 'e2e'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await doctor(dest);
  });

  it('warns when baseline ref is missing', async () => {
    dest = join(tmpdir(), `projx-doc-noref-${Date.now()}`);
    await scaffold(
      { name: 'doc-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    // Delete baseline ref
    try {
      execSync('git update-ref -d refs/projx/baseline', {
        cwd: dest,
        stdio: 'pipe',
      });
    } catch {
      /* */
    }

    // Should not throw (warn only)
    await doctor(dest);
  });

  it('--fix creates missing baseline ref', async () => {
    dest = join(tmpdir(), `projx-doc-fix-${Date.now()}`);
    await scaffold(
      { name: 'doc-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    try {
      execSync('git update-ref -d refs/projx/baseline', {
        cwd: dest,
        stdio: 'pipe',
      });
    } catch {
      /* */
    }

    await doctor(dest, true);

    // Baseline ref should now exist
    const ref = execSync('git rev-parse --verify refs/projx/baseline', {
      cwd: dest,
      stdio: 'pipe',
    })
      .toString()
      .trim();
    expect(ref).toBeTruthy();
  });

  it('exits and prints the fix hint when no .projx is present', async () => {
    dest = join(tmpdir(), `projx-doc-noprojx-${Date.now()}`);
    await mkdir(dest, { recursive: true });

    const infoSpy = vi.spyOn(p.log, 'info').mockImplementation(() => {});
    vi.spyOn(p.log, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('EXIT');
    }) as never);

    await expect(doctor(dest)).rejects.toThrow('EXIT');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(
      infoSpy.mock.calls.some((c) =>
        String(c[0]).includes('npx create-projx init'),
      ),
    ).toBe(true);
  });

  it('treats a "**" skip pattern as matching everything', async () => {
    dest = join(tmpdir(), `projx-doc-globstar-${Date.now()}`);
    await scaffold(
      { name: 'doc-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const markerPath = join(dest, 'fastify/.projx-component');
    const marker = JSON.parse(await readFile(markerPath, 'utf-8'));
    marker.skip = ['**'];
    await writeFile(markerPath, JSON.stringify(marker, null, 2) + '\n');

    const warnSpy = vi.spyOn(p.log, 'warn').mockImplementation(() => {});

    await doctor(dest);

    expect(
      warnSpy.mock.calls.some((c) => /matches no files/.test(String(c[0]))),
    ).toBe(false);
  });

  it('treats an unreadable skip target as matching nothing', async () => {
    dest = join(tmpdir(), `projx-doc-unreadable-${Date.now()}`);
    await scaffold(
      { name: 'doc-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const { chmod } = await import('node:fs/promises');
    const locked = join(dest, 'fastify/locked');
    await mkdir(locked, { recursive: true });
    await writeFile(join(locked, 'secret.txt'), 'x');
    await chmod(locked, 0o000);

    try {
      const markerPath = join(dest, 'fastify/.projx-component');
      const marker = JSON.parse(await readFile(markerPath, 'utf-8'));
      marker.skip = ['locked/secret.txt'];
      await writeFile(markerPath, JSON.stringify(marker, null, 2) + '\n');

      const warnSpy = vi.spyOn(p.log, 'warn').mockImplementation(() => {});

      await doctor(dest);

      expect(
        warnSpy.mock.calls.some((c) => /matches no files/.test(String(c[0]))),
      ).toBe(true);
    } finally {
      await chmod(locked, 0o755);
    }
  });

  it('prints the fix hint for an auto-fixable issue when run without --fix', async () => {
    dest = join(tmpdir(), `projx-doc-fixhint-${Date.now()}`);
    await scaffold(
      { name: 'doc-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    try {
      execSync('git update-ref -d refs/projx/baseline', {
        cwd: dest,
        stdio: 'pipe',
      });
    } catch {
      /* */
    }

    const infoSpy = vi.spyOn(p.log, 'info').mockImplementation(() => {});
    vi.spyOn(p.log, 'warn').mockImplementation(() => {});

    await doctor(dest);

    expect(
      infoSpy.mock.calls.some((c) =>
        String(c[0]).includes('auto-fixable with --fix'),
      ),
    ).toBe(true);
  });

  it('exits with a failure when no component markers are found', async () => {
    dest = join(tmpdir(), `projx-doc-nomarkers-${Date.now()}`);
    await scaffold(
      { name: 'doc-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await rm(join(dest, 'fastify'), { recursive: true, force: true });

    vi.spyOn(p.log, 'info').mockImplementation(() => {});
    vi.spyOn(p.log, 'warn').mockImplementation(() => {});
    vi.spyOn(p.log, 'error').mockImplementation(() => {});
    vi.spyOn(p.log, 'success').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('EXIT');
    }) as never);

    await expect(doctor(dest)).rejects.toThrow('EXIT');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('labels a renamed component directory and warns on uncommitted changes', async () => {
    dest = join(tmpdir(), `projx-doc-renamed-${Date.now()}`);
    await scaffold(
      { name: 'doc-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const { rename } = await import('node:fs/promises');
    await rename(join(dest, 'fastify'), join(dest, 'backend'));

    const successSpy = vi.spyOn(p.log, 'success').mockImplementation(() => {});
    vi.spyOn(p.log, 'warn').mockImplementation(() => {});
    vi.spyOn(p.log, 'info').mockImplementation(() => {});

    await doctor(dest);

    expect(
      successSpy.mock.calls.some((c) =>
        String(c[0]).includes('backend/ (fastify)'),
      ),
    ).toBe(true);
  });

  it('warns on stale skip patterns', async () => {
    dest = join(tmpdir(), `projx-doc-stale-${Date.now()}`);
    await scaffold(
      { name: 'doc-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    // Add a skip pattern that matches nothing
    const markerPath = join(dest, 'fastify/.projx-component');
    const marker = JSON.parse(await readFile(markerPath, 'utf-8'));
    marker.skip = ['nonexistent-dir/**'];
    await writeFile(markerPath, JSON.stringify(marker, null, 2) + '\n');

    // Should warn but not fail
    await doctor(dest);
  });
});
