# go — Go / Chi backend (projx template)

> Stack-scoped notes. The root [`../CLAUDE.md`](../CLAUDE.md) carries cross-cutting standards — read both, they compose.
>
> This directory is a **projx template**: a working backend whose own suite must stay green on the projx repo (root §"Per-template gates") **and** the source the CLI copies into scaffolded projects. It ships the same runtime surface as `fastify/`/`express/` (auto-CRUD, request_id envelope, soft-delete, lifecycle hooks) with Go idioms.

## Stack

- **Language** — Go (module `projx.local/go`; real module path is rewritten at scaffold time)
- **Router** — Chi (`github.com/go-chi/chi/v5`)
- **ORM / DB** — GORM + Postgres (default; alternates `sqlc`, `ent` via `addons/orms/<orm>/`)
- **Auth** — JWT verifier (HS256 shared-secret / RS256 JWKS), `internal/auth`
- **Config** — DB-backed encrypted `service_configs` (`internal/serviceconfig`), env bootstrap-only
- **Test** — `go test -race` + `sqlmock` for unit, real Postgres behind `testing.Short()` for integration
- **Logging** — `log/slog` JSON + access-log middleware, `request_id` correlation

## Layout

| Path                                                            | What it holds                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `main.go`                                                       | Chi server boot; middleware order `requestid → logging → cors → recoverer`; 4 anchors  |
| `internal/apperr/`                                              | `AppError` types + middleware: `{detail, request_id}` envelope, `FromDB` pg→status     |
| `internal/auth/`                                                | `verifier.go` (alg-confusion-guarded), `middleware.go` (Authenticate / AuthzRequire\*) |
| `internal/cors/`                                                | CORS middleware, `CORS_ALLOW_ORIGINS`                                                  |
| `internal/serviceconfig/`                                       | AES-256-GCM reader, cross-language wire-format (`iv‖tag‖ct`), 10-min TTL cache         |
| `internal/ratelimit/`                                           | Per-user token bucket + `X-RateLimit-*` / `Retry-After` headers (NOT IP-keyed)         |
| `internal/entities/`                                            | `types.go`, `registry.go`, `auto_routes.go`, `query.go`, `reflectutil.go`              |
| `internal/posts/`                                               | Example `Post` entity using the registry                                               |
| `internal/sync/`                                                | `/api/v1/_meta/schemas` emitter (GORM schema parse, hidden-field filtering)            |
| `internal/{db,health,httputil,envutil,logging,requestid,uuid}/` | Connection pool, health probes, helpers                                                |
| `scripts/check-coverage.sh`                                     | Coverage gate (≥80%)                                                                   |

## Anchors

`main.go` carries `// projx-anchor:` markers — `imports`, `entity-imports`, `entity-registrations`, `plugins`. `gen entity` and `--auth=go` insert relative to these; keep them stable and at matching positions to `fastify`/`express`.

## ORM addons

GORM is the base. `sqlc` + `ent` live at [`../addons/orms/<orm>/`](../addons/orms/). Shared adapter machinery (auto_routes, apperr) is deduped under [`../addons/orms/_shared/`](../addons/orms/_shared/). All three preserve the same auto-route contract (pagination, equality filter, ILIKE search, `order_by` with `-` desc, bulk ops, lifecycle hooks). `BulkDelete` returns `(affected, error)` so the handler maps 0-affected → 404.

## Quality gates (root §"Per-template gates")

`gofmt -l .` (clean) → `golangci-lint run ./...` (incl. goimports; `go vet` runs inside) → `go test -race -coverprofile=coverage.out ./...` → `bash scripts/check-coverage.sh` (≥80%) → `govulncheck ./...`. Green or not done. Locally: `bash ../scripts/ci-local.sh go`.

## Things that bite

- **Module path** is `projx.local/go` in the template but rewritten to the user's module at scaffold time — `gen entity` reads it from `go.mod`, never hardcode it.
- **`ent` needs `go generate ./ent/...` then `go mod tidy`** before build (schema-as-code emits the client). `setup.sh` does this; CI has a drift gate.
- **`internal/auth` is not mounted globally** — it's reserved for `--auth=go` to mount per-router. The base only constructs the verifier when `JWT_*` env is set.
- **Runtime creds are DB-backed** (`service_configs`), env is bootstrap-only — never read `JWT_SECRET` at request time, go through `serviceconfig`.
