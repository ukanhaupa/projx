# rust — Rust / Axum backend (projx template)

> Stack-scoped notes. The root [`../CLAUDE.md`](../CLAUDE.md) carries cross-cutting standards — read both, they compose.
>
> This directory is a **projx template**: a working backend whose own suite must stay green on the projx repo (root §"Per-template gates") **and** the source the CLI copies into scaffolded projects. Same runtime surface as the sibling backends (auto-CRUD, `{detail, request_id}` envelope, soft-delete, lifecycle hooks) with async-Rust idioms.

## Stack

- **Language** — Rust (stable toolchain pinned in `rust-toolchain.toml`)
- **HTTP** — Axum + Tower / tower-http middleware
- **ORM / DB** — SeaORM + Postgres (`seaorm` is the canonical Rust ORM)
- **Auth** — JWT verifier (HS256 / RS256 JWKS), alg-confusion-guarded, `src/auth/`
- **Config** — DB-backed encrypted `service_configs` (`src/serviceconfig.rs`), env bootstrap-only
- **Errors** — `thiserror` `AppError` + `IntoResponse`; never panic in the request path
- **Logging** — `tracing` JSON; `request_id` via a tokio `task_local!`

## Layout

| Path                   | What it holds                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `src/main.rs`          | Tokio boot, `build_router`, graceful shutdown; `// projx-anchor:` markers                  |
| `src/error.rs`         | `AppError` enum + `IntoResponse` → `{detail, request_id}` envelope                         |
| `src/apperr.rs`        | `from_db` shim (sqlx/SeaORM error → status), re-exports `AppError`                         |
| `src/middleware/`      | `request_id.rs` (task-local), `logging.rs`, `cors.rs`, `recover.rs` (catch-panic)          |
| `src/auth/`            | `verifier.rs` (alg-allowlist), `middleware.rs` (Authenticate / Authz extractors)           |
| `src/serviceconfig.rs` | AES-256-GCM, cross-language wire-format (`iv‖tag‖ct`), TTL cache, NIST GCM TC13 test       |
| `src/ratelimit.rs`     | Per-user token bucket + `X-RateLimit-*` / `Retry-After` (NOT IP-keyed)                     |
| `src/entities/`        | `types.rs` (EntityHandler trait, object-safe), `registry.rs`, `auto_routes.rs`, `query.rs` |
| `src/posts/mod.rs`     | Example `Post` entity (SeaORM `EntityHandler` impl)                                        |
| `src/sync.rs`          | `/api/v1/_meta/schemas` emitter                                                            |
| `src/util/`            | `env.rs`, `httputil.rs`, `uuid_v4.rs`                                                      |

## Anchors

`main.rs` carries `// projx-anchor:` markers — `imports`, `entity-imports`, `entity-registrations`, `plugins` (inside `build_router`, before `.layer(stack)`). Keep them at matching positions to the sibling backends.

## Quality gates (root §"Per-template gates")

`cargo fmt --check` → `cargo clippy --all-features -- -D warnings` (tests count) → `cargo check --all-features` → `cargo test --all-features` → `cargo tarpaulin --fail-under 80 --workspace --all-features` (≥80%). Locally `bash ../scripts/ci-local.sh rust` runs fmt/clippy/test (and skips cleanly when `cargo` is absent).

## Things that bite

- **`sea_orm::DatabaseConnection` is not `Clone`** — Axum `State` that holds it must wrap it in `Arc<DatabaseConnection>` (see `EntityState` in `src/entities/auto_routes.rs`).
- **Import `AppError` from `crate::error`**, not via `crate::entities::types` (that's a private `use`, re-exporting it triggers E0603 in tests).
- **`jsonwebtoken` has a default 60s exp leeway** — an expired-token test must use a clearly-past offset (e.g. `-120s`), not `-60s`.
- **Toolchain**: `rust-toolchain.toml` pins `stable`; some transitive crates require a recent edition/rustc — bump the channel rather than pinning old deps.
- **Module path** is rewritten to the project's Cargo package name at scaffold time — `gen entity` reads it from `Cargo.toml`.
- **Runtime creds are DB-backed** (`service_configs`); env is bootstrap-only.
