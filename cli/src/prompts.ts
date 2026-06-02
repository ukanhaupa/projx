import * as p from '@clack/prompts';
import {
  COMPONENTS,
  GO_ORM_PROVIDERS,
  NODE_ORM_PROVIDERS,
  type Component,
  type OrmProvider,
  type Options,
  type PackageManager,
  PACKAGE_MANAGERS,
} from './utils.js';

const ORM_LABELS: Record<OrmProvider, string> = {
  prisma: 'Prisma (Node)',
  drizzle: 'Drizzle (Node)',
  sequelize: 'Sequelize (Node)',
  typeorm: 'TypeORM (Node)',
  gorm: 'GORM (Go)',
  sqlc: 'sqlc (Go)',
  ent: 'ent (Go)',
  seaorm: 'SeaORM (Rust)',
  eloquent: 'Eloquent (PHP)',
};

export const LABELS: Record<Component, { label: string; hint: string }> = {
  fastapi: { label: 'FastAPI', hint: 'Python — SQLAlchemy, Alembic, uvicorn' },
  fastify: { label: 'Fastify', hint: 'Node.js — Prisma, TypeBox, TypeScript' },
  express: { label: 'Express', hint: 'Node.js — Express 5, TypeScript' },
  go: { label: 'Go', hint: 'Go — Chi + GORM, entity registry' },
  rust: { label: 'Rust', hint: 'Rust (Axum + SeaORM)' },
  laravel: { label: 'Laravel', hint: 'Laravel (PHP 8.3+)' },
  frontend: { label: 'Frontend', hint: 'React 19 + Vite + React Router' },
  mobile: { label: 'Mobile', hint: 'Flutter + Riverpod + GoRouter' },
  e2e: { label: 'E2E Tests', hint: 'Playwright' },
  infra: { label: 'Infrastructure', hint: 'Terraform + AWS' },
};

const DEFAULTS: Component[] = ['fastify', 'frontend', 'e2e'];

export async function runPrompts(nameArg?: string): Promise<Options> {
  p.intro('projx');

  const name =
    nameArg ??
    ((await p.text({
      message: 'Project name',
      placeholder: 'my-app',
      validate: (v) => {
        if (!v) return 'Required';
        if (!/^[a-z0-9][a-z0-9-]*$/.test(v))
          return 'Lowercase, hyphens, no spaces';
      },
    })) as string);

  if (p.isCancel(name)) process.exit(0);

  const components = (await p.multiselect({
    message: 'Which components?',
    options: COMPONENTS.map((c) => ({
      value: c,
      label: LABELS[c].label,
      hint: LABELS[c].hint,
    })),
    initialValues: DEFAULTS,
    required: false,
  })) as Component[];

  if (p.isCancel(components)) process.exit(0);

  if (components.length === 0) {
    p.log.warn('No components selected. Creating an empty project.');
  }

  const hasJs = components.some((c) =>
    ['fastify', 'express', 'frontend', 'e2e'].includes(c),
  );
  const hasNodeBackend = components.some((c) =>
    ['fastify', 'express'].includes(c),
  );
  const hasGoBackend = components.includes('go');
  let orm: OrmProvider = hasGoBackend && !hasNodeBackend ? 'gorm' : 'prisma';
  let packageManager: PackageManager = 'npm';

  if (hasNodeBackend) {
    const choice = (await p.select({
      message: 'Node backend ORM',
      options: NODE_ORM_PROVIDERS.map((provider) => ({
        value: provider,
        label: ORM_LABELS[provider],
      })),
      initialValue: 'prisma' as OrmProvider,
    })) as OrmProvider | symbol;

    if (p.isCancel(choice)) process.exit(0);
    orm = choice as OrmProvider;
  } else if (hasGoBackend) {
    const choice = (await p.select({
      message: 'Go backend ORM',
      options: GO_ORM_PROVIDERS.map((provider) => ({
        value: provider,
        label: ORM_LABELS[provider],
      })),
      initialValue: 'gorm' as OrmProvider,
    })) as OrmProvider | symbol;

    if (p.isCancel(choice)) process.exit(0);
    orm = choice as OrmProvider;
  }

  if (hasJs) {
    const pm = (await p.select({
      message: 'Package manager',
      options: PACKAGE_MANAGERS.map((pm) => ({ value: pm, label: pm })),
      initialValue: 'npm' as PackageManager,
    })) as PackageManager | symbol;

    if (p.isCancel(pm)) process.exit(0);
    packageManager = pm as PackageManager;
  }

  return { name, components, git: true, install: true, packageManager, orm };
}
