# Projx

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

### Add Components Later

Already have a project? Add more components anytime:

```bash
cd my-app
npx create-projx add frontend mobile
```

This copies the new component directories, regenerates shared files (docker-compose, CI, pre-commit hooks) to include them, and installs dependencies.

### Update Scaffolding

When we improve templates, update your project's scaffolding without touching your code:

```bash
cd my-app
npx create-projx@latest update
```

This updates template files (base models, middleware, configs, Dockerfiles, CI) tracked in `.projx` manifest. Files you created (new entities, pages, features) are never touched.

## Options

```
npx create-projx <name> [options]
npx create-projx add <components...>
npx create-projx update

--components <list>    Comma-separated: fastapi,fastify,frontend,mobile,e2e,infra
--no-git               Skip git init
--no-install           Skip dependency installation
-y, --yes              Accept defaults (fastify + frontend + e2e)
-h, --help             Show help
```

## What a Scaffolded Project Looks Like

```
my-app/
├── fastapi/              # Auto-entity CRUD backend
├── frontend/             # Auto-entity UI from /_meta
├── e2e/                  # Playwright E2E tests
├── docker-compose.yml    # Production (backend + frontend + SSL)
├── docker-compose.dev.yml # Development (PostgreSQL + hot reload)
├── .github/workflows/    # CI per component
├── .githooks/pre-commit  # Format + lint on commit
├── setup.sh              # Install all deps
└── .projx                # Manifest (tracks template files for updates)
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
- GitHub Actions CI per component
- Pre-commit hooks (format + lint + typecheck)
- Secret detection in pre-commit
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

## License

MIT
