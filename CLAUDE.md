# CLAUDE.md

Working notes for Claude when editing this repo. The repo is **projx**, a CLI that scaffolds production-ready full-stack projects.

## What's in here

The repo is two things at once:

1. **The CLI source** — under [cli/](cli/). Published to npm as `create-projx`.
2. **The templates the CLI ships** — every other top-level directory is a template that gets copied into the user's new project.

Top-level layout:

```
cli/         create-projx CLI source (TypeScript, ESM, tsup build, vitest)
fastify/     Fastify + Prisma backend template
fastapi/     FastAPI + SQLAlchemy + Alembic backend template
frontend/    React + Vite frontend template
mobile/      Flutter app template
e2e/         Playwright E2E template
infra/       Terraform IaC template
features/    Opt-in feature overlays applied via --<feature>=<targets> (e.g. --auth=fastify)
docs/        Design docs (feature templates, etc.)
scripts/     Static scripts copied into scaffolded projects
.githooks/   Pre-commit hooks for the projx repo itself
```

The CLI fetches the whole repo (or uses `--local <path>`) and copies the component directories into the user's project. Shared scaffolding files (CI yaml, README, docker-compose, pre-commit, setup.sh) live in [cli/src/templates/](cli/src/templates/) as `.ejs` files rendered at scaffold time by the hand-rolled engine in [cli/src/utils.ts](cli/src/utils.ts).

## Hand-rolled template engine

The EJS-like engine in [cli/src/utils.ts](cli/src/utils.ts) (`render`) supports `<% if %>`, `<% for %>`, `<%= expr %>`. It is intentionally minimal — do not introduce a dep on real EJS. Shared template vars:

- `projectName`, `components`, `paths`, `pm` (package-manager commands)
- `fastapiInstances`, `fastifyInstances`, `frontendInstances`, `mobileInstances`, `e2eInstances`, `infraInstances` — all enriched with `path`, `upper`, `display`

Multi-instance support: a project can have N fastify instances at different paths. Generators iterate the `*Instances` arrays.

## Commands

The CLI has these subcommands (see [cli/src/index.ts](cli/src/index.ts) `parseArgs`):

- `create` (default) — scaffold a new project
- `update` — pull latest template changes into an existing project
- `add` — add components to an existing project
- `init` — adopt an existing project
- `pin` / `unpin` — protect files from `update`
- `diff` — preview `update` changes
- `doctor` — health-check a project
- `gen` — entity generators
- `sync` — pull types from a running backend

Feature flags: `--<feature>=<component>[:<instance>][,...]`. Only `--auth` is implemented today; see [docs/feature-templates.md](docs/feature-templates.md) for the standard. Known features live in `KNOWN_FEATURES` in [cli/src/utils.ts](cli/src/utils.ts).

## Local development loop

```bash
# Build the CLI
pnpm --dir cli build

# Run quality gates
pnpm --dir cli exec tsc --noEmit
pnpm --dir cli exec eslint src/ tests/
pnpm --dir cli test

# Scaffold a project with the local templates (do not skip --local during dev)
node cli/dist/index.js my-app --components fastify --no-install --no-git --local "$(pwd)"
```

`pnpm --dir cli test` runs vitest with v8 coverage. The 80% threshold (statements/branches/functions/lines) is enforced — see [cli/vitest.config.ts](cli/vitest.config.ts).

## Per-template gates

Each template has its own test suite that must stay green on the projx repo itself (not just in scaffolded projects):

| Template    | Format      | Lint                         | Typecheck      | Test                   | Coverage                                                           |
| ----------- | ----------- | ---------------------------- | -------------- | ---------------------- | ------------------------------------------------------------------ |
| `cli/`      | prettier    | eslint                       | `tsc --noEmit` | vitest                 | v8 ≥80%                                                            |
| `fastify/`  | prettier    | eslint                       | `tsc --noEmit` | vitest (real Postgres) | v8 ≥80%                                                            |
| `express/`  | prettier    | eslint                       | `tsc --noEmit` | vitest (real Postgres) | v8 ≥80%                                                            |
| `fastapi/`  | ruff format | ruff check                   | mypy           | pytest                 | pytest-cov ≥80%                                                    |
| `frontend/` | prettier    | eslint                       | `tsc --noEmit` | vitest                 | v8 ≥80%                                                            |
| `mobile/`   | dart format | `dart analyze --fatal-infos` | (in analyze)   | flutter test           | [scripts/check-coverage.sh](mobile/scripts/check-coverage.sh) ≥80% |
| `e2e/`      | prettier    | eslint                       | `tsc --noEmit` | n/a                    | n/a                                                                |

