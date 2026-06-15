# sqlc ORM addon (Go)

Adapts the projx Go template to use `sqlc` + `database/sql` instead of GORM.

## How it differs from GORM

sqlc is a code generator — there is no runtime reflection. Each entity ships
SQL queries in `*.sql` (compiled by `sqlc generate`) and a hand-written
`Querier` adapter that implements the `entities.Querier` interface used by
`auto_routes.go`. The CLI's `gen entity` writes the SQL file, the adapter, and
wires it into `main.go` at the two anchors.

## What is preserved

- `GET /api/v1/<resource>` with `page`, `page_size`, `order_by` (use `-col` for
  desc), and equality filters on declared columns.
- `GET/POST/PATCH/DELETE` on `/{id}`, plus `POST /bulk` and `DELETE /bulk`.
- Soft delete via `deleted_at IS NULL`; `include_deleted=true` to bypass.
- Error envelope `{ detail, request_id }` (via `apperr.H` and `requestid`).
- Lifecycle hooks: `BeforeCreate`, `AfterCreate`, `BeforeUpdate`, `AfterUpdate`,
  `BeforeDelete` with the same failure semantics as GORM.
- `BeforeCreateFields` coverage check at `entities.Register` time.
- Hidden fields stripped from update patches.

## What had to be approximated

- **ILIKE search across all `SearchableFields`** — GORM iterates declared
  fields with reflection. sqlc has no reflection so each entity's adapter
  hard-codes the `OR ... ILIKE ...` clauses for its searchable columns. The
  CLI generator writes these from the field list at `gen entity` time.
- **Equality filtering on arbitrary columns** — same constraint: each
  adapter explicitly lists the columns it accepts as filters. Unknown filter
  keys are ignored (same outcome as GORM, different mechanism).
- **Schema-driven update patch validation** — replaced with a static
  `UpdatableColumns` list on `EntityConfig`. Hidden / immutable / unknown
  keys are stripped before the SQL UPDATE.
- **AutoMigrate** — gone. Migrations live under `migrations/` and run via
  `golang-migrate` (`scripts/db-sync.sh`).
- **Sync schemas endpoint** — `/api/v1/_meta/schemas` still works but its
  field types come from the declared `Columns` slice instead of reflected Go
  struct tags. JSON/DB names are assumed identical (snake_case throughout).

## Local workflow

```bash
# 1. Author your entity (or use `projx gen entity Foo`)
# 2. Generate Go from SQL
sqlc generate
# 3. Apply migrations
DATABASE_URL=postgres://... ./scripts/db-sync.sh
# 4. Build & run
go run .
```

## Required tooling

- `sqlc` >= 1.27 (`go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest`)
- `migrate` (`go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest`)
