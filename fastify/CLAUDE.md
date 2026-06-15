# fastify — Fastify / TypeScript backend (projx template)

> Stack-scoped notes. The root [`../CLAUDE.md`](../CLAUDE.md) carries cross-cutting standards (template engine, ORM addons, conventions, gates) — read both, they compose.
>
> This directory is a **projx template**: it is a working backend whose own suite must stay green on the projx repo (root §"Per-template gates") **and** the source the CLI copies into scaffolded projects. Edits here ship to every new project.

## Stack

- **Runtime** — Node (ESM), `tsx` for dev, `tsc` for build
- **Framework** — Fastify 5
- **Validation** — `@sinclair/typebox`
- **ORM / DB** — Prisma + Postgres (default ORM; Drizzle / Sequelize / TypeORM come via `addons/orms/<orm>/` overlays — see root)
- **Auth** — JWT verified via `jose` (`src/lib/jwt-verifier.ts`) + `@fastify/jwt`
- **Package manager** — pnpm
- **Test** — Vitest against **real Postgres** (`tests/global-setup.ts`), v8 coverage
- **Logging** — Fastify/pino logger, `request_id` correlation; `pino-pretty` in dev

The base template has **no** multipart, S3, queue, mailer, or tenant plugin — don't document features that aren't here. Those arrive via feature overlays (`features/`) when enabled.

## Layout

| Path                            | What it holds                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/server.ts`                 | Entry: build app, listen, graceful shutdown (`lib/shutdown.ts`)                                                                            |
| `src/app.ts`                    | `buildApp()` — plugin registration in load-bearing order (below)                                                                           |
| `src/config.ts`                 | Env loading (bootstrap-only)                                                                                                               |
| `src/errors.ts`                 | Domain error classes                                                                                                                       |
| `src/lib/`                      | `crypto.ts` (config encryption), `jwt-verifier.ts`, `prisma-client.ts`, `service-config.ts`, `shutdown.ts`                                 |
| `src/plugins/`                  | `auth`, `authz`, `error-handler`, `prisma`, `public-paths`, `request-id`, `swagger`                                                        |
| `src/modules/_base/`            | `entity-registry.ts`, `auto-routes.ts`, `query-engine.ts`, `repository.ts`, `service.ts`, `expand.ts`, `index.ts` — generic CRUD machinery |
| `src/modules/audit-logs/`       | Audit-log module                                                                                                                           |
| `src/decorators/`, `src/hooks/` | Extension points (`.gitkeep`)                                                                                                              |
| `prisma/schema.prisma`          | `ServiceConfig` + `AuditLog` models + `// projx-anchor: models`                                                                            |
| `tests/`                        | `global-setup.ts`, `helpers/`, `lib/`, `modules/`, `plugins/` — unit + integration in one tree                                             |

## Plugin order — load-bearing, don't rearrange

`buildApp()` in `src/app.ts` registers in this exact order (verified):

```
helmet → cors → rateLimit → swagger → prisma → error-handler →
request-id → auth → authz → [// projx-anchor: plugins] →
GET /api/health → entity routes (registerEntityRoutes via EntityRegistry)
```

`error-handler` before `request-id`/`auth` so auth failures map consistently; `auth` before `authz`. New plugins slot at the `plugins` anchor, not appended blindly.

## Error shape — `{ detail, request_id }`

Centralized in `src/plugins/error-handler.ts`. Every error response is `{ detail, request_id }` (`request_id` = `request.id`). Maps Prisma `P2002`→409, `P2003`→409, `P2025`→404, `NotFoundError`→404, validation→422/400, else 500. **Never** inline `reply.status(n).send({ detail })` without going through the handler — you'll drop `request_id` (mobile parses it into `AppException.requestId`).

## EntityRegistry + lifecycle hooks

Modules self-register via `EntityRegistry`; `registerEntityRoutes` mounts CRUD (pagination, equality filter, `ILIKE` search, `order_by` with `-` desc prefix, bulk ops). Optional hooks on `EntityConfig`: `beforeCreate` / `afterCreate` / `beforeUpdate` / `afterUpdate` / `beforeDelete`, plus `beforeCreateFields[]` enforced by `validateCreateCoverage()` at registration. Hook contract + failure modes are documented once in root §"Entity lifecycle hooks" — don't duplicate; honor it.

## DB-backed runtime config

`JWT_SECRET`, SMTP, service configs live in the encrypted `service_configs` table, read via `src/lib/service-config.ts` (`src/lib/crypto.ts` encrypts). Env vars are **bootstrap-only** (`CRED_ENCRYPTION_KEY`). See root §"Runtime config is DB-backed".

## Rate-limits — edge, not app

Global `@fastify/rate-limit` is defense-in-depth — leave it. IP-keyed limits live in nginx; **never** add per-route `config: { rateLimit }`. Per-user/tenant business limits (which need JWT/DB) may stay in app.

## Anchors

`src/app.ts`: `// projx-anchor: imports`, `// projx-anchor: plugins`. `prisma/schema.prisma`: `// projx-anchor: models`. Feature patches and `gen` insert relative to these — keep them stable.

## Migrations

Ships `schema.prisma` only — `prisma/migrations/` carries just `migration_lock.toml`; users generate the first migration on setup (`setup.sh` bootstraps it when `DATABASE_URL` is set). Never pre-bake migrations. `tests/helpers/migration-checksum.ts` guards schema↔migration drift.

## Quality gates (root §"Per-template gates")

`pnpm format` (prettier) → `pnpm lint` (eslint) → `pnpm typecheck` (`tsc --noEmit`) → `pnpm test` (vitest, **real Postgres**, v8 ≥80%). All must be green; no `src/` coverage excludes, no `it.skip`.

## Things that bite

- Tests need a live Postgres — `tests/global-setup.ts` provisions it; a missing `DATABASE_URL` fails the suite, not skips it.
- `pnpm exec` after a pipe masks exit codes — use `${PIPESTATUS[0]}`.
