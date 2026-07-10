import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(import.meta.dirname, '../dist/index.js');

function runViaSymlink(argv: string[]): { stdout: string; code: number } {
  const dir = mkdtempSync(join(tmpdir(), 'projx-bin-'));
  const link = join(dir, 'create-projx');
  try {
    symlinkSync(CLI, link);
    try {
      const stdout = execFileSync('node', [link, ...argv], {
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
      });
      return { stdout, code: 0 };
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      return { stdout: e.stdout ?? '', code: e.status ?? 1 };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('entrypoint detection through a bin symlink (npx/npm path)', () => {
  it('runs main() and prints help when invoked via a symlink', () => {
    const { stdout, code } = runViaSymlink(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('projx <name>');
  });

  it('reports an unknown component via a symlink instead of silently no-opping', () => {
    const { code } = runViaSymlink(['add', 'not-a-real-component']);
    expect(code).toBe(2);
  });
});
