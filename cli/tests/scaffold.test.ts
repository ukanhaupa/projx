import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffold } from '../src/scaffold.js';
import * as utilsModule from '../src/utils.js';
import { type PackageManager, pmCommands } from '../src/utils.js';

const REPO_DIR = join(import.meta.dirname, '../..');

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('scaffold', () => {
  let dest: string;

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it('scaffolds a project with fastify + frontend', async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);
    await scaffold(
      {
        name: 'test-app',
        components: ['fastify', 'frontend'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, '.projx'))).toBe(true);
    expect(existsSync(join(dest, 'fastify'))).toBe(true);
    expect(existsSync(join(dest, 'frontend'))).toBe(true);
  });

  it('scaffolds an Express backend with production wiring', async () => {
    dest = join(tmpdir(), `projx-express-${Date.now()}`);
    await scaffold(
      {
        name: 'express-app',
        components: ['express', 'frontend', 'e2e'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, 'express/src/app.ts'))).toBe(true);
    expect(existsSync(join(dest, 'express/prisma/schema.prisma'))).toBe(true);
    expect(
      existsSync(join(dest, 'express/src/modules/_base/auto-routes.ts')),
    ).toBe(true);
    expect(
      existsSync(join(dest, 'express/src/modules/audit-logs/index.ts')),
    ).toBe(true);
    expect(existsSync(join(dest, 'express/tests/app.test.ts'))).toBe(true);
    expect(existsSync(join(dest, 'express/Dockerfile.ejs'))).toBe(false);

    const marker = JSON.parse(
      await readFile(join(dest, 'express/.projx-component'), 'utf-8'),
    );
    expect(marker.component).toBe('express');
    expect(marker.skip).toContain('package.json');

    const pkg = JSON.parse(
      await readFile(join(dest, 'express/package.json'), 'utf-8'),
    );
    expect(pkg.name).toBe('express-app-express');

    const ci = await readFile(join(dest, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toContain('express:');
    expect(ci).toContain(
      'name: Express (format + lint + typecheck + build + test + audit)',
    );

    const compose = await readFile(join(dest, 'docker-compose.yml'), 'utf-8');
    expect(compose).toContain('express-migrate:');
    expect(compose).toContain('express:');
    expect(compose).toContain('http://localhost:3000/api/health');

    const setup = await readFile(join(dest, 'scripts/setup.sh'), 'utf-8');
    expect(setup).toContain('prisma migrate dev --name init --skip-seed');
    expect(setup).toContain('Express dependencies installed.');
    expect(setup).toContain('express/.env created from .env.example.');

    const ciLocal = await readFile(join(dest, 'scripts/ci-local.sh'), 'utf-8');
    expect(ciLocal).toContain('run_js_component express');

    const readme = await readFile(join(dest, 'README.md'), 'utf-8');
    expect(readme).toContain('Express 5, TypeScript');
  });

  it('scaffolds Node backends with Drizzle when --orm drizzle is selected', async () => {
    dest = join(tmpdir(), `projx-drizzle-${Date.now()}`);
    await scaffold(
      {
        name: 'drizzle-app',
        components: ['fastify', 'express'],
        git: true,
        install: false,
        orm: 'drizzle',
      },
      dest,
      REPO_DIR,
    );

    const config = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));
    expect(config.orm).toBe('drizzle');

    for (const component of ['fastify', 'express']) {
      expect(existsSync(join(dest, component, 'drizzle.config.ts'))).toBe(true);
      expect(existsSync(join(dest, component, 'src/db/client.ts'))).toBe(true);
      expect(existsSync(join(dest, component, 'src/db/schema.ts'))).toBe(true);
      expect(existsSync(join(dest, component, 'prisma/schema.prisma'))).toBe(
        false,
      );

      const pkg = JSON.parse(
        await readFile(join(dest, component, 'package.json'), 'utf-8'),
      );
      expect(pkg.dependencies['drizzle-orm']).toBeTruthy();
      expect(pkg.dependencies.pg).toBeTruthy();
      expect(pkg.dependencies['@prisma/client']).toBeUndefined();
      expect(pkg.devDependencies['drizzle-kit']).toBeTruthy();
      expect(pkg.devDependencies.prisma).toBeUndefined();
      expect(pkg.scripts['db:push']).toBe('drizzle-kit push');
    }

    const fastifyApp = await readFile(
      join(dest, 'fastify/src/app.ts'),
      'utf-8',
    );
    expect(fastifyApp).toContain("orm: 'drizzle'");
    expect(fastifyApp).not.toContain('EntityRegistry');

    const expressApp = await readFile(
      join(dest, 'express/src/app.ts'),
      'utf-8',
    );
    expect(expressApp).toContain("orm: 'drizzle'");
    expect(expressApp).not.toContain('EntityRegistry');

    const ci = await readFile(join(dest, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toContain('drizzle-kit push --force');
    expect(ci).not.toContain('prisma migrate deploy');

    const setup = await readFile(join(dest, 'scripts/setup.sh'), 'utf-8');
    expect(setup).toContain('drizzle-kit push --force');
    expect(setup).not.toContain('prisma migrate dev');

    const readme = await readFile(join(dest, 'README.md'), 'utf-8');
    expect(readme).toContain('Fastify, Drizzle');
    expect(readme).toContain('Express 5, TypeScript, Drizzle');
  });

  it('scaffolds Node backends with Sequelize when --orm sequelize is selected', async () => {
    dest = join(tmpdir(), `projx-sequelize-${Date.now()}`);
    await scaffold(
      {
        name: 'sequelize-app',
        components: ['fastify', 'express'],
        git: true,
        install: false,
        orm: 'sequelize',
      },
      dest,
      REPO_DIR,
    );

    const config = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));
    expect(config.orm).toBe('sequelize');

    for (const component of ['fastify', 'express']) {
      expect(existsSync(join(dest, component, 'src/db/client.ts'))).toBe(true);
      expect(existsSync(join(dest, component, 'src/models/index.ts'))).toBe(
        true,
      );
      expect(
        existsSync(join(dest, component, 'src/modules/_base/auto-routes.ts')),
      ).toBe(true);
      expect(existsSync(join(dest, component, 'scripts/db-sync.ts'))).toBe(
        true,
      );
      expect(existsSync(join(dest, component, 'prisma/schema.prisma'))).toBe(
        false,
      );

      const pkg = JSON.parse(
        await readFile(join(dest, component, 'package.json'), 'utf-8'),
      );
      expect(pkg.dependencies.sequelize).toBeTruthy();
      expect(pkg.dependencies.pg).toBeTruthy();
      expect(pkg.dependencies['@prisma/client']).toBeUndefined();
      expect(pkg.devDependencies['sequelize-cli']).toBeTruthy();
      expect(pkg.devDependencies.prisma).toBeUndefined();
      expect(pkg.scripts['db:sync']).toContain('db-sync.ts');
    }

    const fastifyApp = await readFile(
      join(dest, 'fastify/src/app.ts'),
      'utf-8',
    );
    expect(fastifyApp).toContain("orm: 'sequelize'");
    expect(fastifyApp).toContain('// projx-anchor: entity-imports');
    expect(fastifyApp).toContain('// projx-anchor: entity-registrations');

    const ci = await readFile(join(dest, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toContain('tsx scripts/db-sync.ts');
    expect(ci).not.toContain('prisma migrate deploy');

    const setup = await readFile(join(dest, 'scripts/setup.sh'), 'utf-8');
    expect(setup).toContain('tsx scripts/db-sync.ts');
  });

  it('scaffolds Node backends with TypeORM when --orm typeorm is selected', async () => {
    dest = join(tmpdir(), `projx-typeorm-${Date.now()}`);
    await scaffold(
      {
        name: 'typeorm-app',
        components: ['fastify', 'express'],
        git: true,
        install: false,
        orm: 'typeorm',
      },
      dest,
      REPO_DIR,
    );

    const config = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));
    expect(config.orm).toBe('typeorm');

    for (const component of ['fastify', 'express']) {
      expect(existsSync(join(dest, component, 'src/db/data-source.ts'))).toBe(
        true,
      );
      expect(existsSync(join(dest, component, 'src/entities/index.ts'))).toBe(
        true,
      );
      expect(
        existsSync(join(dest, component, 'src/modules/_base/auto-routes.ts')),
      ).toBe(true);
      expect(existsSync(join(dest, component, 'scripts/db-sync.ts'))).toBe(
        true,
      );
      expect(existsSync(join(dest, component, 'prisma/schema.prisma'))).toBe(
        false,
      );

      const tsconfig = JSON.parse(
        await readFile(join(dest, component, 'tsconfig.json'), 'utf-8'),
      );
      expect(tsconfig.compilerOptions.experimentalDecorators).toBe(true);
      expect(tsconfig.compilerOptions.emitDecoratorMetadata).toBe(true);

      const pkg = JSON.parse(
        await readFile(join(dest, component, 'package.json'), 'utf-8'),
      );
      expect(pkg.dependencies.typeorm).toBeTruthy();
      expect(pkg.dependencies['reflect-metadata']).toBeTruthy();
      expect(pkg.dependencies.pg).toBeTruthy();
      expect(pkg.dependencies['@prisma/client']).toBeUndefined();
      expect(pkg.devDependencies.prisma).toBeUndefined();
      expect(pkg.scripts['db:sync']).toContain('db-sync.ts');
    }

    const fastifyApp = await readFile(
      join(dest, 'fastify/src/app.ts'),
      'utf-8',
    );
    expect(fastifyApp).toContain("orm: 'typeorm'");
    expect(fastifyApp).toContain("import 'reflect-metadata'");

    const ci = await readFile(join(dest, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toContain('tsx scripts/db-sync.ts');
    expect(ci).not.toContain('prisma migrate deploy');
  });

  it('writes correct .projx config', async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);
    await scaffold(
      { name: 'my-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const config = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));
    expect(config.version).toBeTruthy();
    expect(config.components).toBeUndefined();
    expect(config.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(config.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(config.defaultsApplied).toBe(true);
    expect(config.skip).toContain('docker-compose.yml');
    expect(config.skip).toContain('README.md');
  });

  it('writes .projx-component markers', async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);
    await scaffold(
      {
        name: 'my-app',
        components: ['fastify', 'frontend'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const fastifyMarker = JSON.parse(
      await readFile(join(dest, 'fastify/.projx-component'), 'utf-8'),
    );
    expect(fastifyMarker.component).toBe('fastify');
    expect(fastifyMarker.skip).toContain('package.json');
    expect(fastifyMarker.origin).toBeUndefined();

    const frontendMarker = JSON.parse(
      await readFile(join(dest, 'frontend/.projx-component'), 'utf-8'),
    );
    expect(frontendMarker.component).toBe('frontend');
  });

  it('generates shared files', async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);
    await scaffold(
      { name: 'my-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, 'scripts/setup.sh'))).toBe(true);
    expect(existsSync(join(dest, 'scripts/ci-local.sh'))).toBe(true);
    expect(existsSync(join(dest, '.githooks/pre-commit'))).toBe(true);
    expect(existsSync(join(dest, '.github/workflows/ci.yml'))).toBe(true);
    expect(existsSync(join(dest, 'README.md'))).toBe(true);
    expect(existsSync(join(dest, '.vscode/settings.json'))).toBe(true);
    expect(existsSync(join(dest, 'scripts/style-check.py'))).toBe(true);
  });

  it('keeps frontend tests under tests instead of src', async () => {
    dest = join(tmpdir(), `projx-frontend-tests-${Date.now()}`);
    await scaffold(
      {
        name: 'frontend-tests',
        components: ['frontend'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, 'frontend/tests/test-setup.ts'))).toBe(true);
    expect(existsSync(join(dest, 'frontend/src/test-setup.ts'))).toBe(false);
    expect(existsSync(join(dest, 'frontend/src/testing'))).toBe(false);
  });

  it('ci.yml uses canonical display names (FastAPI, Fastify, Express, Frontend, Flutter)', async () => {
    dest = join(tmpdir(), `projx-display-${Date.now()}`);
    await scaffold(
      {
        name: 'display-app',
        components: ['fastapi', 'fastify', 'express', 'frontend', 'mobile'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const ci = await readFile(join(dest, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toContain('name: FastAPI (format + lint + typecheck + audit)');
    expect(ci).toContain(
      'name: Fastify (format + lint + typecheck + build + audit)',
    );
    expect(ci).toContain(
      'name: Express (format + lint + typecheck + build + test + audit)',
    );
    expect(ci).toContain(
      'name: Frontend (format + lint + typecheck + build + audit)',
    );
    expect(ci).toContain('name: Flutter (format + analyze + test + coverage)');
    expect(ci).toContain('name: Secret scan');
    expect(ci).toContain(
      'uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5',
    );
    expect(ci).toContain(
      'uses: dorny/paths-filter@d1c1ffe0248fe513906c8e24db8ea791d46f8590 # v3',
    );
    expect(ci).toContain(
      'uses: gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7 # v2',
    );
    expect(ci).not.toContain('uses: actions/checkout@v5');
    expect(ci).not.toContain('uses: gitleaks/gitleaks-action@v2');
    expect(ci).toContain('python3 scripts/style-check.py frontend/src');
    expect(ci).toContain('run_pip_audit() {');
    expect(ci).toContain('uv run pip-audit --ignore-vuln CVE-2026-3219');
    expect(ci).toContain('sleep $((attempt * 5))');
    expect(ci).toMatch(
      /^permissions:\n\s+contents: read\n\s+pull-requests: read/m,
    );
    expect(ci).toContain('image: postgres:16');
    expect(ci).toContain(
      'DATABASE_URL: postgresql://postgres:postgres@localhost',
    );
    expect(ci).toContain(
      'SQLALCHEMY_DATABASE_URI: postgresql+asyncpg://postgres:postgres@localhost',
    );
    expect(ci).toContain('prisma migrate deploy');
    expect(ci).toMatch(/node-version: 22[\s\S]+node-version: 22/);
    expect(ci).not.toContain('node-version: 20');
    expect(ci).toContain('bash scripts/check-bundle-size.sh');
  });

  it('scaffolds hardened deploy scripts and buildspecs', async () => {
    dest = join(tmpdir(), `projx-deploy-hardening-${Date.now()}`);
    await scaffold(
      {
        name: 'deploy-app',
        components: ['infra'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const backend = await readFile(
      join(dest, 'infra/cicd/buildspec.backend.yml'),
      'utf-8',
    );
    const frontend = await readFile(
      join(dest, 'infra/cicd/buildspec.frontend.yml'),
      'utf-8',
    );
    const cicd = await readFile(join(dest, 'infra/stack/cicd.tf'), 'utf-8');
    const rollback = await readFile(
      join(dest, 'infra/cicd/buildspec.rollback.yml'),
      'utf-8',
    );

    for (const buildspec of [backend, frontend]) {
      expect(buildspec).toContain('trivy image --exit-code 1');
      expect(buildspec).toContain(
        'DOCKER_STEP_TIMEOUT="${DOCKER_STEP_TIMEOUT:-10m}"',
      );
      expect(buildspec).toContain(
        'timeout "$DOCKER_STEP_TIMEOUT" docker build',
      );
      expect(buildspec).toContain('timeout "$DOCKER_STEP_TIMEOUT" docker push');
      expect(buildspec).toContain('docker image prune --filter');
      expect(buildspec).toContain('health_check_url');
      expect(buildspec).toContain("curl -kfsSL -o /dev/null -w '%{http_code}'");
      expect(buildspec).toContain('for attempt in 1 2 3 4 5');
      expect(buildspec).toContain('SLACK_DEPLOY_WEBHOOK');
      expect(buildspec).toContain('notify_deploy');
      expect(buildspec).not.toContain('docker image prune -a -f');
    }

    expect(backend).toContain('create-db-snapshot');
    expect(backend).toContain('RDS_DB_INSTANCE_IDENTIFIER');
    expect(cicd).toContain('rds:CreateDBSnapshot');
    expect(cicd).toContain('SLACK_DEPLOY_WEBHOOK');
    expect(cicd).toContain('DEPLOY_HEALTH_URL');
    expect(cicd).toContain('RDS_DB_INSTANCE_IDENTIFIER');
    expect(cicd).toContain('resource "aws_codebuild_project" "rollback"');
    expect(cicd).toContain('../cicd/buildspec.rollback.yml');
    expect(cicd).toContain('ecr:DescribeImages');

    expect(existsSync(join(dest, 'infra/scripts/rollback-compose.sh'))).toBe(
      true,
    );
    expect(existsSync(join(dest, 'infra/scripts/keep-recent-images.sh'))).toBe(
      true,
    );
    expect(rollback).toContain('ROLLBACK_SERVICE=backend|frontend');
    expect(rollback).toContain('ROLLBACK_IMAGE_TAG=<tag>');
    expect(rollback).toContain('aws ecr describe-images');
    expect(rollback).toContain('kubectl -n');
    expect(rollback).toContain('docker-compose -f /opt/docker-compose.yml up');
    expect(rollback).toContain('notify_rollback');
  });

  it('setup.sh uses canonical display names', async () => {
    dest = join(tmpdir(), `projx-setup-display-${Date.now()}`);
    await scaffold(
      {
        name: 'display-app',
        components: ['fastapi', 'fastify', 'frontend'],
        git: true,
        install: false,
      },
      dest,
      REPO_DIR,
    );

    const setup = await readFile(join(dest, 'scripts/setup.sh'), 'utf-8');
    expect(setup).toContain('FastAPI dependencies installed.');
    expect(setup).toContain('Fastify dependencies installed.');
    expect(setup).toContain('Frontend dependencies installed.');
  });

  it('substitutes project name in package.json', async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);
    await scaffold(
      { name: 'my-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const pkg = JSON.parse(
      await readFile(join(dest, 'fastify/package.json'), 'utf-8'),
    );
    expect(pkg.name).toBe('my-app-fastify');
  });

  it('defaults to npm when no packageManager specified', async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);
    await scaffold(
      { name: 'npm-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    const config = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));
    expect(config.packageManager).toBe('npm');
  });

  it('does not create docker-compose without backend or frontend', async () => {
    dest = join(tmpdir(), `projx-scaffold-${Date.now()}`);
    await scaffold(
      { name: 'my-app', components: ['e2e'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, 'docker-compose.yml'))).toBe(false);
  });

  it('creates project without git when opts.git is false', async () => {
    dest = join(tmpdir(), `projx-scaffold-no-git-${Date.now()}`);
    await scaffold(
      { name: 'no-git', components: ['fastify'], git: false, install: false },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, 'fastify'))).toBe(true);
    expect(existsSync(join(dest, '.git'))).toBe(false);
  });

  it('copies .env.example to .env after scaffolding', async () => {
    dest = join(tmpdir(), `projx-scaffold-env-${Date.now()}`);
    await scaffold(
      { name: 'env-app', components: ['fastify'], git: true, install: false },
      dest,
      REPO_DIR,
    );

    expect(existsSync(join(dest, 'fastify/.env.example'))).toBe(true);
    expect(existsSync(join(dest, 'fastify/.env'))).toBe(true);
  });
});

describe('scaffold install paths (mocked)', () => {
  let dest: string;
  let execSpy: ReturnType<typeof vi.spyOn>;
  let hasCommandSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    execSpy = vi.spyOn(utilsModule, 'exec').mockImplementation(() => '');
    hasCommandSpy = vi.spyOn(utilsModule, 'hasCommand');
  });

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('runs install commands for each js component when tool is on PATH', async () => {
    dest = join(tmpdir(), `projx-scaffold-install-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      {
        name: 'install-app',
        components: ['fastify', 'frontend', 'e2e', 'fastapi', 'mobile'],
        git: false,
        install: true,
        packageManager: 'npm',
      },
      dest,
      REPO_DIR,
    );

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes('uv sync'))).toBe(true);
    expect(
      calls.filter((c) => c.includes('npm install')).length,
    ).toBeGreaterThanOrEqual(3);
    expect(calls.some((c) => c.includes('flutter pub get'))).toBe(true);
  });

  it('falls back to warn message when package manager is missing', async () => {
    dest = join(tmpdir(), `projx-scaffold-missing-${Date.now()}`);
    hasCommandSpy.mockReturnValue(false);

    await scaffold(
      {
        name: 'no-tool',
        components: ['fastify', 'frontend', 'fastapi', 'mobile'],
        git: false,
        install: true,
        packageManager: 'pnpm',
      },
      dest,
      REPO_DIR,
    );

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes('pnpm install'))).toBe(false);
    expect(calls.some((c) => c.includes('flutter pub get'))).toBe(false);
    expect(calls.some((c) => c.includes('uv sync'))).toBe(false);
    expect(existsSync(join(dest, 'fastify'))).toBe(true);
  });

  it('install: true with infra-only is a no-op for installs', async () => {
    dest = join(tmpdir(), `projx-scaffold-infra-${Date.now()}`);
    hasCommandSpy.mockReturnValue(true);

    await scaffold(
      {
        name: 'infra-only',
        components: ['infra'],
        git: false,
        install: true,
      },
      dest,
      REPO_DIR,
    );

    const calls = (execSpy.mock.calls as [string, string][]).map((c) => c[0]);
    expect(calls.some((c) => c.includes('install'))).toBe(false);
    expect(calls.some((c) => c.includes('flutter'))).toBe(false);
  });
});

const PMS: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

describe.each(PMS)('scaffold with %s', (pm) => {
  let dest: string;
  const cmd = pmCommands(pm);

  afterEach(async () => {
    if (dest) await rm(dest, { recursive: true, force: true });
  });

  it('stores packageManager in .projx', async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ['fastify', 'frontend'],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const config = JSON.parse(await readFile(join(dest, '.projx'), 'utf-8'));
    expect(config.packageManager).toBe(pm);
  });

  it('setup.sh uses correct install command', async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ['fastify', 'frontend'],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const setup = await readFile(join(dest, 'scripts/setup.sh'), 'utf-8');
    expect(setup).toMatch(new RegExp(`^  ${escapeRegex(cmd.install)}$`, 'm'));
  });

  it('setup.sh wraps each install block in a subshell so failures abort the script', async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ['fastify', 'frontend'],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const setup = await readFile(join(dest, 'scripts/setup.sh'), 'utf-8');
    expect(setup).not.toContain('&& cd ..');
    expect(setup).toMatch(/\(\n\s+cd fastify\n\s+\S+/);
    expect(setup).toMatch(/\(\n\s+cd frontend\n\s+\S+/);
  });

  it('README uses correct commands', async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ['fastify', 'frontend'],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const readme = await readFile(join(dest, 'README.md'), 'utf-8');
    expect(readme).toContain(cmd.install);
    expect(readme).toContain(cmd.run);
  });

  it('docker-compose.yml uses fastify migrate target', async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ['fastify'],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const dc = await readFile(join(dest, 'docker-compose.yml'), 'utf-8');
    expect(dc).toContain('target: migrate');
  });

  it('CI workflow uses correct setup and install', async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ['fastify', 'frontend', 'e2e'],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const ci = await readFile(join(dest, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toContain(cmd.ci);
    expect(ci).toContain(cmd.prismaExec);
    expect(ci).toContain(cmd.audit);
    expect(ci).toContain(
      'gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7 # v2',
    );

    if (pm === 'pnpm') {
      expect(ci).toContain(
        'pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4',
      );
    }
    if (pm === 'bun') {
      expect(ci).toContain(
        'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2',
      );
      expect(ci).not.toContain(
        'actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5',
      );
    }
    if (pm === 'npm' || pm === 'yarn') {
      expect(ci).not.toContain('pnpm/action-setup');
      expect(ci).not.toContain('oven-sh/setup-bun');
      expect(ci).toContain(
        'actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5',
      );
    }
  });

  it('pre-commit hook uses correct exec command', async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ['fastify', 'frontend'],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const hook = await readFile(join(dest, '.githooks/pre-commit'), 'utf-8');
    expect(hook).toContain(`${cmd.exec} prettier`);
    expect(hook).toContain(`${cmd.exec} eslint`);
    expect(hook).toContain(`${cmd.exec} tsc`);
  });

  it('pre-commit hook does not run pip-audit (moved to CI)', async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ['fastapi'],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const hook = await readFile(join(dest, '.githooks/pre-commit'), 'utf-8');
    expect(hook).not.toContain('pip-audit');

    const ci = await readFile(join(dest, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toContain('pip-audit');
  });

  it('frontend Dockerfile uses the correct install and run commands', async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ['frontend'],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const dockerfile = await readFile(
      join(dest, 'frontend/Dockerfile'),
      'utf-8',
    );
    expect(existsSync(join(dest, 'frontend/Dockerfile.ejs'))).toBe(false);
    expect(dockerfile).toContain(cmd.ci);
    expect(dockerfile).toContain(`${cmd.run} build`);
    expect(dockerfile).toContain(cmd.lockfile);
    expect(dockerfile).toContain('security-headers.inc');
    if (pm === 'bun') {
      expect(dockerfile).toContain('oven/bun');
    } else {
      expect(dockerfile).toContain('node:22-alpine3.20');
    }
    expect(dockerfile).toContain('HEALTHCHECK');
  });

  it('fastify Dockerfile uses the correct install, prisma, and run commands', async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ['fastify'],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const dockerfile = await readFile(
      join(dest, 'fastify/Dockerfile'),
      'utf-8',
    );
    expect(existsSync(join(dest, 'fastify/Dockerfile.ejs'))).toBe(false);
    expect(dockerfile).toContain(cmd.ci);
    expect(dockerfile).toContain(`${cmd.prismaExec} generate`);
    expect(dockerfile).toContain(`${cmd.run} build`);
    expect(dockerfile).toContain(cmd.lockfile);
    expect(dockerfile).toContain('FROM build AS migrate');
    expect(existsSync(join(dest, 'fastify/ecosystem.config.cjs'))).toBe(true);
  });

  it('express Dockerfile uses the correct install, prisma, and run commands', async () => {
    dest = join(tmpdir(), `projx-pm-${pm}-${Date.now()}`);
    await scaffold(
      {
        name: `${pm}-app`,
        components: ['express'],
        git: true,
        install: false,
        packageManager: pm,
      },
      dest,
      REPO_DIR,
    );

    const dockerfile = await readFile(
      join(dest, 'express/Dockerfile'),
      'utf-8',
    );
    expect(existsSync(join(dest, 'express/Dockerfile.ejs'))).toBe(false);
    expect(dockerfile).toContain(cmd.ci);
    expect(dockerfile).toContain(`${cmd.prismaExec} generate`);
    expect(dockerfile).toContain(`${cmd.run} build`);
    expect(dockerfile).toContain(cmd.lockfile);
    expect(dockerfile).toContain('FROM build AS migrate');
  });
});
