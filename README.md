# Projx

[![npm version](https://img.shields.io/npm/v/create-projx)](https://www.npmjs.com/package/create-projx)
[![CI](https://github.com/ukanhaupa/projx/actions/workflows/ci.yml/badge.svg)](https://github.com/ukanhaupa/projx/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Production-grade project scaffolder. Pick your stack, get a fully wired project with auth, database, CI/CD, and E2E tests — ready to deploy.

## The Problem

Starting a new project means days of boilerplate: setting up auth, database migrations, CI/CD pipelines, Docker configs, linting, pre-commit hooks, test infrastructure. Every team does this from scratch, every time.

## The Solution

```bash
npx create-projx my-app
```

Pick the components you need. Get a production-ready project in seconds.

## Quick Start

```bash
# Interactive — pick your stack
npx create-projx my-app

# Non-interactive — specify components
npx create-projx my-app --components fastify,frontend,e2e

# Accept defaults (Fastify + Frontend + E2E)
npx create-projx my-app -y
```

## Components

| Component | Stack | What You Get |
| --------- | ----- | ------------ |
| `fastapi` | Python, SQLAlchemy, Alembic | Auto-entity CRUD, JWT auth, migrations, OpenAPI docs |
| `fastify` | Node.js, Prisma, TypeBox | Auto-entity CRUD, JWT auth, typed schemas, OpenAPI docs |
| `frontend` | React 19, TypeScript, Vite | Auto-entity UI from metadata, design tokens, light/dark mode |
| `mobile` | Flutter, Riverpod, GoRouter | Auto-entity screens, offline-first with Isar, biometric auth |
| `e2e` | Playwright | Page object model, auth fixtures, accessibility scans |
| `infra` | Terraform, AWS | EKS, RDS, VPC, ALB, CodePipeline, multi-environment |

All optional. Pick any combination.

## Commands

### Create a Project

```bash
npx create-projx my-app
```

Interactive prompt lets you pick components. Or specify them directly:

```bash
npx create-projx my-app --components fastapi,fastify,frontend,mobile,e2e,infra
```

### Adopt an Existing Project

Already have a project? Initialize projx to get the scaffolding (CI, hooks, docker-compose) without overwriting your code:

```bash
cd my-existing-app
npx create-projx init
```

Auto-detects components by scanning for `fastapi` in pyproject.toml, `react`/`fastify` in package.json, `flutter` in pubspec.yaml, and `.tf` files. Confirms each mapping, creates a `projx/baseline` branch with the template, and merges it — preserving all your existing code while establishing the ancestry link that makes future updates work.

### Add Components Later

```bash
cd my-app
npx create-projx add frontend mobile
```

Copies the new component directories, regenerates shared files (docker-compose, CI, pre-commit hooks) to include them, and installs dependencies.

### Update Scaffolding

When templates improve, update your project:

```bash
cd my-app
npx create-projx@latest update
```

If the template merges cleanly with your code, it's auto-committed — done. If there are differences, template files are written directly and you review with `git diff`:

```bash
git diff                              # see what changed
git checkout -- path/to/file          # discard a change you don't want
git add . && git commit -m "projx: update to vX.X.X"  # commit when ready
```

Your custom files (controllers, pages, middleware) are never deleted. Files you created that don't exist in the template are always preserved.

### Skip Files

If a file keeps getting overwritten on every update, add it to `.projx-component`:

```json
{
  "components": ["fastapi"],
  "origin": "init",
  "skip": ["src/**", "tests/**"]
}
```

Skipped files are excluded from template updates. Tooling files (Dockerfile, eslint, tsconfig) still get updated.

## Options

```
npx create-projx <name> [options]
npx create-projx init
npx create-projx add <components...>
npx create-projx update

--components <list>    Comma-separated: fastapi,fastify,frontend,mobile,e2e,infra
--no-git               Skip git init
--no-install           Skip dependency installation
-y, --yes              Accept defaults (fastify + frontend + e2e)
-h, --help             Show help
```

## Rename Component Directories

Rename `fastapi/` to `backend/`? Just rename the folder — the `.projx-component` marker file moves with it. The `update` command auto-discovers where each component lives by scanning for these markers. No config changes needed.

```
backend/.projx-component  →  { "components": ["fastapi"] }
web/.projx-component      →  { "components": ["frontend"] }
```

CI, setup.sh, pre-commit hooks, and docker-compose are all regenerated with your custom directory names.

## What a Scaffolded Project Looks Like

```
my-app/
├── fastapi/                # Auto-entity CRUD backend
│   └── .projx-component    # Identifies this as the fastapi component
├── frontend/               # Auto-entity UI from /_meta
│   └── .projx-component
├── e2e/                    # Playwright E2E tests
│   └── .projx-component
├── docker-compose.yml      # Production (backend + frontend + SSL)
├── docker-compose.dev.yml  # Development (PostgreSQL + hot reload)
├── .github/workflows/      # CI per component (runs only on changes)
├── .githooks/pre-commit    # Format + lint on commit
├── .vscode/                # Editor settings + recommended extensions
├── setup.sh                # Install all deps
└── .projx                  # Components list + version
```

Only the components you selected appear. Shared files (docker-compose, CI, hooks) are generated to match your selection.

## Auto-Entity Pattern

The core idea: define a data model, get everything else for free.

**Backend** — Drop a model file. The registry auto-discovers it and generates CRUD routes, schemas, pagination, filtering, sorting, search, FK expansion, and OpenAPI docs.

**Frontend** — Fetches metadata from `GET /api/v1/_meta`, renders table + form UI automatically. Customize with overrides.

**Mobile** — Same metadata endpoint, generates list/detail/form screens. Offline-first with local DB and sync queue.

## What's Included

- JWT auth with Keycloak (pluggable providers)
- Docker Compose for dev and prod
- GitHub Actions CI per component (path-filtered — only runs when that component changes)
- Pre-commit hooks (format + lint + typecheck)
- Secret detection in pre-commit
- VS Code settings + recommended extensions
- 80% test coverage enforced
- Auto-entity discovery across all stacks

## Development

Contributing to Projx itself:

```bash
git clone https://github.com/ukanhaupa/projx.git
cd projx
./setup.sh
```

The CLI lives in `cli/`. Templates are the root-level component directories (`fastapi/`, `frontend/`, etc.).

```bash
cd cli
npm test        # run tests
npm run build   # build CLI
```

## Badge

Add this to your project's README:

```md
[![Built with Projx](https://img.shields.io/badge/Built%20with-Projx-blue)](https://github.com/ukanhaupa/projx)
```

## License

MIT
