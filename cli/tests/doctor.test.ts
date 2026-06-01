import { describe, it, expect, afterEach } from 'vitest';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { scaffold } from '../src/scaffold.js';
import { doctor, isGoVersionSupported, parseGoVersion } from '../src/doctor.js';

const REPO_DIR = join(import.meta.dirname, '../..');

describe('doctor', () => {
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

  it('parseGoVersion accepts common go version strings', () => {
    expect(parseGoVersion('go version go1.25.0 darwin/arm64')).toEqual({
      major: 1,
      minor: 25,
    });
    expect(parseGoVersion('go1.24.2')).toEqual({ major: 1, minor: 24 });
    expect(parseGoVersion('not-go')).toBeNull();
  });

  it('isGoVersionSupported gates on the 1.25 minimum', () => {
    expect(isGoVersionSupported({ major: 1, minor: 25 })).toBe(true);
    expect(isGoVersionSupported({ major: 1, minor: 26 })).toBe(true);
    expect(isGoVersionSupported({ major: 2, minor: 0 })).toBe(true);
    expect(isGoVersionSupported({ major: 1, minor: 24 })).toBe(false);
    expect(isGoVersionSupported({ major: 0, minor: 99 })).toBe(false);
  });

  it('runs Go-component checks when go is scaffolded', async () => {
    dest = join(tmpdir(), `projx-doc-go-${Date.now()}`);
    await scaffold(
      { name: 'doc-app', components: ['go'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await doctor(dest);
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
