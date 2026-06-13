import { describe, it, afterEach, expect, vi, type MockInstance } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import * as p from '@clack/prompts';
import { scaffold } from '../src/scaffold.js';
import { diff } from '../src/diff.js';
import * as utilsModule from '../src/utils.js';
import {
  detectProjectName,
  discoverComponentsFromMarkers,
  pmCommands,
  readProjxConfig,
} from '../src/utils.js';
import { writeTemplateToDir, type GeneratorVars } from '../src/baseline.js';

const REPO_DIR = join(import.meta.dirname, '../..');

const APP_TS = 'fastify/src/app.ts';

async function alignProjxWithTemplate(cwd: string): Promise<void> {
  const raw = await readProjxConfig(cwd);
  const { components, paths } = await discoverComponentsFromMarkers(cwd);
  const version = JSON.parse(
    await readFile(join(REPO_DIR, 'cli/package.json'), 'utf-8'),
  ).version;
  const vars: GeneratorVars = {
    projectName: detectProjectName(cwd, components, paths),
    components,
    paths,
    pm: pmCommands((raw.packageManager ?? 'npm') as 'npm'),
    orm: raw.orm ?? 'prisma',
  };
  const tmpl = await mkdtemp(join(tmpdir(), 'projx-diff-align-'));
  try {
    await writeTemplateToDir(tmpl, REPO_DIR, components, paths, vars, version, {
      componentSkips: {},
      rootSkip: [],
      realCwd: cwd,
    });
    const rendered = await readFile(join(tmpl, '.projx'), 'utf-8');
    await writeFile(join(cwd, '.projx'), rendered);
  } finally {
    await rm(tmpl, { recursive: true, force: true });
  }
}

function commit(cwd: string, message: string): void {
  execSync(
    `git add -A && git -c core.hooksPath=/dev/null commit -m '${message}'`,
    {
      cwd,
      stdio: 'pipe',
    },
  );
}

function moveBaselineToHead(cwd: string): void {
  const head = execSync('git rev-parse HEAD', { cwd, stdio: 'pipe' })
    .toString()
    .trim();
  execSync(`git update-ref refs/projx/baseline ${head}`, {
    cwd,
    stdio: 'pipe',
  });
}

type LogSpy = MockInstance<(message: string) => void>;

interface LogSpies {
  info: LogSpy;
  success: LogSpy;
  warn: LogSpy;
  stdout: string[];
}

function spyLogs(): LogSpies {
  const stdout: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  return {
    info: vi.spyOn(p.log, 'info').mockImplementation(() => {}),
    success: vi.spyOn(p.log, 'success').mockImplementation(() => {}),
    warn: vi.spyOn(p.log, 'warn').mockImplementation(() => {}),
    stdout,
  };
}

function loggedLines(spy: LogSpy): string[] {
  return spy.mock.calls.map((c) => String(c[0]));
}

