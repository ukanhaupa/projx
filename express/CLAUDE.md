# express — Express / TypeScript backend (projx template)

> Stack-scoped notes. The root [`../CLAUDE.md`](../CLAUDE.md) carries cross-cutting standards — read both, they compose.
>
> This directory is a **projx template**: a working backend whose own suite must stay green on the projx repo (root §"Per-template gates") **and** the source the CLI copies into scaffolded projects. It mirrors `fastify/` feature-for-feature with Express idioms — keep the two in sync when changing the shared `_base` machinery.

## Stack

- **Runtime** — Node (ESM), `tsx` dev, `tsc` build
- **Framework** — Express 5
- **Validation** — `zod`
- **ORM / DB** — Prisma + Postgres (default ORM; alternates via `addons/orms/<orm>/`)
- **Auth** — JWT via `jose` + `jsonwebtoken` (`src/lib/jwt-verifier.ts`, `src/middlewares/authenticate.ts`)
- **Package manager** — pnpm
- **Test** — Vitest + `supertest` against **real Postgres** (`tests/global-setup.ts`), v8 coverage
- **Logging** — `pino-http`, `request_id` correlation

## Layout

| Path                      | What it holds                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/server.ts`           | Entry: build app, listen                                                                                          |
| `src/app.ts`              | `buildApp(options)` — middleware chain (below)                                                                    |
| `src/config.ts`           | Env loading + `allowedOrigins()` (bootstrap-only)                                                                 |
| `src/errors.ts`           | `ApiError`, `errorHandler`, `notFoundHandler`                                                                     |
| `src/prisma.ts`           | Prisma client + `PrismaLike` type                                                                                 |
| `src/lib/`                | `crypto.ts`, `jwt-verifier.ts`, `prisma-client.ts`, `service-config.ts`                                           |
| `src/middlewares/`        | `authenticate.ts`, `authz.ts`                                                                                     |
| `src/modules/_base/`      | `entity-registry.ts`, `auto-routes.ts`, `query-engine.ts`, `repository.ts`, `service.ts`, `expand.ts`, `index.ts` |
| `src/modules/audit-logs/` | Audit-log module                                                                                                  |
| `prisma/schema.prisma`    | `ServiceConfig` + `AuditLog` + `// projx-anchor: models`                                                          |
| `tests/`                  | `global-setup.ts`, `helpers/`, `lib/`, `middlewares/`, `modules/`                                                 |

## Middleware chain — order matters, error handler last

`buildApp()` in `src/app.ts` (verified):

```
requestId → pinoHttp → helmet → cors → compression →
express.json/urlencoded (1mb) → rateLimit → authenticate →
[// projx-anchor: plugins] → GET /api/health →
entity routes (registerEntityRoutes per EntityRegistry) →
notFoundHandler → errorHandler
```

`errorHandler` + `notFoundHandler` register **last** (Express requires error middleware last). New middleware slots at the `plugins` anchor.

## Error shape — `{ detail, request_id }`

`src/errors.ts` `errorHandler` emits `{ detail, request_id }` where `request_id = res.locals.requestId` (set by the `requestId` middleware). **Never** `res.status(n).json({ detail })` outside the handler — you'll drop `request_id`.

## EntityRegistry + lifecycle hooks

Same contract as `fastify/`: modules self-register; `registerEntityRoutes` mounts CRUD (pagination, equality filter, `ILIKE` search, `order_by` `-` desc, bulk). Hooks `beforeCreate` / `afterCreate` / `beforeUpdate` / `afterUpdate` / `beforeDelete` + `beforeCreateFields[]` (coverage-checked). Contract documented once in root §"Entity lifecycle hooks" — adapter types are `Request`/`Response` here.

## DB-backed config / rate-limits / anchors

- Runtime creds in the encrypted `service_configs` table via `src/lib/service-config.ts` — env is bootstrap-only.
- `express-rate-limit` is global defense-in-depth; IP-keyed limits belong at the nginx edge, not per-route.
- Anchors: `src/app.ts` `// projx-anchor: imports` + `// projx-anchor: plugins`; `prisma/schema.prisma` `// projx-anchor: models`.

## Migrations

Ships `schema.prisma` only — `prisma/migrations/` carries just `migration_lock.toml`. Users generate the first migration on setup. Never pre-bake migrations.

## Quality gates (root §"Per-template gates")

`pnpm format` → `pnpm lint` → `pnpm typecheck` → `pnpm test` (vitest + supertest, **real Postgres**, v8 ≥80%). Green or not done; no `src/` excludes, no `it.skip`.
