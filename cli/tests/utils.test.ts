import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  toKebab,
  toSnake,
  toTitle,
  render,
  readFileOrNull,
  upsertComponentMarker,
  discoverComponentPaths,
  replaceInFile,
  replaceInDir,
  detectPackageManager,
  pmCommands,
  COMPONENT_MARKER,
  type Component,
} from '../src/utils.js';

describe('toKebab', () => {
  it('converts camelCase', () => {
    expect(toKebab('myApp')).toBe('my-app');
  });

  it('converts PascalCase', () => {
    expect(toKebab('MyApp')).toBe('my-app');
  });

  it('converts spaces', () => {
    expect(toKebab('my app')).toBe('my-app');
  });

  it('converts underscores', () => {
    expect(toKebab('my_app')).toBe('my-app');
  });

  it('lowercases', () => {
    expect(toKebab('MY-APP')).toBe('my-app');
  });

  it('handles already kebab', () => {
    expect(toKebab('my-app')).toBe('my-app');
  });
});

describe('toSnake', () => {
  it('converts kebab to snake', () => {
    expect(toSnake('my-app')).toBe('my_app');
  });

  it('converts camelCase to snake', () => {
    expect(toSnake('myApp')).toBe('my_app');
  });

  it('converts spaces to snake', () => {
    expect(toSnake('my app')).toBe('my_app');
  });
});

describe('toTitle', () => {
  it('converts kebab to title', () => {
    expect(toTitle('my-app')).toBe('My App');
  });

  it('converts snake to title', () => {
    expect(toTitle('my_app')).toBe('My App');
  });

  it('converts spaces to title', () => {
    expect(toTitle('my app')).toBe('My App');
  });
});

describe('render', () => {
  it('replaces simple variables', () => {
    const tpl = 'name: <%= projectName %>';
    const result = render(tpl, { projectName: 'my-app', components: [] });
    expect(result).toBe('name: my-app');
  });

  it('replaces dotted variables', () => {
    const tpl = 'cd <%= paths.fastapi %>';
    const result = render(tpl, {
      projectName: 'app',
      components: ['fastapi'],
      paths: { fastapi: 'backend' },
    });
    expect(result).toBe('cd backend');
  });

  it('handles if blocks — included', () => {
    const tpl = [
      "<% if (components.includes('fastapi')) { %>",
      'fastapi line',
      '<% } %>',
    ].join('\n');
    const result = render(tpl, { projectName: 'app', components: ['fastapi'] });
    expect(result).toBe('fastapi line');
  });

  it('handles if blocks — excluded', () => {
    const tpl = [
      "<% if (components.includes('fastapi')) { %>",
      'fastapi line',
      '<% } %>',
    ].join('\n');
    const result = render(tpl, { projectName: 'app', components: ['fastify'] });
    expect(result).toBe('');
  });

  it('handles if/else blocks', () => {
    const tpl = [
      "<% if (components.includes('fastapi')) { %>",
      'python',
      '<% } else { %>',
      'node',
      '<% } %>',
    ].join('\n');
    const result = render(tpl, { projectName: 'app', components: ['fastify'] });
    expect(result).toBe('node');
  });

  it('collapses triple newlines', () => {
    const tpl = 'a\n\n\n\nb';
    const result = render(tpl, { projectName: 'app', components: [] });
    expect(result).toBe('a\n\nb');
  });

  it('returns empty string for missing dotted var', () => {
    const tpl = '<%= paths.missing %>';
    const result = render(tpl, {
      projectName: 'app',
      components: [],
      paths: {},
    });
    expect(result).toBe('');
  });

  it('expands a for loop over an array', () => {
    const tpl = [
      'head',
      '<% for (const inst of instances) { %>',
      '- <%= inst.path %>',
      '<% } %>',
      'tail',
    ].join('\n');
    const result = render(tpl, {
      projectName: 'app',
      components: [],
      instances: [
        { type: 'fastify', path: 'backend' },
        { type: 'fastify', path: 'email-ingestor' },
      ],
    });
    expect(result).toBe('head\n- backend\n- email-ingestor\ntail');
  });

  it('for loop with nested if filters by type', () => {
    const tpl = [
      '<% for (const inst of instances) { %>',
      "<% if (inst.type === 'fastify') { %>",
      'fastify: <%= inst.path %>',
      '<% } %>',
      '<% } %>',
    ].join('\n');
    const result = render(tpl, {
      projectName: 'app',
      components: [],
      instances: [
        { type: 'fastify', path: 'backend' },
        { type: 'frontend', path: 'web' },
        { type: 'fastify', path: 'email-ingestor' },
      ],
    });
    expect(result).toBe('fastify: backend\nfastify: email-ingestor');
  });

  it('for loop is skipped inside a falsy if', () => {
    const tpl = [
      "<% if (components.includes('mobile')) { %>",
      '<% for (const inst of instances) { %>',
      '<%= inst.path %>',
      '<% } %>',
      '<% } %>',
    ].join('\n');
    const result = render(tpl, {
      projectName: 'app',
      components: ['fastify'],
      instances: [{ type: 'fastify', path: 'backend' }],
    });
    expect(result).toBe('');
  });
});

