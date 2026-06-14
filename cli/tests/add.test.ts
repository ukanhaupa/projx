import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffold } from '../src/scaffold.js';
import { add } from '../src/add.js';
import * as utilsModule from '../src/utils.js';

const REPO_DIR = join(import.meta.dirname, '../..');

describe('add', () => {
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

  it('adds a new component to an existing project', async () => {
    dest = join(tmpdir(), `projx-add-${Date.now()}`);
    await scaffold(
      { name: 'my-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await add(dest, ['vitejs'], REPO_DIR, true);

    expect(existsSync(join(dest, 'vitejs'))).toBe(true);
    expect(existsSync(join(dest, 'vitejs/.projx-component'))).toBe(true);
  });

  it('adds nextjs to an existing backend and wires its compose service + CI job', async () => {
    dest = join(tmpdir(), `projx-add-nextjs-${Date.now()}`);
    await scaffold(
      { name: 'my-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await add(dest, ['nextjs'], REPO_DIR, true);

    expect(existsSync(join(dest, 'nextjs'))).toBe(true);
    const marker = JSON.parse(
      await readFile(join(dest, 'nextjs/.projx-component'), 'utf-8'),
    );
    expect(marker.component).toBe('nextjs');

    const compose = await readFile(join(dest, 'docker-compose.yml'), 'utf-8');
    expect(compose).toContain('  nextjs:');
    expect(compose).toContain('"3000:3000"');

    const ci = await readFile(join(dest, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toContain(
      'name: Next.js (format + lint + typecheck + build + test + audit)',
    );
  });

  it('recognizes a legacy frontend-marked component when adding alongside it', async () => {
    dest = join(tmpdir(), `projx-add-legacy-${Date.now()}`);
    await scaffold(
      { name: 'my-app', components: ['vitejs'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await writeFile(
      join(dest, 'vitejs/.projx-component'),
      JSON.stringify({ component: 'frontend', skip: ['package.json'] }),
    );

    await add(dest, ['fastify'], REPO_DIR, true);

    expect(existsSync(join(dest, 'fastify'))).toBe(true);
    expect(existsSync(join(dest, 'vitejs'))).toBe(true);
    const marker = JSON.parse(
      await readFile(join(dest, 'vitejs/.projx-component'), 'utf-8'),
    );
    expect(marker.component).toBe('vitejs');
  });

  it('registers new component via .projx-component marker', async () => {
    dest = join(tmpdir(), `projx-add-${Date.now()}`);
    await scaffold(
      { name: 'my-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await add(dest, ['e2e'], REPO_DIR, true);

    const fastifyMarker = JSON.parse(
      await readFile(join(dest, 'fastify/.projx-component'), 'utf-8'),
    );
    expect(fastifyMarker.component).toBe('fastify');

    const e2eMarker = JSON.parse(
      await readFile(join(dest, 'e2e/.projx-component'), 'utf-8'),
    );
    expect(e2eMarker.component).toBe('e2e');
  });

  it('regenerates shared files with all components', async () => {
    dest = join(tmpdir(), `projx-add-${Date.now()}`);
    await scaffold(
      { name: 'my-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await add(dest, ['vitejs'], REPO_DIR, true);

    const ci = await readFile(join(dest, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toContain('fastify');
    expect(ci).toContain('vitejs');
  });

  describe('--auth feature', () => {
    it('applies the auth feature to the target and records it in the marker', async () => {
      dest = join(tmpdir(), `projx-add-auth-${Date.now()}`);
      await scaffold(
        { name: 'my-app', components: ['fastify'], git: true, install: false },
        dest,
        REPO_DIR,
      );

      expect(existsSync(join(dest, 'fastify/src/modules/auth/routes.ts'))).toBe(
        false,
      );

      await add(dest, ['vitejs'], REPO_DIR, true, undefined, {
        auth: 'fastify',
      });

      expect(existsSync(join(dest, 'fastify/src/modules/auth/routes.ts'))).toBe(
        true,
      );

      const marker = JSON.parse(
        await readFile(join(dest, 'fastify/.projx-component'), 'utf-8'),
      );
      expect(marker.features).toContain('auth');
    });

    it('applies auth to a newly added backend instance', async () => {
      dest = join(tmpdir(), `projx-add-auth-new-${Date.now()}`);
      await scaffold(
        { name: 'my-app', components: ['vitejs'], git: true, install: false },
        dest,
        REPO_DIR,
      );

      await add(dest, ['fastify'], REPO_DIR, true, undefined, {
        auth: 'fastify',
      });

      expect(existsSync(join(dest, 'fastify/src/modules/auth/routes.ts'))).toBe(
        true,
      );
      const marker = JSON.parse(
        await readFile(join(dest, 'fastify/.projx-component'), 'utf-8'),
      );
      expect(marker.features).toContain('auth');
    });

    it('applies auth to an already-present component', async () => {
      dest = join(tmpdir(), `projx-add-auth-existing-${Date.now()}`);
      await scaffold(
        { name: 'my-app', components: ['fastify'], git: true, install: false },
        dest,
        REPO_DIR,
      );

      expect(existsSync(join(dest, 'fastify/src/modules/auth/routes.ts'))).toBe(
        false,
      );

      await add(dest, ['fastify'], REPO_DIR, true, undefined, {
        auth: 'fastify',
      });

      expect(existsSync(join(dest, 'fastify/src/modules/auth/routes.ts'))).toBe(
        true,
      );
      const marker = JSON.parse(
        await readFile(join(dest, 'fastify/.projx-component'), 'utf-8'),
      );
      expect(marker.features).toContain('auth');
    });

    it('is idempotent when re-applying auth to an already-present component', async () => {
      dest = join(tmpdir(), `projx-add-auth-idem-${Date.now()}`);
      await scaffold(
        { name: 'my-app', components: ['fastify'], git: true, install: false },
        dest,
        REPO_DIR,
      );

      await add(dest, ['fastify'], REPO_DIR, true, undefined, {
        auth: 'fastify',
      });
      const appAfterFirst = await readFile(
        join(dest, 'fastify/src/app.ts'),
        'utf-8',
      );

      await add(dest, ['fastify'], REPO_DIR, true, undefined, {
        auth: 'fastify',
      });
      const appAfterSecond = await readFile(
        join(dest, 'fastify/src/app.ts'),
        'utf-8',
      );

      expect(appAfterSecond).toBe(appAfterFirst);

      const marker = JSON.parse(
        await readFile(join(dest, 'fastify/.projx-component'), 'utf-8'),
      );
      expect(marker.features.filter((f: string) => f === 'auth')).toHaveLength(
        1,
      );
    });
  });

  describe('--name flag', () => {
    it('creates a second instance of the same type at a custom directory', async () => {
      dest = join(tmpdir(), `projx-add-name-${Date.now()}`);
      await scaffold(
        { name: 'my-app', components: ['fastify'], git: true, install: false },
        dest,
        REPO_DIR,
      );

      await add(dest, ['fastify'], REPO_DIR, true, 'email-ingestor');

      expect(existsSync(join(dest, 'fastify'))).toBe(true);
      expect(existsSync(join(dest, 'email-ingestor'))).toBe(true);
      expect(existsSync(join(dest, 'email-ingestor/.projx-component'))).toBe(
        true,
      );

      const marker = JSON.parse(
        await readFile(join(dest, 'email-ingestor/.projx-component'), 'utf-8'),
      );
      expect(marker.component).toBe('fastify');
    });

    it('emits CI / pre-commit / setup blocks for both instances', async () => {
      dest = join(tmpdir(), `projx-add-name-templates-${Date.now()}`);
      await scaffold(
        { name: 'my-app', components: ['fastify'], git: true, install: false },
        dest,
        REPO_DIR,
      );

      await add(dest, ['fastify'], REPO_DIR, true, 'email-ingestor');

      const ci = await readFile(
        join(dest, '.github/workflows/ci.yml'),
        'utf-8',
      );
      expect(ci).toContain('fastify:');
      expect(ci).toContain('email-ingestor:');
      expect(ci).toContain("'fastify/**'");
      expect(ci).toContain("'email-ingestor/**'");

      const hook = await readFile(join(dest, '.githooks/pre-commit'), 'utf-8');
      expect(hook).toContain('Formatting fastify');
      expect(hook).toContain('Formatting email-ingestor');

      const setup = await readFile(join(dest, 'scripts/setup.sh'), 'utf-8');
      expect(setup).toMatch(/\(\n\s+cd fastify\n/);
      expect(setup).toMatch(/\(\n\s+cd email-ingestor\n/);

      const compose = await readFile(join(dest, 'docker-compose.yml'), 'utf-8');
      expect(compose).toContain('fastify:');
      expect(compose).toContain('fastify-migrate:');
      expect(compose).toContain('email-ingestor:');
      expect(compose).toContain('email-ingestor-migrate:');
    });

    it('does not modify existing component dirs (preserves user customizations)', async () => {
      dest = join(tmpdir(), `projx-add-name-preserve-${Date.now()}`);
      await scaffold(
        { name: 'my-app', components: ['fastify'], git: true, install: false },
        dest,
        REPO_DIR,
      );

      // Simulate a user customization by replacing a tracked file
      const userCode = '// CUSTOM USER CODE — must not be clobbered\n';
      await writeFile(join(dest, 'fastify/src/app.ts'), userCode);
      const userPkg = '{"name":"my-custom","scripts":{"foo":"bar"}}\n';
      await writeFile(join(dest, 'fastify/package.json'), userPkg);

      await add(dest, ['fastify'], REPO_DIR, true, 'email-ingestor');

      expect(await readFile(join(dest, 'fastify/src/app.ts'), 'utf-8')).toBe(
        userCode,
      );
      expect(await readFile(join(dest, 'fastify/package.json'), 'utf-8')).toBe(
        userPkg,
      );
    });

    it('respects .projx skip list — does not overwrite skipped root files', async () => {
      dest = join(tmpdir(), `projx-add-name-rootskip-${Date.now()}`);
      await scaffold(
        { name: 'my-app', components: ['fastify'], git: true, install: false },
        dest,
        REPO_DIR,
      );

      const projxPath = join(dest, '.projx');
      const projx = JSON.parse(await readFile(projxPath, 'utf-8'));
      projx.skip = [...(projx.skip ?? []), 'README.md'];
      await writeFile(projxPath, JSON.stringify(projx, null, 2) + '\n');

      const userReadme = '# My Custom Readme — DO NOT TOUCH\n';
      await writeFile(join(dest, 'README.md'), userReadme);

      await add(dest, ['fastify'], REPO_DIR, true, 'email-ingestor');

      expect(await readFile(join(dest, 'README.md'), 'utf-8')).toBe(userReadme);
    });

    it('respects .projx skip for instance-aware root files (docker-compose.yml)', async () => {
      dest = join(tmpdir(), `projx-add-skip-compose-${Date.now()}`);
      await scaffold(
        { name: 'my-app', components: ['fastify'], git: true, install: false },
        dest,
        REPO_DIR,
      );

      const projxPath = join(dest, '.projx');
      const projx = JSON.parse(await readFile(projxPath, 'utf-8'));
      projx.skip = [...(projx.skip ?? []), 'docker-compose.yml'];
      await writeFile(projxPath, JSON.stringify(projx, null, 2) + '\n');

      const userCompose = '# Hand-authored compose — DO NOT TOUCH\n';
      await writeFile(join(dest, 'docker-compose.yml'), userCompose);

      await add(dest, ['fastify'], REPO_DIR, true, 'email-ingestor');

      expect(await readFile(join(dest, 'docker-compose.yml'), 'utf-8')).toBe(
        userCompose,
      );
    });

    it('respects .projx skip when adding a new component (no --name path)', async () => {
      dest = join(tmpdir(), `projx-add-newcomp-skip-${Date.now()}`);
      await scaffold(
        { name: 'my-app', components: ['fastify'], git: true, install: false },
        dest,
        REPO_DIR,
      );

      const projxPath = join(dest, '.projx');
      const projx = JSON.parse(await readFile(projxPath, 'utf-8'));
      projx.skip = [...(projx.skip ?? []), 'docker-compose.yml'];
      await writeFile(projxPath, JSON.stringify(projx, null, 2) + '\n');

      const userCompose = '# Hand-authored compose — DO NOT TOUCH\n';
      await writeFile(join(dest, 'docker-compose.yml'), userCompose);

      await add(dest, ['admin-panel'], REPO_DIR, true);

      expect(existsSync(join(dest, 'admin-panel'))).toBe(true);
      expect(await readFile(join(dest, 'docker-compose.yml'), 'utf-8')).toBe(
        userCompose,
      );
    });

    it("sets the new instance's package.json name from the custom dir name", async () => {
      dest = join(tmpdir(), `projx-add-name-pkgname-${Date.now()}`);
      await scaffold(
        { name: 'my-app', components: ['fastify'], git: true, install: false },
        dest,
        REPO_DIR,
      );

      await add(dest, ['fastify'], REPO_DIR, true, 'email-ingestor');

      const pkg = JSON.parse(
        await readFile(join(dest, 'email-ingestor/package.json'), 'utf-8'),
      );
      expect(pkg.name).toBe('my-app-email-ingestor');

      const fastifyPkg = JSON.parse(
        await readFile(join(dest, 'fastify/package.json'), 'utf-8'),
      );
      expect(fastifyPkg.name).toBe('my-app-fastify');
    });

    it('rejects when the target directory already exists', async () => {
      dest = join(tmpdir(), `projx-add-name-conflict-${Date.now()}`);
      await scaffold(
        { name: 'my-app', components: ['fastify'], git: true, install: false },
        dest,
        REPO_DIR,
      );

      await expect(
        add(dest, ['fastify'], REPO_DIR, true, 'fastify'),
      ).rejects.toThrow(/already exists/i);
    });
  });
});

describe('add — installDeps paths (mocked)', () => {
  let dest: string;
  let execSpy: ReturnType<typeof vi.spyOn>;
  let hasCommandSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    execSpy = vi.spyOn(utilsModule, 'exec').mockImplementation(() => '');
    hasCommandSpy = vi.spyOn(utilsModule, 'hasCommand');
  });

  afterEach(async () => {
    if (dest)
      await rm(dest, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    vi.restoreAllMocks();
  });

  it('runs install commands for the new instance when package manager is on PATH', async () => {
    dest = join(tmpdir(), `projx-add-install-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: 'ai', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['vitejs'], REPO_DIR, false);

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes('npm install'))).toBe(true);
  });

  it('falls back to warn message when package manager is missing during add', async () => {
    dest = join(tmpdir(), `projx-add-no-pm-${Date.now()}`);
    hasCommandSpy.mockReturnValue(false);

    await scaffold(
      { name: 'no-pm', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['fastapi'], REPO_DIR, false);

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes('uv sync'))).toBe(false);
    expect(existsSync(join(dest, 'fastapi'))).toBe(true);
  });

  it('skips installs when skipInstall=true', async () => {
    dest = join(tmpdir(), `projx-add-skip-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: 'skip-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['e2e'], REPO_DIR, true);

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(
      calls.every((c) => !c.includes('npm install') || !c.includes('e2e')),
    ).toBe(true);
  });

  it('copies .env.example to .env for the new instance', async () => {
    dest = join(tmpdir(), `projx-add-env-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: 'env', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );
    await add(dest, ['vitejs'], REPO_DIR, true);

    expect(existsSync(join(dest, 'vitejs/.env.example'))).toBe(true);
    expect(existsSync(join(dest, 'vitejs/.env'))).toBe(true);
  });

  it('runs fastify install when package manager is on PATH', async () => {
    dest = join(tmpdir(), `projx-add-fastify-install-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: 'fy', components: ['vitejs'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['fastify'], REPO_DIR, false);

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes('npm install'))).toBe(true);
  });

  it('warns instead of installing fastify when package manager missing', async () => {
    dest = join(tmpdir(), `projx-add-fastify-nopm-${Date.now()}`);
    hasCommandSpy.mockReturnValue(false);

    await scaffold(
      { name: 'fy', components: ['vitejs'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['fastify'], REPO_DIR, false);

    expect(execSpy).not.toHaveBeenCalled();
    expect(existsSync(join(dest, 'fastify'))).toBe(true);
  });

  it('warns instead of installing express when package manager missing', async () => {
    dest = join(tmpdir(), `projx-add-express-nopm-${Date.now()}`);
    hasCommandSpy.mockReturnValue(false);

    await scaffold(
      { name: 'ex', components: ['vitejs'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['express'], REPO_DIR, false);

    expect(execSpy).not.toHaveBeenCalled();
    expect(existsSync(join(dest, 'express'))).toBe(true);
  });

  it('warns instead of installing frontend when package manager missing', async () => {
    dest = join(tmpdir(), `projx-add-frontend-nopm-${Date.now()}`);
    hasCommandSpy.mockReturnValue(false);

    await scaffold(
      { name: 'fe', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['vitejs'], REPO_DIR, false);

    expect(execSpy).not.toHaveBeenCalled();
    expect(existsSync(join(dest, 'vitejs'))).toBe(true);
  });

  it('warns instead of installing e2e when package manager missing', async () => {
    dest = join(tmpdir(), `projx-add-e2e-nopm-${Date.now()}`);
    hasCommandSpy.mockReturnValue(false);

    await scaffold(
      { name: 'e', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['e2e'], REPO_DIR, false);

    expect(execSpy).not.toHaveBeenCalled();
    expect(existsSync(join(dest, 'e2e'))).toBe(true);
  });

  it('warns when flutter is missing for a mobile add', async () => {
    dest = join(tmpdir(), `projx-add-mobile-noflutter-${Date.now()}`);
    hasCommandSpy.mockReturnValue(false);

    await scaffold(
      { name: 'mob', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['mobile'], REPO_DIR, false);

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes('flutter pub get'))).toBe(false);
    expect(existsSync(join(dest, 'mobile'))).toBe(true);
  });

  it('installs flutter dependencies when flutter is on PATH', async () => {
    dest = join(tmpdir(), `projx-add-mobile-flutter-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: 'mob', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['mobile'], REPO_DIR, false);

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes('flutter pub get'))).toBe(true);
  });

  it('installs fastapi dependencies when uv is on PATH', async () => {
    dest = join(tmpdir(), `projx-add-fastapi-uv-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: 'api', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['fastapi'], REPO_DIR, false);

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes('uv sync'))).toBe(true);
  });

  it('is a no-op install for infra', async () => {
    dest = join(tmpdir(), `projx-add-infra-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: 'inf', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['infra'], REPO_DIR, false);

    expect(execSpy).not.toHaveBeenCalled();
    expect(existsSync(join(dest, 'infra'))).toBe(true);
  });

  it('is a no-op install for admin-panel', async () => {
    dest = join(tmpdir(), `projx-add-admin-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: 'adm', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['admin-panel'], REPO_DIR, false);

    expect(execSpy).not.toHaveBeenCalled();
    expect(existsSync(join(dest, 'admin-panel'))).toBe(true);
  });

  it('stops the spinner and continues when an install command throws', async () => {
    dest = join(tmpdir(), `projx-add-install-throw-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: 'boom', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockImplementation(() => {
      throw new Error('install failed');
    });

    await expect(
      add(dest, ['vitejs'], REPO_DIR, false),
    ).resolves.toBeUndefined();
    expect(existsSync(join(dest, 'vitejs'))).toBe(true);
  });

  it('installs express dependencies when package manager is on PATH', async () => {
    dest = join(tmpdir(), `projx-add-express-install-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: 'ex', components: ['vitejs'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['express'], REPO_DIR, false);

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes('npm install'))).toBe(true);
  });

  it('installs e2e dependencies when package manager is on PATH', async () => {
    dest = join(tmpdir(), `projx-add-e2e-install-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: 'e', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['e2e'], REPO_DIR, false);

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes('npm install'))).toBe(true);
  });

  it('installs the new instance via addInstance when using --name', async () => {
    dest = join(tmpdir(), `projx-add-name-install-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: 'ni', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['fastify'], REPO_DIR, false, 'worker');

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes('npm install'))).toBe(true);
    expect(existsSync(join(dest, 'worker/.projx-component'))).toBe(true);
  });

  it('uses the bun binary when packageManager is bun', async () => {
    dest = join(tmpdir(), `projx-add-bun-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      {
        name: 'bun-app',
        components: ['fastify'],
        git: true,
        install: false,
        packageManager: 'bun',
      },
      dest,
      REPO_DIR,
    );

    execSpy.mockClear();
    await add(dest, ['vitejs'], REPO_DIR, false);

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes('bun install'))).toBe(true);
    expect(hasCommandSpy).toHaveBeenCalledWith('bun');
  });

  it('defaults to npm when .projx has no packageManager or orm', async () => {
    dest = join(tmpdir(), `projx-add-defaults-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: 'defaults', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const projxPath = join(dest, '.projx');
    const projx = JSON.parse(await readFile(projxPath, 'utf-8'));
    delete projx.packageManager;
    delete projx.orm;
    await writeFile(projxPath, JSON.stringify(projx, null, 2) + '\n');

    execSpy.mockClear();
    await add(dest, ['vitejs'], REPO_DIR, false);

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes('npm install'))).toBe(true);
  });

  it('does not overwrite an existing .env for the new instance', async () => {
    dest = join(tmpdir(), `projx-add-keepenv-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      { name: 'keepenv', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await add(dest, ['vitejs'], REPO_DIR, true, 'web2');

    const envPath = join(dest, 'web2/.env');
    await writeFile(envPath, 'CUSTOM=1\n');

    await add(dest, ['fastify'], REPO_DIR, true, 'api2');

    expect(await readFile(envPath, 'utf-8')).toBe('CUSTOM=1\n');
  });
});

describe('add — early exits and validation', () => {
  let dest: string;

  afterEach(async () => {
    if (dest)
      await rm(dest, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    vi.restoreAllMocks();
  });

  it('exits when no .projx file is present', async () => {
    dest = join(tmpdir(), `projx-add-noprojx-${Date.now()}`);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dest, { recursive: true });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    await expect(add(dest, ['vitejs'], REPO_DIR, true)).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects --name when adding more than one component type', async () => {
    dest = join(tmpdir(), `projx-add-name-multi-${Date.now()}`);
    await scaffold(
      { name: 'multi', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    await expect(
      add(dest, ['vitejs', 'e2e'], REPO_DIR, true, 'whatever'),
    ).rejects.toThrow(/single component type/i);
  });

  it('warns about components that already exist', async () => {
    dest = join(tmpdir(), `projx-add-already-${Date.now()}`);
    await scaffold(
      {
        name: 'dup',
        components: ['fastify', 'vitejs'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    await add(dest, ['fastify', 'e2e'], REPO_DIR, true);

    expect(existsSync(join(dest, 'e2e/.projx-component'))).toBe(true);
  });

  it('exits cleanly when there is nothing new to add', async () => {
    dest = join(tmpdir(), `projx-add-nothing-${Date.now()}`);
    await scaffold(
      { name: 'noop', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    await expect(add(dest, ['fastify'], REPO_DIR, true)).rejects.toThrow(
      'exit',
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits when downloading the templates fails', async () => {
    dest = join(tmpdir(), `projx-add-dlfail-${Date.now()}`);
    await scaffold(
      { name: 'dlfail', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    vi.spyOn(utilsModule, 'downloadRepo').mockRejectedValue(
      new Error('network down'),
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    await expect(add(dest, ['vitejs'], REPO_DIR, true)).rejects.toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
