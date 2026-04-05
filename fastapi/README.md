# Projx -- FastAPI Backend

FastAPI backend template with zero-boilerplate CRUD, auto-entity discovery, JWT authentication, role-based authorization, audit logging, and request-level log correlation.

Define a SQLAlchemy model, run a migration, and the system auto-generates typed REST endpoints with pagination, filtering, sorting, search, and foreign key expansion. No controller, service, or repository code required.

## Quick Start

Prerequisites: Python 3.11+ and [uv](https://docs.astral.sh/uv/).

```bash
cp .env.example .env          # configure database + auth
uv sync                       # install all dependencies (dev + test)
uv run main.py                # uvicorn with hot reload on port 7860
```

Or run uvicorn directly:

```bash
uv run uvicorn src.app:app --reload --port 7860
```

API docs: `http://localhost:7860/docs`
Health check: `GET /api/health` (returns app + database status)

## Project Structure

```
src/
├── app.py                    # FastAPI app, middleware stack, lifespan, health check
├── configs/
│   ├── _database.py          # Async SQLAlchemy engine + session with statement timeout
│   └── _auth.py              # JWT verification (shared_secret / public_key / jwks)
├── middlewares/
│   ├── _authn.py             # Authentication — JWT extraction + AUTH_ENABLED toggle
│   ├── _authz.py             # Authorization — permission checking + scope filters
│   ├── _permission_resolvers.py  # Pluggable permission extraction (default + Keycloak)
│   ├── _public_paths.py      # Routes exempt from auth
│   ├── _request_id.py        # X-Request-ID correlation (generate or pass through)
│   └── _user_context.py      # Request-scoped user context via contextvars
├── entities/
│   ├── base/                 # Base classes + auto-discovery system
│   │   ├── _model.py         # BaseModel_ with config attributes, SoftDeleteMixin
│   │   ├── _repository.py    # Generic CRUD repository with filter/coerce/search logic
│   │   ├── _service.py       # Service layer
│   │   ├── _controller.py    # BaseController — route handler with scope filters
│   │   ├── _auto_schema.py   # Runtime Pydantic schema generation from SQLAlchemy models
│   │   ├── _registry.py      # Entity auto-discovery + _AutoController with typed schemas
│   │   └── _expand.py        # Foreign key expansion resolver (batch loading)
│   ├── audit_log/            # Built-in audit logging entity (INSERT/UPDATE/DELETE)
│   │   └── _model.py         # AuditLog model + SQLAlchemy event listeners
│   └── <your_entity>/        # Each entity lives in its own directory
│       └── _model.py         # Only file required — endpoints are auto-generated
├── migrations/               # Alembic migrations
scaffold.py                   # Generate test + optional controller/model skeleton
migrate.py                    # Standalone migration runner (upgrade/downgrade)
main.py                       # Uvicorn entrypoint with reload
test.py                       # Pytest wrapper
```

## Auto-Entity Pattern

### Adding an Entity

Create a single file `src/entities/my_entity/_model.py`:

```python
from sqlalchemy import Column, String, Integer, Boolean, Text
from ..base._model import BaseModel_

class MyEntity(BaseModel_):
    __tablename__ = "my_entities"

    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    priority = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
```

Or scaffold it:

```bash
uv run scaffold.py my_entity --model    # generates starter _model.py
```

Then create and run a migration:

```bash
uv run alembic revision --autogenerate -m "add my_entity"
uv run migrate.py
```

On next startup, auto-discovery registers all routes:

- `POST /api/v1/my-entities/` -- create
- `GET /api/v1/my-entities/` -- list with pagination, search, filtering, sorting
- `GET /api/v1/my-entities/{id}` -- get by ID
- `PATCH /api/v1/my-entities/{id}` -- partial update
- `DELETE /api/v1/my-entities/{id}` -- delete
- `POST /api/v1/my-entities/bulk` -- bulk create
- `DELETE /api/v1/my-entities/bulk` -- bulk delete
- `GET /api/v1/_meta` -- entity metadata (authn-only, no authz)

No controller, service, or repository files needed. The registry auto-generates an `_AutoController` with typed Pydantic schemas derived from the SQLAlchemy model columns.

### Model Configuration

All configuration is done via class attributes on the model:

```python
class MyEntity(BaseModel_):
    __tablename__ = "my_entities"

    # Route config
    __api_prefix__ = "/my-entities"        # default: tablename with hyphens
    __api_tags__ = ["my-entities"]          # default: [api_prefix]
    __readonly__ = False                    # True = only GET endpoints (list + get)
    __soft_delete__ = False                 # True = soft delete via deleted_at timestamp
    __bulk_operations__ = True              # True = /bulk endpoints

    # Field config
    __searchable_fields__ = {"name"}        # full-text search fields (default: all String/Text columns)
    __hidden_fields__ = {"secret"}          # excluded from API responses
    __create_fields__ = {"name", "email"}   # allowed fields on POST (default: all non-auto)
    __update_fields__ = {"name"}            # allowed fields on PATCH (default: all non-auto)
```

Auto-managed fields excluded from create/update schemas: `id`, `created_at`, `updated_at`, `deleted_at`.

### Soft Delete

Add the mixin and set the flag:

```python
from ..base._model import BaseModel_, SoftDeleteMixin

class MyEntity(SoftDeleteMixin, BaseModel_):
    __tablename__ = "my_entities"
    __soft_delete__ = True
    # ...
```

`SoftDeleteMixin` adds a `deleted_at` column. Delete operations set `deleted_at` to the current UTC timestamp instead of removing the row. List and get queries automatically filter out soft-deleted records.

### Customizing an Entity

To override specific endpoints, create a `_controller.py` in the entity directory. The registry detects it automatically by finding a class named `{ModelName}Controller` that extends `BaseController`.

Generate a controller skeleton:

```bash
uv run scaffold.py my_entity --controller
```

This creates `src/entities/my_entity/_controller.py`:

```python
from fastapi import Body, Query, Request
from ..base import BaseController, BaseRepository, BaseService
from ._model import MyEntity

class MyEntityRepository(BaseRepository):
    def __init__(self):
        super().__init__(MyEntity)

class MyEntityService(BaseService):
    def __init__(self):
        super().__init__(MyEntityRepository)

class MyEntityController(BaseController):
    def __init__(self):
        super().__init__(MyEntityService)

    # Override any method: create, list, get, patch, delete
    # async def list(self, request: Request, page: int = Query(1, ge=1), ...):
    #     return await super().list(request, page, ...)
```

Only override the methods you need to change. The naming convention `{ModelName}Controller` is required for auto-detection.

## Authentication

JWT-based authentication with three provider modes:

| Provider        | Config                                       | Use Case                           |
| --------------- | -------------------------------------------- | ---------------------------------- |
| `shared_secret` | `JWT_SECRET`                                 | Development, simple setups         |
| `public_key`    | `JWT_PUBLIC_KEY` (PEM)                       | Static key verification            |
| `jwks`          | `JWT_JWKS_URL` or inferred from `JWT_ISSUER` | Keycloak, Auth0, any OIDC provider |

When `JWT_PROVIDER=auto` (default), the provider is inferred: JWKS URL present -> `jwks`, public key present -> `public_key`, otherwise -> `shared_secret`.

When `JWT_ISSUER` is set and no explicit `JWT_JWKS_URL` is provided, the JWKS URL is inferred as `<issuer>/protocol/openid-connect/certs` (Keycloak convention).

Set `AUTH_ENABLED=false` to disable authentication entirely. This injects a dev superuser with `*:*.*` permissions on every request.

### Permission Resolvers

Two built-in resolvers for extracting permissions from JWT payloads:

- **DefaultPermissionResolver** -- reads `permissions` field (list of strings)
- **KeycloakPermissionResolver** -- reads `permissions` + Keycloak-specific `resource_access` and `realm_access` role fields

## Permissions

Format: `<resource>:<action>.<scope>`

- **Resource**: table name with underscores (e.g. `my_entities`), or `*` for all
- **Actions**: `read`, `create`, `update`, `delete`, `*`
- **Scopes**: `one`, `all`, `*`
- **Examples**: `users:read.all`, `posts:create.one`, `*:*.*` (superadmin)

Permission resolution for a request:

| Request                        | Required Permission      |
| ------------------------------ | ------------------------ |
| `GET /api/v1/my-entities/`     | `my_entities:read.all`   |
| `GET /api/v1/my-entities/1`    | `my_entities:read.one`   |
| `POST /api/v1/my-entities/`    | `my_entities:create.one` |
| `PATCH /api/v1/my-entities/1`  | `my_entities:update.one` |
| `DELETE /api/v1/my-entities/1` | `my_entities:delete.one` |

Permissions are read from the JWT payload. Supported formats:

- `permissions` as a list of strings: `["my_entities:read.all", "my_entities:create.one"]`
- `permissions_map` as a resource-keyed map: `{"my_entities": ["read.all", "create.one"]}`

### Public and Auth-Only Paths

- **Public** (no auth): `/docs`, `/redoc`, `/openapi.json`, `/api/`, `/api/health`
- **Auth-only** (authn required, no authz): `/api/v1/_meta`
- **All other `/api/v1/` paths**: require both authentication and authorization

## Query Features

All list endpoints support:

| Parameter       | Example                    | Description                                                        |
| --------------- | -------------------------- | ------------------------------------------------------------------ |
| `page`          | `?page=2`                  | Page number (1-based)                                              |
| `page_size`     | `?page_size=25`            | Items per page (1-100)                                             |
| `order_by`      | `?order_by=-created_at`    | Sort (prefix `-` for descending)                                   |
| `search`        | `?search=john`             | Search across `__searchable_fields__` (or all String/Text columns) |
| `field=val`     | `?status=active`           | Exact match filter                                                 |
| `field__in`     | `?status__in=active,draft` | IN filter (comma-separated values)                                 |
| `field__gte`    | `?age__gte=18`             | Greater than or equal                                              |
| `field__lte`    | `?age__lte=65`             | Less than or equal                                                 |
| `field__gt`     | `?age__gt=18`              | Greater than                                                       |
| `field__lt`     | `?age__lt=65`              | Less than                                                          |
| `field__isnull` | `?email__isnull=true`      | Null check (`true`/`false`)                                        |
| `expand`        | `?expand=author`           | Expand foreign key relationships (batch loaded)                    |

Filter values are automatically coerced to the column's Python type (int, float, date, datetime, bool, JSON).

The `expand` parameter works on foreign key columns following the `_id` naming convention. For example, if a model has `author_id` referencing `users.id`, `?expand=author` inlines the full user object. Multiple expansions: `?expand=author,category`. Also works on the `get` endpoint.

## Audit Logging

The built-in `audit_log` entity automatically records all INSERT, UPDATE, and DELETE operations via SQLAlchemy session event listeners. Each audit record captures:

- `table_name` and `record_id` of the affected row
- `action` (INSERT, UPDATE, DELETE)
- `old_value` and `new_value` as JSON
- `performed_by` (user ID from the session context)
- `performed_at` timestamp

Audit logs are exposed as a read-only API at `GET /api/v1/audit-logs/` with search support on `table_name`, `record_id`, `performed_by`, and `action`.

To exclude a model from audit logging, set `__audit_ignore__ = True` on the model class.

## Testing

```bash
uv sync                         # includes test dependencies by default
uv run test.py                  # or: uv run pytest
uv run pytest -k test_my_thing  # run specific tests
```

Tests use in-memory SQLite (configured in `.env.test`). Coverage threshold is 80% (configured in `pyproject.toml`).

### Base Test Class

`BaseEntityApiTest` provides 11 reusable CRUD tests: create, list, get, update, delete, filtering, search, not-found, auth (missing Bearer prefix), delete-not-found, and validation.

```python
from src.entities.my_entity._model import MyEntity
from tests.base_entity_api_test import BaseEntityApiTest

class TestMyEntity(BaseEntityApiTest):
    __test__ = True
    endpoint = "/api/v1/my-entities/"
    create_payload = {"name": "Test", "priority": 1}
    update_payload = {"name": "Updated"}
    invalid_payload = {}
    filter_field = "name"
    filter_value = "alice"
    other_filter_value = "bob"

    def make_model(self, index: int, **overrides):
        data = {"name": f"item_{index}", "priority": index}
        data.update(overrides)
        return MyEntity(**data)
```

For read-only entities, set `allow_create = False`, `allow_update = False`, `allow_delete = False`.

### Assertion Hooks

Override these methods when you customize endpoint responses:

| Method                                  | Purpose                               |
| --------------------------------------- | ------------------------------------- |
| `assert_create_response(data, payload)` | Validate create response shape        |
| `assert_list_response(data)`            | Validate list response shape          |
| `assert_get_response(data, row)`        | Validate get response shape           |
| `assert_update_response(data, payload)` | Validate update response shape        |
| `build_create_payload()`                | Build create request body dynamically |
| `build_update_payload(row)`             | Build update request body dynamically |

### Scaffold Tests

Generate test files by introspecting the model:

```bash
uv run scaffold.py my_entity              # generate test file
uv run scaffold.py my_entity --controller # generate test + controller skeleton
uv run scaffold.py my_entity --model      # generate starter model (new entity)
```

### Coverage Safety Net

`tests/test_entity_coverage.py` ensures every entity directory (containing a `_model.py`) has a corresponding test file. If this test fails, run:

```bash
uv run scaffold.py <entity_name>
```

## Middleware Stack

Middleware executes in reverse registration order (outermost first):

1. **CORS** -- standard FastAPI CORS handling
2. **RequestIDMiddleware** -- reads `X-Request-ID` header or generates a 16-char hex ID; attaches to response and binds to loguru for log correlation
3. **AuthenticationMiddleware** -- extracts and validates JWT Bearer token; when `AUTH_ENABLED=false`, injects a dev superuser with `*:*.*` permissions
4. **AuthorizationMiddleware** -- checks permissions against the required `resource:action.scope` pattern

Log format includes the request ID for correlation:

```
2026-01-01 12:00:00 | INFO     | a1b2c3d4e5f6 | src.app:check_health:100 - ...
```

To correlate logs across services, pass your own `X-Request-ID` header in the request -- the middleware will use it instead of generating one.

## Environment Variables

| Variable                  | Default                              | Description                                                         |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| `SQLALCHEMY_DATABASE_URI` | --                                   | Database connection string (async driver required)                  |
| `CORS_ALLOW_ORIGINS`      | `http://localhost, http://127.0.0.1` | Comma-separated allowed origins                                     |
| `AUTH_ENABLED`            | `true`                               | Set to `false` to disable auth (injects dev superuser with `*:*.*`) |
| `LOG_LEVEL`               | `DEBUG`                              | Loguru log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)            |
| `DB_STATEMENT_TIMEOUT`    | `5`                                  | Database statement timeout in seconds                               |
| `DB_POOL_SIZE`            | `10`                                 | SQLAlchemy connection pool size                                     |
| `DB_MAX_OVERFLOW`         | `20`                                 | Max overflow connections above pool size                            |
| `JWT_PROVIDER`            | `auto`                               | `shared_secret` / `public_key` / `jwks` / `auto`                    |
| `JWT_SECRET`              | --                                   | HMAC key (shared_secret mode)                                       |
| `JWT_PUBLIC_KEY`          | --                                   | PEM public key (public_key mode)                                    |
| `JWT_JWKS_URL`            | --                                   | JWKS endpoint URL (jwks mode)                                       |
| `JWT_ALGORITHMS`          | `RS256`                              | Comma-separated allowed algorithms                                  |
| `JWT_ISSUER`              | --                                   | Expected token issuer (also used to infer JWKS URL)                 |
| `JWT_AUDIENCE`            | --                                   | Expected token audience                                             |
| `JWT_REQUIRE_EXP`         | `true`                               | Require `exp` claim in token                                        |
| `JWT_VERIFY_NBF`          | `true`                               | Verify `nbf` (not before) claim                                     |
| `JWT_VERIFY_IAT`          | `false`                              | Verify `iat` (issued at) claim                                      |
| `JWT_JWKS_TIMEOUT_MS`     | `3000`                               | JWKS fetch timeout in milliseconds                                  |
| `JWT_JWKS_CACHE_TTL_SEC`  | `300`                                | JWKS cache TTL in seconds                                           |
| `JWT_JWKS_CACHE_MAX_KEYS` | `100`                                | Max keys in JWKS cache                                              |

