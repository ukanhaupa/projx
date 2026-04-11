# Projx

[![npm version](https://img.shields.io/npm/v/create-projx)](https://www.npmjs.com/package/create-projx)
[![CI](https://github.com/ukanhaupa/projx/actions/workflows/ci.yml/badge.svg)](https://github.com/ukanhaupa/projx/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/ukanhaupa/projx)](https://github.com/ukanhaupa/projx)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Go from blank folder to production-ready project in 30 seconds.** Backend-only API, AI/ML app, mobile, full-stack, infra setup — pick what you need and get it wired with auth, database, Docker, CI/CD, hooks, and tests. All optional. All yours.

![projx demo](.github/demo.gif)

```bash
npx create-projx my-app
```

No SDK lock-in. No runtime dependency on Projx. Just clean code in your repo that you own forever.

---

## You've done this a hundred times

Every new project starts with the same week of plumbing:

- Wire up auth (again).
- Configure the database and migrations (again).
- Write the Dockerfile and `docker-compose.yml` (again).
- Set up CI, linting, formatting, pre-commit hooks (again).
- Build the same login + CRUD scaffolding (again).
- Realize at 11pm that something's broken and you don't remember why (again).

You ship features two weeks late because the first two weeks were boilerplate.

## Or your AI does it badly

Ask an LLM to "scaffold a full-stack app" and you get 50 files of plausible-looking code that breaks on first run. Wrong import paths. Outdated package versions. Auth that doesn't actually authenticate. You end up debugging machine-generated boilerplate, which is worse than writing it yourself.

## What if you just… didn't?

```bash
npx create-projx my-app       # interactive — pick exactly what you need
cd my-app
./setup.sh                    # installs everything you picked
```

Pick any combination of components — they're all optional:

```bash
# AI/ML backend only
npx create-projx vision-api --components fastapi -y

# Node API + React frontend
npx create-projx saas --components fastify,frontend -y

# Mobile app with backend
npx create-projx field-app --components fastapi,mobile -y

# Full-stack with infra and E2E
npx create-projx prod-app --components fastify,frontend,e2e,infra -y

# Just the infra
npx create-projx platform --components infra -y
```

**30 seconds.** No matter what you pick, you get auth, Docker, CI/CD, hooks, and tests wired up for it.

If this saves you even one hour, it's already paid for itself. (It's free.)

## Why teams pick Projx and stay

- **It actually runs.** Every template is tested in CI before release. No "looks right" surprises.
- **Tests ship with the code.** `gen entity` writes integration tests alongside every model — 11 tests per entity, against a real database. You start green, not scrambling.
- **Auto-entity pattern.** Define a data model, get CRUD routes, validation, OpenAPI docs, and a typed UI for free. Backend, frontend, and mobile all stay in sync.
- **Updates don't nuke your code.** `projx update` does a 3-tier merge — your custom controllers, pages, and config survive template upgrades. No rewrites.
- **No lock-in.** Projx generates files and walks away. Delete the `.projx` config and it's just a normal repo.
- **Adopt incrementally.** Already have a project? `projx init` adds CI, hooks, and Docker without touching your code.
- **Pick your package manager.** npm, pnpm, yarn, or bun. The choice propagates everywhere — scripts, Docker, CI, docs.
- **AI-agent friendly.** Ships with [SKILL.md](SKILL.md) so Claude, Cursor, and other agents call Projx instead of hand-writing broken scaffolds.

## What you get

| Component  | Stack                       | What it gives you                                            |
| ---------- | --------------------------- | ------------------------------------------------------------ |
| `fastapi`  | Python, SQLAlchemy, Alembic | Auto-entity CRUD, JWT auth, migrations, OpenAPI docs         |
| `fastify`  | Node.js, Prisma, TypeBox    | Auto-entity CRUD, JWT auth, typed schemas, OpenAPI docs      |
| `frontend` | React 19, TypeScript, Vite  | Auto-entity UI from `/_meta`, design tokens, light/dark mode |
| `mobile`   | Flutter, Riverpod, GoRouter | Auto-entity screens, offline-first with Isar, biometric auth |
| `e2e`      | Playwright                  | Page object model, auth fixtures, accessibility scans        |
| `infra`    | Terraform, AWS              | EKS, RDS, VPC, ALB, CodePipeline, multi-environment          |

Plus, in every project: Docker Compose for dev + prod, GitHub Actions CI per component (path-filtered), pre-commit hooks, secret detection, VS Code settings, and 80% test coverage enforced.

All optional. Pick any combination.

## Built for humans and AI agents

Projx is a shared operating system for teams that ship with both:

- **Developers** get a readable layout, stable conventions, and safe updates.
- **AI agents** get a deterministic CLI to call instead of guessing folder structures.
- **Teams** get consistency across repos, less drift, and fewer surprise refactors.

If you're an AI agent reading this, see [SKILL.md](SKILL.md) for trigger conditions, decision rules, and the canonical invocation.

## Quick Start

```bash
# Interactive — pick your stack
npx create-projx my-app

# Non-interactive — specify components
npx create-projx my-app --components fastify,frontend,e2e

# Accept defaults (Fastify + Frontend + E2E)
npx create-projx my-app -y
```

## Package Manager Support

Projx supports **npm**, **pnpm**, **yarn**, and **bun**. During `create`, you're prompted to pick one. The choice is stored in `.projx` and used everywhere — setup.sh, Docker, CI, pre-commit hooks, and README.

```json
{ "packageManager": "pnpm" }
```

For `init`, the package manager is auto-detected from lockfiles (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lockb` → bun). Falls back to a prompt if no lockfile is found.

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

Updates use a 3-tier merge strategy:

1. **Git merge** — if the template merges cleanly with your code, it's auto-committed. Done.
2. **3-way merge** — if git merge fails, each file is merged individually using `git merge-file`. Your additions (extra deps, env vars, custom config) are preserved alongside template updates. Clean merges are auto-staged; only true conflicts need review.
3. **Direct copy** — if no merge baseline exists, template files are written directly. You pick which changes to keep via an interactive prompt, and discarded files are automatically added to your skip list.

Your custom files (controllers, pages, middleware) are never deleted. Files you created that don't exist in the template are always preserved.

### Skip Files

Common user-owned files are **default-skipped** automatically — template updates won't touch them:

| Scope | Default skips |
|-------|---------------|
| Root (`.projx`) | `docker-compose.yml`, `docker-compose.dev.yml`, `README.md`, `.githooks/pre-commit`, `.github/workflows/ci.yml`, `setup.sh` |
| fastapi | `pyproject.toml` |
| fastify / frontend / e2e | `package.json` |
| mobile | `pubspec.yaml` |

Defaults are applied once on first `update` and saved to the `skip` array. To skip additional files, add them to `skip` in `.projx` (root-level) or `.projx-component` (per-component):

```json
// .projx — root skip
{
  "version": "x.y.z",
  "skip": ["docker-compose.yml", "README.md", "my-custom-config.yml"]
}
```

```json
// fastapi/.projx-component — component skip
{
  "component": "fastapi",
  "origin": "init",
  "skip": ["pyproject.toml", "src/custom_middleware.py"]
}
```

To opt back in to updates for a skipped file, use `npx create-projx unpin <file>`.

## Options

```
npx create-projx <name> [options]
npx create-projx init
npx create-projx add <components...>
npx create-projx update
npx create-projx diff
npx create-projx pin <patterns...>
npx create-projx unpin <patterns...>
npx create-projx pin --list
npx create-projx doctor [--fix]
npx create-projx gen entity <name> [--ai | --backend]
npx create-projx sync [--url <url>]

--components <list>    Comma-separated: fastapi,fastify,frontend,mobile,e2e,infra
--ai                   Target fastapi (AI/ML) for gen entity
--backend              Target fastify (API backend) for gen entity
--no-git               Skip git init
--no-install           Skip dependency installation
-y, --yes              Accept defaults (fastify + frontend + e2e)
-h, --help             Show help
```

### Preview Changes

See what `update` would change before applying:

```bash
cd my-app
npx create-projx diff
```

Shows file-by-file analysis: clean updates, files needing merge, user-only changes, and skipped files.

### Pin / Unpin Files

Skip files from future template updates without editing JSON:

```bash
npx create-projx pin backend/pyproject.toml      # skip this file
npx create-projx pin "backend/src/**"             # skip with glob
npx create-projx unpin backend/pyproject.toml     # allow updates again
npx create-projx pin --list                       # show all pinned files
```

Files inside a component directory are added to that component's `.projx-component` skip list. Root-level files are added to `.projx` skip.

### Health Check

Diagnose issues with your projx setup:

```bash
npx create-projx doctor         # check everything
npx create-projx doctor --fix   # auto-fix what's possible
```

Checks: config validity, component markers, baseline ref, stale worktrees, skip pattern coverage.

### Generate Entities

Scaffold a new entity in your primary backend + typed models for frontend/mobile:

```bash
npx create-projx gen entity invoice                                          # interactive
npx create-projx gen entity invoice --fields "name:string,amount:number"     # non-interactive
npx create-projx gen entity embedding --ai --fields "name:string,vector:json"  # target AI backend
```

When both `fastapi` and `fastify` exist, the entity generates in the **primary backend** only (not both). First run prompts you to choose and saves to `.projx`:

```json
{ "primaryBackend": "fastify" }
```

Override with `--ai` (fastapi) or `--backend` (fastify).

| Component                 | Generated                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Primary backend (fastapi) | `src/entities/<name>/_model.py` + `tests/test_<name>_entity.py` — model + 11 CRUD/auth tests |
| Primary backend (fastify) | `src/modules/<name>/schemas.ts` + `index.ts` + Prisma model + `tests/modules/<name>.test.ts` |
| `frontend`                | `src/types/<name>.ts` — TypeScript interface + Create/Update variants                        |
| `mobile`                  | `lib/entities/<name>/model.dart` — Dart class with fromJson/toJson/copyWith                  |

**Tests included**: every `gen entity` writes a working integration test file alongside the model — 11 tests for FastAPI (extending `BaseEntityApiTest`), 11 tests for Fastify (via `describeCrudEntity`). Both run against a real database (Postgres for Fastify, SQLite-in-memory for FastAPI today). New entities ship green from day one — no scrambling to bolt on tests at go-live.

No migrations — run `alembic revision --autogenerate` or `prisma migrate dev` (via your package manager) when ready.

### Sync Types

Regenerate all frontend/mobile types from a running backend:

```bash
npx create-projx sync                                              # auto-detects URL
npx create-projx sync --url http://localhost:8000/api/v1/_meta      # explicit URL
```

Fetches `/_meta` from your backend, generates typed interfaces for every entity. Run after any backend change — new field, renamed column, new entity.

The generic `api.ts` client accepts type parameters:

```tsx
import type { Invoice } from '../types/invoice';

const { data } = await api.list<Invoice>('/invoices'); // data: Invoice[]
const item = await api.get<Invoice>('/invoices', id); // item: Invoice
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

**Field privacy** — Sensitive columns (`password_hash`, `secret`, `api_key`, `mfa_secret`, etc.) are automatically stripped from API responses and `/_meta` via a built-in baseline. Add project-specific hidden fields per entity (`__hidden_fields__` in FastAPI, `hiddenFields` in Fastify). Mark entire entities as `__private__` / `private: true` to hide them from the API entirely — no routes registered, not listed in `/_meta`. The `/_meta` endpoint requires authentication on both backends.

**Frontend** — Fetches metadata from `GET /api/v1/_meta`, renders table + form UI automatically. Customize with overrides.

**Mobile** — Same metadata endpoint, generates list/detail/form screens. Offline-first with local DB and sync queue.

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

## Try it now

You're still reading. Stop reading. Run this:

```bash
npx create-projx my-app
```

Pick whatever you need from the menu — backend-only, AI app, mobile, full-stack, just infra. 30 seconds. Free. No signup. If you don't like it, `rm -rf my-app` and we never speak of this again.

---

## Badge

Add this to your project's README:

```md
[![Built with Projx](https://img.shields.io/badge/Built%20with-Projx-blue)](https://github.com/ukanhaupa/projx)
```

---

## License

MIT