describe('diff', () => {
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

  it('runs without error on up-to-date project', async () => {
    dest = join(tmpdir(), `projx-diff-uptodate-${Date.now()}`);
    await scaffold(
      { name: 'diff-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await diff(dest, REPO_DIR);
  });

  it('runs without error when user has modifications', async () => {
    dest = join(tmpdir(), `projx-diff-mods-${Date.now()}`);
    await scaffold(
      { name: 'diff-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const pkgPath = join(dest, 'fastify/package.json');
    let pkg = await readFile(pkgPath, 'utf-8');
    pkg = pkg.replace('"description":', '"custom": true,\n  "description":');
    await writeFile(pkgPath, pkg);
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'user mod'",
      { cwd: dest, stdio: 'pipe' },
    );

    await diff(dest, REPO_DIR);
  });

  it('runs with multiple components', async () => {
    dest = join(tmpdir(), `projx-diff-multi-${Date.now()}`);
    await scaffold(
      {
        name: 'diff-app',
        components: ['fastify', 'e2e'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await diff(dest, REPO_DIR);
  });

  it('runs with skip patterns set', async () => {
    dest = join(tmpdir(), `projx-diff-skip-${Date.now()}`);
    await scaffold(
      { name: 'diff-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const projxPath = join(dest, '.projx');
    const projx = JSON.parse(await readFile(projxPath, 'utf-8'));
    projx.skip = [...(projx.skip ?? []), 'README.md'];
    await writeFile(projxPath, JSON.stringify(projx, null, 2) + '\n');
    await rm(join(dest, 'README.md'));
    execSync(
      "git add -A && git -c core.hooksPath=/dev/null commit -m 'pin + remove readme'",
      { cwd: dest, stdio: 'pipe' },
    );

    const logs = spyLogs();
    await diff(dest, REPO_DIR);

    expect(loggedLines(logs.info).some((l) => /^Skipped \(/.test(l))).toBe(
      true,
    );
  });

  it('reports everything up to date when no comparable file diverges', async () => {
    dest = join(tmpdir(), `projx-diff-clean-${Date.now()}`);
    await scaffold(
      { name: 'diff-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await alignProjxWithTemplate(dest);

    const logs = spyLogs();
    await diff(dest, REPO_DIR);

    expect(logs.stdout.join('')).toContain('Everything is up to date.');
  });

  it('exits when the template download fails', async () => {
    dest = join(tmpdir(), `projx-diff-dlfail-${Date.now()}`);
    await scaffold(
      { name: 'diff-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    spyLogs();
    vi.spyOn(utilsModule, 'downloadRepo').mockRejectedValue(
      new Error('network down'),
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('EXIT');
    }) as never);

    await expect(diff(dest)).rejects.toThrow('EXIT');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('reports new files when a managed file is missing locally', async () => {
    dest = join(tmpdir(), `projx-diff-new-${Date.now()}`);
    await scaffold(
      { name: 'diff-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await rm(join(dest, APP_TS));
    commit(dest, 'drop app.ts');

    const logs = spyLogs();
    await diff(dest, REPO_DIR);

    expect(loggedLines(logs.info).some((l) => /^New files \(/.test(l))).toBe(
      true,
    );
    expect(loggedLines(logs.info)).toContain(`  + ${APP_TS}`);
  });

  it('reports a user-only modification', async () => {
    dest = join(tmpdir(), `projx-diff-useronly-${Date.now()}`);
    await scaffold(
      { name: 'diff-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const appPath = join(dest, APP_TS);
    const original = await readFile(appPath, 'utf-8');
    await writeFile(appPath, original + '\n// user-local edit\n');

    const logs = spyLogs();
    await diff(dest, REPO_DIR);

    expect(
      loggedLines(logs.info).some((l) => /^User-modified only/.test(l)),
    ).toBe(true);
    expect(loggedLines(logs.info)).toContain(`  = ${APP_TS}`);
  });

  it('reports a clean update when only the baseline diverges', async () => {
    dest = join(tmpdir(), `projx-diff-clean-update-${Date.now()}`);
    await scaffold(
      { name: 'diff-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const appPath = join(dest, APP_TS);
    await writeFile(appPath, '// baseline-only content\n');
    commit(dest, 'baseline divergence');
    moveBaselineToHead(dest);

    const logs = spyLogs();
    await diff(dest, REPO_DIR);

    expect(
      loggedLines(logs.success).some((l) => /^Clean updates/.test(l)),
    ).toBe(true);
    expect(loggedLines(logs.info)).toContain(`  ~ ${APP_TS}`);
  });

  it('treats a divergent file as needs-merge when no baseline ref exists', async () => {
    dest = join(tmpdir(), `projx-diff-nobaseline-${Date.now()}`);
    await scaffold(
      { name: 'diff-app', components: ['fastify'], git: false, install: false },
      dest,
      REPO_DIR,
    );

    const appPath = join(dest, APP_TS);
    const original = await readFile(appPath, 'utf-8');
    await writeFile(appPath, original + '\n// local edit, no git\n');

    const logs = spyLogs();
    await diff(dest, REPO_DIR);

    expect(loggedLines(logs.warn).some((l) => /^Needs merge/.test(l))).toBe(
      true,
    );
    expect(loggedLines(logs.info)).toContain(`  ! ${APP_TS}`);
  });

  it('treats a divergent file absent from the baseline as needs-merge', async () => {
    dest = join(tmpdir(), `projx-diff-nobase-file-${Date.now()}`);
    await scaffold(
      { name: 'diff-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const appPath = join(dest, APP_TS);
    execSync(`git rm --quiet '${APP_TS}'`, { cwd: dest, stdio: 'pipe' });
    commit(dest, 'remove app.ts from baseline');
    moveBaselineToHead(dest);
    await writeFile(appPath, '// reintroduced, divergent from template\n');

    const logs = spyLogs();
    await diff(dest, REPO_DIR);

    expect(loggedLines(logs.warn).some((l) => /^Needs merge/.test(l))).toBe(
      true,
    );
    expect(loggedLines(logs.info)).toContain(`  ! ${APP_TS}`);
  });

  it('reports a needs-merge conflict when both sides diverge', async () => {
    dest = join(tmpdir(), `projx-diff-merge-${Date.now()}`);
    await scaffold(
      { name: 'diff-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const appPath = join(dest, APP_TS);
    await writeFile(appPath, '// baseline content\n');
    commit(dest, 'baseline divergence');
    moveBaselineToHead(dest);
    await writeFile(appPath, '// working tree content\n');

    const logs = spyLogs();
    await diff(dest, REPO_DIR);

    expect(loggedLines(logs.warn).some((l) => /^Needs merge/.test(l))).toBe(
      true,
    );
    expect(loggedLines(logs.info)).toContain(`  ! ${APP_TS}`);
  });
});