describe('readFileOrNull', () => {
  it('returns content for existing file', async () => {
    const tmp = join(tmpdir(), `projx-test-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
    const f = join(tmp, 'test.txt');
    await writeFile(f, 'hello');
    expect(await readFileOrNull(f)).toBe('hello');
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns null for missing file', async () => {
    expect(await readFileOrNull('/nonexistent/file.txt')).toBeNull();
  });
});

describe('upsertComponentMarker', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `projx-test-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('writes marker file with singular component', async () => {
    await upsertComponentMarker(tmp, 'fastapi');
    const content = JSON.parse(
      await readFile(join(tmp, COMPONENT_MARKER), 'utf-8'),
    );
    expect(content.component).toBe('fastapi');
    expect(content.skip).toEqual([]);
    expect(content.origin).toBeUndefined();
    expect(content.components).toBeUndefined();
  });

  it('preserves skip patterns when re-upserting same component', async () => {
    await upsertComponentMarker(tmp, 'fastapi', ['src/**']);
    await upsertComponentMarker(tmp, 'fastapi');
    const content = JSON.parse(
      await readFile(join(tmp, COMPONENT_MARKER), 'utf-8'),
    );
    expect(content.component).toBe('fastapi');
    expect(content.skip).toEqual(['src/**']);
  });

  it('overwrites with new component when called with different name', async () => {
    await upsertComponentMarker(tmp, 'frontend');
    await upsertComponentMarker(tmp, 'e2e');
    const content = JSON.parse(
      await readFile(join(tmp, COMPONENT_MARKER), 'utf-8'),
    );
    expect(content.component).toBe('e2e');
  });
});

describe('readComponentMarker — schema migration', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `projx-mig-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('reads old format with components plural and origin', async () => {
    const { readComponentMarker } = await import('../src/utils.js');
    await writeFile(
      join(tmp, '.projx-component'),
      JSON.stringify({
        components: ['fastapi'],
        origin: 'scaffold',
        skip: ['src/**'],
      }),
    );
    const marker = await readComponentMarker(tmp);
    expect(marker).not.toBeNull();
    expect(marker!.component).toBe('fastapi');
    expect(marker!.skip).toEqual(['src/**']);
  });

  it('reads even older format with singular component field', async () => {
    const { readComponentMarker } = await import('../src/utils.js');
    await writeFile(
      join(tmp, '.projx-component'),
      JSON.stringify({
        component: 'fastify',
        origin: 'init',
      }),
    );
    const marker = await readComponentMarker(tmp);
    expect(marker!.component).toBe('fastify');
    expect(marker!.skip).toEqual([]);
  });

  it('upsert migrates old format on next write', async () => {
    await writeFile(
      join(tmp, '.projx-component'),
      JSON.stringify({
        components: ['frontend'],
        origin: 'scaffold',
        skip: ['dist/**'],
      }),
    );
    await upsertComponentMarker(tmp, 'frontend');
    const content = JSON.parse(
      await readFile(join(tmp, COMPONENT_MARKER), 'utf-8'),
    );
    expect(content.component).toBe('frontend');
    expect(content.skip).toEqual(['dist/**']);
    expect(content.components).toBeUndefined();
    expect(content.origin).toBeUndefined();
  });

  it('returns null for invalid component name', async () => {
    const { readComponentMarker } = await import('../src/utils.js');
    await writeFile(
      join(tmp, '.projx-component'),
      JSON.stringify({
        component: 'not-a-real-component',
      }),
    );
    const marker = await readComponentMarker(tmp);
    expect(marker).toBeNull();
  });

  it('returns null for malformed JSON', async () => {
    const { readComponentMarker } = await import('../src/utils.js');
    await writeFile(join(tmp, '.projx-component'), '{not json');
    const marker = await readComponentMarker(tmp);
    expect(marker).toBeNull();
  });
});

describe('writeProjxConfig — schema migration', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `projx-cfg-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('preserves arbitrary user fields via spread', async () => {
    const { readProjxConfig, writeProjxConfig } =
      await import('../src/utils.js');
    await writeFile(
      join(tmp, '.projx'),
      JSON.stringify({
        version: '1.4.0',
        createdAt: '2026-01-01',
        packageManager: 'pnpm',
        customField: 'user-value',
        primaryBackend: 'fastify',
      }),
    );
    const existing = await readProjxConfig(tmp);
    await writeProjxConfig(tmp, { ...existing, version: '1.5.0' });
    const next = JSON.parse(await readFile(join(tmp, '.projx'), 'utf-8'));
    expect(next.version).toBe('1.5.0');
    expect(next.customField).toBe('user-value');
    expect(next.primaryBackend).toBe('fastify');
    expect(next.packageManager).toBe('pnpm');
    expect(next.createdAt).toBe('2026-01-01');
  });

  it('adds skip [] default when missing', async () => {
    const { writeProjxConfig } = await import('../src/utils.js');
    await writeProjxConfig(tmp, { version: '1.5.0' });
    const written = JSON.parse(await readFile(join(tmp, '.projx'), 'utf-8'));
    expect(written.skip).toEqual([]);
  });

  it('preserves existing skip array', async () => {
    const { writeProjxConfig } = await import('../src/utils.js');
    await writeProjxConfig(tmp, { version: '1.5.0', skip: ['README.md'] });
    const written = JSON.parse(await readFile(join(tmp, '.projx'), 'utf-8'));
    expect(written.skip).toEqual(['README.md']);
  });

  it('auto-fills createdAt when missing', async () => {
    const { writeProjxConfig } = await import('../src/utils.js');
    await writeProjxConfig(tmp, { version: '1.5.0' });
    const written = JSON.parse(await readFile(join(tmp, '.projx'), 'utf-8'));
    expect(written.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('detectPackageManagerFromComponents', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `projx-pm-detect-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('detects pnpm from fastify dir lockfile', async () => {
    const { detectPackageManagerFromComponents } =
      await import('../src/utils.js');
    await mkdir(join(tmp, 'backend'));
    await writeFile(join(tmp, 'backend/pnpm-lock.yaml'), '');
    const pm = detectPackageManagerFromComponents(tmp, { fastify: 'backend' });
    expect(pm).toBe('pnpm');
  });

  it('detects npm from frontend dir lockfile', async () => {
    const { detectPackageManagerFromComponents } =
      await import('../src/utils.js');
    await mkdir(join(tmp, 'web'));
    await writeFile(join(tmp, 'web/package-lock.json'), '{}');
    const pm = detectPackageManagerFromComponents(tmp, { frontend: 'web' });
    expect(pm).toBe('npm');
  });

  it('falls back to project root lockfile when component dir has none', async () => {
    const { detectPackageManagerFromComponents } =
      await import('../src/utils.js');
    await writeFile(join(tmp, 'yarn.lock'), '');
    const pm = detectPackageManagerFromComponents(tmp, {});
    expect(pm).toBe('yarn');
  });

  it('returns null when no lockfile anywhere', async () => {
    const { detectPackageManagerFromComponents } =
      await import('../src/utils.js');
    const pm = detectPackageManagerFromComponents(tmp, {});
    expect(pm).toBeNull();
  });

  it('checks fastify before frontend before e2e', async () => {
    const { detectPackageManagerFromComponents } =
      await import('../src/utils.js');
    await mkdir(join(tmp, 'backend'));
    await mkdir(join(tmp, 'web'));
    await writeFile(join(tmp, 'backend/pnpm-lock.yaml'), '');
    await writeFile(join(tmp, 'web/package-lock.json'), '{}');
    const pm = detectPackageManagerFromComponents(tmp, {
      fastify: 'backend',
      frontend: 'web',
    });
    expect(pm).toBe('pnpm');
  });
});

describe('discoverComponentsFromMarkers — multi-instance', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `projx-multi-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns one instance per marker dir, including duplicates of same type', async () => {
    const { discoverComponentsFromMarkers } = await import('../src/utils.js');
    await mkdir(join(tmp, 'backend'));
    await upsertComponentMarker(join(tmp, 'backend'), 'fastify');
    await mkdir(join(tmp, 'email-ingestor'));
    await upsertComponentMarker(join(tmp, 'email-ingestor'), 'fastify');
    await mkdir(join(tmp, 'web'));
    await upsertComponentMarker(join(tmp, 'web'), 'frontend');

    const result = await discoverComponentsFromMarkers(tmp);
    expect(result.instances).toHaveLength(3);
    const fastifyPaths = result.instances
      .filter((i) => i.type === 'fastify')
      .map((i) => i.path)
      .sort();
    expect(fastifyPaths).toEqual(['backend', 'email-ingestor']);
    const frontendPaths = result.instances
      .filter((i) => i.type === 'frontend')
      .map((i) => i.path);
    expect(frontendPaths).toEqual(['web']);
  });

  it('preserves existing components and paths shape (primary per type)', async () => {
    const { discoverComponentsFromMarkers } = await import('../src/utils.js');
    await mkdir(join(tmp, 'backend'));
    await upsertComponentMarker(join(tmp, 'backend'), 'fastify');
    await mkdir(join(tmp, 'email-ingestor'));
    await upsertComponentMarker(join(tmp, 'email-ingestor'), 'fastify');

    const result = await discoverComponentsFromMarkers(tmp);
    expect(result.components).toEqual(['fastify']);
    expect(typeof result.paths.fastify).toBe('string');
  });
});

describe('discoverComponentPaths', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `projx-test-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('discovers renamed component directories', async () => {
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

  it('falls back to component name when no marker found', async () => {
    const paths = await discoverComponentPaths(tmp, ['fastapi'] as Component[]);
    expect(paths.fastapi).toBe('fastapi');
  });

  it('ignores dotfiles and excluded directories', async () => {
    await mkdir(join(tmp, '.hidden'));
    await upsertComponentMarker(join(tmp, '.hidden'), 'fastapi');
    await mkdir(join(tmp, 'node_modules'));
    await upsertComponentMarker(join(tmp, 'node_modules'), 'fastify');

    const paths = await discoverComponentPaths(tmp, [
      'fastapi',
      'fastify',
    ] as Component[]);
    expect(paths.fastapi).toBe('fastapi');
    expect(paths.fastify).toBe('fastify');
  });
});

describe('detectPackageManager', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `projx-pm-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('detects pnpm from lockfile', async () => {
    await writeFile(join(tmp, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(tmp)).toBe('pnpm');
  });

  it('detects yarn from lockfile', async () => {
    await writeFile(join(tmp, 'yarn.lock'), '');
    expect(detectPackageManager(tmp)).toBe('yarn');
  });

  it('detects bun from lockfile', async () => {
    await writeFile(join(tmp, 'bun.lockb'), '');
    expect(detectPackageManager(tmp)).toBe('bun');
  });

  it('detects npm from lockfile', async () => {
    await writeFile(join(tmp, 'package-lock.json'), '{}');
    expect(detectPackageManager(tmp)).toBe('npm');
  });

  it('returns null when no lockfile', () => {
    expect(detectPackageManager(tmp)).toBeNull();
  });

  it('prioritizes bun over pnpm', async () => {
    await writeFile(join(tmp, 'bun.lockb'), '');
    await writeFile(join(tmp, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(tmp)).toBe('bun');
  });
});

describe('pmCommands', () => {
  it('returns correct npm commands', () => {
    const cmd = pmCommands('npm');
    expect(cmd.name).toBe('npm');
    expect(cmd.install).toBe('npm install');
    expect(cmd.ci).toBe('npm ci');
    expect(cmd.exec).toBe('npx');
    expect(cmd.lockfile).toBe('package-lock.json');
    expect(cmd.audit).toBe('npm audit --omit=dev');
  });

  it('returns correct pnpm commands', () => {
    const cmd = pmCommands('pnpm');
    expect(cmd.name).toBe('pnpm');
    expect(cmd.ci).toBe('pnpm install --frozen-lockfile');
    expect(cmd.run).toBe('pnpm');
    expect(cmd.lockfile).toBe('pnpm-lock.yaml');
    expect(cmd.audit).toBe('pnpm audit --prod');
  });

  it('returns correct yarn commands', () => {
    const cmd = pmCommands('yarn');
    expect(cmd.install).toBe('yarn');
    expect(cmd.ci).toBe('yarn --frozen-lockfile');
    expect(cmd.lockfile).toBe('yarn.lock');
    expect(cmd.audit).toBe('yarn npm audit --environment production');
  });

  it('returns correct bun commands', () => {
    const cmd = pmCommands('bun');
    expect(cmd.install).toBe('bun install');
    expect(cmd.exec).toBe('bunx');
    expect(cmd.lockfile).toBe('bun.lockb');
    expect(cmd.audit).toBe('bun audit --prod');
  });
});

const ALL_PMS = ['npm', 'pnpm', 'yarn', 'bun'] as const;

describe.each(ALL_PMS)('render with pm=%s', (pm) => {
  const cmd = pmCommands(pm);

  it('renders install command', () => {
    const tpl = 'run: <%= pm.install %>';
    const result = render(tpl, { projectName: 'app', components: [], pm: cmd });
    expect(result).toBe(`run: ${cmd.install}`);
  });

  it('renders ci command', () => {
    const tpl = 'run: <%= pm.ci %>';
    const result = render(tpl, { projectName: 'app', components: [], pm: cmd });
    expect(result).toBe(`run: ${cmd.ci}`);
  });

  it('renders exec command', () => {
    const tpl = '<%= pm.exec %> prisma';
    const result = render(tpl, { projectName: 'app', components: [], pm: cmd });
    expect(result).toBe(`${cmd.exec} prisma`);
  });

  it('renders lockfile name', () => {
    const tpl = 'cache: <%= pm.lockfile %>';
    const result = render(tpl, { projectName: 'app', components: [], pm: cmd });
    expect(result).toBe(`cache: ${cmd.lockfile}`);
  });

  it('renders pm name', () => {
    const tpl = 'cache: <%= pm.name %>';
    const result = render(tpl, { projectName: 'app', components: [], pm: cmd });
    expect(result).toBe(`cache: ${pm}`);
  });

  it('matches own name in conditionals', () => {
    const tpl = [`<% if (pm === '${pm}') { %>`, 'matched', '<% } %>'].join(
      '\n',
    );
    const result = render(tpl, { projectName: 'app', components: [], pm: cmd });
    expect(result).toBe('matched');
  });

  it('excludes other PM conditionals', () => {
    const other = ALL_PMS.find((p) => p !== pm)!;
    const tpl = [
      `<% if (pm === '${other}') { %>`,
      'should not appear',
      '<% } %>',
    ].join('\n');
    const result = render(tpl, { projectName: 'app', components: [], pm: cmd });
    expect(result).toBe('');
  });
});

describe('replaceInFile', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `projx-test-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('replaces text in file', async () => {
    const f = join(tmp, 'test.txt');
    await writeFile(f, 'hello projx-fastapi world');
    await replaceInFile(f, 'projx-fastapi', 'my-app-fastapi');
    expect(await readFile(f, 'utf-8')).toBe('hello my-app-fastapi world');
  });

  it('does nothing for missing file', async () => {
    await replaceInFile(join(tmp, 'nope.txt'), 'a', 'b');
  });

  it('does nothing when find string not present', async () => {
    const f = join(tmp, 'test.txt');
    await writeFile(f, 'hello world');
    await replaceInFile(f, 'missing', 'replaced');
    expect(await readFile(f, 'utf-8')).toBe('hello world');
  });
});

describe('replaceInDir', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = join(tmpdir(), `projx-test-${Date.now()}`);
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('replaces in matching files recursively', async () => {
    await mkdir(join(tmp, 'sub'));
    await writeFile(join(tmp, 'a.dart'), "import 'package:projx_mobile/x';");
    await writeFile(
      join(tmp, 'sub/b.dart'),
      "import 'package:projx_mobile/y';",
    );
    await writeFile(join(tmp, 'c.ts'), "import 'package:projx_mobile/z';");

    await replaceInDir(
      tmp,
      'package:projx_mobile/',
      'package:my_app_mobile/',
      '.dart',
    );

    expect(await readFile(join(tmp, 'a.dart'), 'utf-8')).toBe(
      "import 'package:my_app_mobile/x';",
    );
    expect(await readFile(join(tmp, 'sub/b.dart'), 'utf-8')).toBe(
      "import 'package:my_app_mobile/y';",
    );
    expect(await readFile(join(tmp, 'c.ts'), 'utf-8')).toBe(
      "import 'package:projx_mobile/z';",
    );
  });
});