## Entry Points

| Script        | Command                                    | Description                                    |
| ------------- | ------------------------------------------ | ---------------------------------------------- |
| `main.py`     | `uv run main.py`                           | Uvicorn server, hot reload enabled (port 7860) |
| `migrate.py`  | `uv run migrate.py`                        | Run Alembic upgrade to head                    |
|               | `uv run migrate.py --downgrade -1`         | Downgrade one revision                         |
| `test.py`     | `uv run test.py`                           | Pytest wrapper (passes through all args)       |
| `scaffold.py` | `uv run scaffold.py <entity>`              | Generate test file from model introspection    |
|               | `uv run scaffold.py <entity> --controller` | Also generate controller skeleton              |
|               | `uv run scaffold.py <entity> --model`      | Generate starter model for new entity          |

## Key Dependencies

| Package        | Purpose                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| FastAPI        | Web framework                                                                |
| SQLAlchemy 2.x | Async ORM (asyncpg for PostgreSQL, aiosqlite for SQLite, aiomysql for MySQL) |
| Alembic        | Database migrations                                                          |
| Pydantic 2.x   | Runtime schema generation and validation                                     |
| PyJWT          | JWT verification                                                             |
| Loguru         | Structured logging with request ID correlation                               |
| Ruff           | Linting and formatting                                                       |
