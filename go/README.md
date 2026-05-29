# Go backend template

Chi + GORM service template for projx. Ships an entity registry, central error handler, request-id propagation, soft-delete, pagination, search, and the lifecycle-hook contract that matches the Node and Python templates.

## Run

```bash
cp .env.example .env
# point DATABASE_URL at a running Postgres
go run .
```

The server listens on `PORT` (default 8080) and AutoMigrates the example `Post` entity on startup.

## Test

```bash
go test ./...
# coverage gate (>= 80%):
go test -coverprofile=coverage.out ./...
bash scripts/check-coverage.sh
```

Integration tests skip when `DATABASE_URL` is unset.

## Architecture

- **Router**: Chi, mounted in `main.go`. Middleware order: `request_id -> logger -> recoverer`.
- **ORM**: GORM with the Postgres driver; pool lives in `internal/db`.
- **Entities**: declare an `entities.EntityConfig` per resource and `Register` it; `MountEntity` wires CRUD + bulk routes off `BasePath`. Same hook contract as the other backends (`BeforeCreate`, `AfterCreate`, `BeforeUpdate`, `AfterUpdate`, `BeforeDelete`); `Before*` errors abort, `After*` are best-effort.
- **Errors**: handlers return typed `apperr` values; one adapter (`apperr.H`) maps them to `{detail, request_id}` JSON envelopes with the right status code.
- **Logging**: stdlib `log/slog` with JSON output; level from `LOG_LEVEL`.

## Scope

This is the M1 spike for Go support in projx (issue #50). Base template only, no auth feature, no `service_configs` table, no CLI/CI wiring. Those land in follow-up commits.
