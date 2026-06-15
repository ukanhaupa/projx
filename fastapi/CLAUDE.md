# fastapi — FastAPI / Python service (projx template)

> Stack-scoped notes. The root [`../CLAUDE.md`](../CLAUDE.md) carries cross-cutting standards — read both, they compose.
>
> This directory is a **projx template**: a working service whose own suite must stay green on the projx repo (root §"Per-template gates") **and** the source the CLI copies into scaffolded projects.

## Stack

- **Runtime** — Python `>3.10,<3.13` (mypy targets 3.12)
- **Framework** — FastAPI + Pydantic v2
- **ORM / DB** — SQLAlchemy 2.0 async + Postgres
- **Migrations** — Alembic
- **Auth** — JWT (`src/configs/_auth.py`, `src/middlewares/_authn.py`)
- **Package manager** — uv (never pip / poetry)
- **Lint / format** — ruff; **type** — mypy; **test** — pytest + pytest-asyncio + pytest-cov

## Layout

| Path                                       | What it holds                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `main.py`                                  | Uvicorn entry; imports `src.app`                                                                              |
| `migrate.py`, `alembic.ini`                | Migration runner + Alembic config                                                                             |
| `scaffold.py`, `test.py`, `audit.sh`       | Dev helpers (scaffold entity, test runner, dep audit)                                                         |
| `src/app.py`                               | App factory: middleware mount order, exception-handler registration, `api_router`, `GET /api/health`          |
| `src/exception_handlers.py`                | Centralized exception → HTTP mapping; `_body()` builds `{ detail, request_id? }`                              |
| `src/configs/`                             | `_database.py` (`DatabaseConfig` session factory), `_auth.py`                                                 |
| `src/middlewares/`                         | `_request_id`, `_authn`, `_authz`, `_user_context`, `_permission_resolvers`, `_public_paths`                  |
| `src/entities/base/`                       | `_repository`, `_service`, `_controller`, `_model`, `_auto_schema`, `_registry` (`EntityRegistry`), `_expand` |
| `src/entities/{audit_log,service_config}/` | Built-in entities                                                                                             |
| `src/utils/`                               | `_crypto.py`, `_safe_sync.py`                                                                                 |
| `src/migrations/`                          | Alembic env + `versions/`                                                                                     |
| `tests/`                                   | Flat `test_*.py` + `conftest.py` (real Postgres)                                                              |

## Module conventions — enforced, not optional

- **Private files use `_` prefix.** Public surface is whatever the package `__init__.py` re-exports.
- **Across packages, import from the package, never the private file** — `from src.entities.service_config import ...`, never `from src.entities.service_config._model import ...`. CI **and** the pre-commit hook grep-enforce this (root §"Private module imports"); a hit blocks the commit.

## Repository owns the session — no `session:` parameter anywhere

The session lifecycle is owned by the repo. **No route / service / helper / sibling repo takes `session: AsyncSession` as a param.** Sessions open inside the repo method (`DatabaseConfig.get_session()`), do DB work only, and close on block exit — no S3/LLM/httpx/sleep awaits inside a session block. The `.ai/hooks/post-edit-session-discipline.py` PostToolUse hook enforces both rules; a finding is a real violation, not a false positive.

## Error shape — `{ detail, request_id }`

`src/exception_handlers.py` `_body(detail, request)` returns `{ "detail": detail, "request_id"? }` (`request_id` from `request.state.request_id`). Order of handlers matters — `IntegrityError` (409) is caught before generic `SQLAlchemyError` (400). Never `try/except` in routes; raise and let the registered handlers map. Pydantic body schemas use `extra="forbid"`.

## Middleware order

`src/app.py` mounts: `RequestID → Authn → Authz` (+ `user_context` / `permission_resolvers`). Public (no-auth) paths are declared in `src/middlewares/_public_paths.py`, not opted into per route.

## EntityRegistry — routes aren't hand-written

`src/entities/__init__.py` imports each entity package and exposes `api_router` via `EntityRegistry.create_router()`. Adding an entity = create `src/entities/<name>/` (`_model.py` + `_repository.py`) and import it — no `app.py` edit, no per-entity router.

## Migrations — ships env + one bootstrap migration

Unlike the Node templates, this one **ships a single initial migration** — `src/migrations/versions/0af612617347_init_template_with_auto_audit_logging.py` — which sets up the auto audit-logging trigger that can't live in models alone. Further migrations are user-generated on setup. Don't edit historical migrations.

## Quality gates (root §"Per-template gates")

`uv run ruff format .` → `uv run ruff check .` → `uv run mypy src/` → `uv run pytest` (`--cov=src --cov-fail-under=80`, real Postgres). Coverage is enforced inline; no `# pragma: no cover` on production code, no skips.
