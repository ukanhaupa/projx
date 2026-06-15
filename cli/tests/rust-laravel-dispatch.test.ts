import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectComponents } from '../src/detect.js';
import { DEFAULT_BACKEND_URLS } from '../src/sync.js';
import { LABELS } from '../src/prompts.js';

describe('rust + laravel dispatch wiring', () => {
  describe('detect', () => {
    let tmp: string;

    beforeEach(async () => {
      tmp = join(tmpdir(), `projx-rl-detect-${Date.now()}`);
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

    it('detects Cargo.toml + axum as rust component', async () => {
      const dir = join(tmp, 'rust');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'Cargo.toml'),
        [
          '[package]',
          'name = "demo"',
          'edition = "2021"',
          '',
          '[dependencies]',
          'axum = "0.7"',
          'sea-orm = "1"',
        ].join('\n'),
      );

      const results = await detectComponents(tmp);
      const rust = results.find((r) => r.component === 'rust');
      expect(rust).toBeDefined();
      expect(rust?.confidence).toBe('high');
      expect(rust?.orm).toBe('seaorm');
    });

    it('detects composer.json + laravel/framework as laravel component', async () => {
      const dir = join(tmp, 'laravel');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'composer.json'),
        JSON.stringify({
          name: 'demo/app',
          require: {
            php: '^8.3',
            'laravel/framework': '^11.0',
          },
        }),
      );

      const results = await detectComponents(tmp);
      const laravel = results.find((r) => r.component === 'laravel');
      expect(laravel).toBeDefined();
      expect(laravel?.confidence).toBe('high');
      expect(laravel?.orm).toBe('eloquent');
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
      dest = join(tmpdir(), `projx-cli-rl-${Date.now()}`);
    });

    afterEach(async () => {
      await rm(dest, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    });

    it('rejects --orm seaorm with --components fastify', () => {
      const result = runCli([
        dest,
        '--components',
        'fastify',
        '--orm',
        'seaorm',
        '--no-git',
        '--no-install',
      ]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/seaorm/);
      expect(result.stderr).toMatch(/rust/i);
    });

    it('rejects --orm eloquent with --components fastify', () => {
      const result = runCli([
        dest,
        '--components',
        'fastify',
        '--orm',
        'eloquent',
        '--no-git',
        '--no-install',
      ]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/eloquent/);
      expect(result.stderr).toMatch(/laravel/i);
    });

    it('rejects --orm seaorm with --components go', () => {
      const result = runCli([
        dest,
        '--components',
        'go',
        '--orm',
        'seaorm',
        '--no-git',
        '--no-install',
      ]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/seaorm/);
    });

    it('rejects --orm prisma with --components rust', () => {
      const result = runCli([
        dest,
        '--components',
        'rust',
        '--orm',
        'prisma',
        '--no-git',
        '--no-install',
      ]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/prisma/);
    });

    it('rejects --orm gorm with --components laravel', () => {
      const result = runCli([
        dest,
        '--components',
        'laravel',
        '--orm',
        'gorm',
        '--no-git',
        '--no-install',
      ]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/gorm/);
    });
  });

  describe('LABELS', () => {
    it('includes rust and laravel', () => {
      expect(LABELS.rust).toBeDefined();
      expect(LABELS.rust.label).toBe('Rust');
      expect(LABELS.rust.hint).toMatch(/Axum/);
      expect(LABELS.rust.hint).toMatch(/SeaORM/);

      expect(LABELS.laravel).toBeDefined();
      expect(LABELS.laravel.label).toBe('Laravel');
      expect(LABELS.laravel.hint).toMatch(/PHP/);
    });
  });

  describe('DEFAULT_BACKEND_URLS', () => {
    it('includes rust and laravel defaults', () => {
      expect(DEFAULT_BACKEND_URLS.rust).toBe('http://localhost:8080');
      expect(DEFAULT_BACKEND_URLS.laravel).toBe('http://localhost:8000');
    });
  });
});