CI runs all of these — see [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Pre-commit hooks

[.githooks/pre-commit](.githooks/pre-commit) runs format + lint + typecheck on staged files per template. It does NOT run the full test suite. The template counterpart that scaffolded projects inherit is [cli/src/templates/pre-commit.ejs](cli/src/templates/pre-commit.ejs) — keep both in sync when adding gates.

CLI block scopes by `^cli/.*\.ts$` (including tests). FastAPI block enforces the private cross-module import rule and runs `lint-imports`.

## Conventions

### Templates ship schema, not migrations

Pre-baked Prisma or Alembic migrations do not belong in the templates. The schema files (`schema.prisma`, alembic env) ship; users generate their own migrations on first setup (`setup.sh` bootstraps the initial migration when `DATABASE_URL` is set). This applies template-wide and to features.

### Error handling is centralized

Both backends use a single global error handler that emits `{ detail, request_id }`. See:

- [fastify/src/plugins/error-handler.ts](fastify/src/plugins/error-handler.ts)
- [fastapi/src/exception_handlers.py](fastapi/src/exception_handlers.py)

Routes throw typed errors; handlers map them. Do NOT add inline `reply.status(N).send({ detail })` without going through `err()` (or equivalent) that injects `request_id`. Mobile parses `request_id` into `AppException.requestId`.

### Runtime config is DB-backed

`JWT_SECRET`, SMTP creds, service configs, etc. live in the encrypted `service_configs` table, read via [fastify/src/lib/service-config.ts](fastify/src/lib/service-config.ts) and the FastAPI equivalent. Env vars are **bootstrap-only** (first run / `CRED_ENCRYPTION_KEY`).

### Private module imports

FastAPI: files inside `src/` cannot `from src.<pkg>._<file> import ...`. Import from the package's `__init__.py`. CI and pre-commit enforce this via grep. The base `_-prefixed` files are package-private.

### Entity lifecycle hooks (fastify + express)

Both Node backends' auto-routes honour optional hooks declared on `EntityConfig`:

- fastify — [fastify/src/modules/\_base/auto-routes.ts](fastify/src/modules/_base/auto-routes.ts) + [entity-registry.ts](fastify/src/modules/_base/entity-registry.ts)
- express — [express/src/modules/\_base/auto-routes.ts](express/src/modules/_base/auto-routes.ts) + [entity-registry.ts](express/src/modules/_base/entity-registry.ts)

Same contract on both, with adapter-specific request/response types (`FastifyRequest`/`FastifyReply` vs `Request`/`Response`):

| Hook           | Signature                          | When                                            | Failure mode                                  |
| -------------- | ---------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| `beforeCreate` | `(request, data) => void`          | Before `service.create`; mutate `data` in place | Throws → 500 (or your error class)            |
| `afterCreate`  | `(request, record) => void`        | After persist                                   | Best-effort — caught + logged, record stays   |
| `beforeUpdate` | `(request, reply, data) => void`   | After scope check, before `service.update`      | Send `reply` to short-circuit; throw to abort |
| `afterUpdate`  | `(request, before, after) => void` | After persist; `before` is pre-update snapshot  | Best-effort — caught + logged                 |
| `beforeDelete` | `(request, recordId) => void`      | Before `service.delete`                         | Throw to abort (no best-effort)               |

Use these for: audit logs, derived-field updates, cache invalidation, outbound webhooks, soft-validation that needs request context. Don't put load-bearing business logic in `after*` hooks — they're best-effort and can fail silently.

The `beforeCreate` hook has a sibling `beforeCreateFields: string[]` that lists which fields the hook will populate, so `validateCreateCoverage()` can enforce coverage at registration time. The other hooks have no equivalent — they don't change the persisted shape.

### Anchor comments

Base templates carry `// projx-anchor: imports`, `// projx-anchor: plugins`, `// projx-anchor: models` (in `fastify/prisma/schema.prisma`). Feature patches insert relative to these — keep them stable.

### No inline comments unless WHY is non-obvious

Strip docstrings, TODOs, and explainer comments from lifted code. Well-named identifiers carry the meaning. The only comments that belong are: a workaround for a specific bug, a subtle invariant, behaviour that would surprise a reader.

## Feature templates (opt-in modules)

The standard is in [docs/feature-templates.md](docs/feature-templates.md). Key points:

- A feature lives at `features/<name>/<stack>/{files,patches}/`.
- `feature.json` at `features/<name>/` declares `supports`, `env`, `requires`.
- Patches are JSON: `package-json` (object merge) or `text` (anchor-based insert). Apply mechanism is in [cli/src/features.ts](cli/src/features.ts), idempotent via sentinel comments.
- `applyFeatures` runs after the base copy in `scaffold.ts`.
- Currently shipped: `auth/fastify` (signup, login, MFA, password reset, sessions, refresh rotation with replay detection, email verification, mailer, cron-driven cleanup).

When adapting code from sister projects (docusift, ops-pilot, memoria), strip business specifics: tenant orchestration, billing plans, queue scheduling, grace windows, UTM tracking. Keep the security hardening: rotation, lockout, recovery codes, request_id propagation.

## Releasing

Versions live in [cli/package.json](cli/package.json). `prepublishOnly` builds. CI runs on push to `main`. Manual publish: `cd cli && npm publish`. CHANGELOG entry + version bump on the same commit.

## Common gotchas

- **`pnpm exec` after a pipe** — exit codes get masked by `tail`/`head`. Use `${PIPESTATUS[0]}` or no pipe when verifying success.
- **`vi.mock('@clack/prompts')` pollutes the module cache** across test files. Don't use it for the CLI; spy on `utilsModule` instead. See existing CLI test pattern.
- **Frontend tests live in `tests/`, not `src/`.** Co-located tests under `src/` were migrated to fix [issue #12](https://github.com/ukanhaupa/projx/issues/12) — never re-introduce.
- **Worktree-isolated subagents do NOT carry uncommitted changes** from the main checkout. Either commit prereqs first or `cp` them into the worktree as step 0.
- **gitleaks** runs on CI for the projx repo. Test secrets in `.env.test` need an allowlist entry in `.gitleaks.toml`.
- **`prisma migrate dev` needs `DATABASE_URL`** when run via `setup.sh`. The bootstrap step skips silently if it's unset.
