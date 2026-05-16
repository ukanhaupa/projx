# Projx -- Fastify Backend

Fastify + TypeScript backend template with automatic entity discovery, CRUD route generation, JWT authentication, Prisma ORM, and a plugin-based architecture. Define a Prisma model and a small config object, and the framework registers all CRUD routes, pagination, filtering, sorting, search, and FK expansion automatically.

## Prerequisites

- Node.js >= 20
- pnpm 10.x (`corepack enable && corepack prepare pnpm@10.33.0 --activate`)
- PostgreSQL 16 running locally

## Quick Start

```bash
# 1. Ensure PostgreSQL is running locally and reachable via DATABASE_URL

# 2. Install dependencies
pnpm install --frozen-lockfile

# 3. Copy environment file and configure DATABASE_URL
cp .env.example .env

# 4. Run database migrations and generate Prisma client
pnpm prisma:migrate:dev

# 5. Start development server with hot reload
pnpm dev
```

The server starts at `http://localhost:3000` by default.

- Swagger UI: `http://localhost:3000/docs`
- Health check: `GET /api/health`
- Entity metadata: `GET /api/v1/_meta`

## Project Structure

```
src/
├── app.ts                        # App builder, plugin registration, entity mounting
├── server.ts                     # Entry point (listen on HOST:PORT)
├── config.ts                     # Env config with TypeBox schema validation
├── errors.ts                     # NotFoundError, BusinessRuleError
├── plugins/
│   ├── prisma.ts                 # Prisma client decorator (fastify.prisma)
│   ├── auth.ts                   # JWT verification + permission-based authorization
│   ├── error-handler.ts          # Maps Prisma/app errors to HTTP status codes
│   └── swagger.ts                # OpenAPI 3.1 docs at /docs
├── modules/
│   ├── _base/                    # Auto-entity system (see below)
│   │   ├── entity-registry.ts    # Singleton registry, validates config on register
│   │   ├── auto-routes.ts        # Generates CRUD + bulk routes per entity
│   │   ├── repository.ts         # BaseRepository (Prisma-backed, soft-delete aware)
│   │   ├── service.ts            # BaseService (delegates to repository)
│   │   ├── query-engine.ts       # Pagination, filtering, search, sorting
│   │   ├── expand.ts             # FK expansion via ?expand=relation
│   │   └── index.ts              # Barrel exports
│   └── audit-logs/               # Built-in read-only audit log entity
│       ├── index.ts              # Entity config + registry registration
│       └── schemas.ts            # TypeBox request/response schemas
├── decorators/                   # Fastify decorators
└── hooks/                        # Fastify lifecycle hooks

prisma/
└── schema.prisma                 # Database schema (PostgreSQL)

tests/
├── helpers/
│   ├── app.ts                    # Test app builder (no logger, same plugin chain)
│   └── crud-test-base.ts         # Reusable CRUD test scaffolding
└── modules/
    ├── audit-logs.test.ts
    ├── auth-routes.test.ts
    ├── auto-routes.test.ts
    ├── entity-validation.test.ts
    ├── error-handler.test.ts
    ├── expand.test.ts
    ├── health.test.ts
    ├── meta.test.ts
    ├── query-engine.test.ts
    ├── repository.test.ts
    └── service.test.ts
```

## Auto-Entity Pattern

The core idea: you define an `EntityConfig` and register it with `EntityRegistry`. At startup, `app.ts` iterates over all registered entities and mounts full CRUD routes automatically.

### Adding a New Entity

**1. Create the Prisma model**

```prisma
model Task {
  id          String    @id @default(uuid())
  title       String    @db.VarChar(255)
  status      String    @db.VarChar(50)
  assigned_to String?   @db.VarChar(255)
  created_at  DateTime  @default(now())
  updated_at  DateTime  @updatedAt

  @@map("tasks")
}
```

**2. Run the migration**

```bash
pnpm prisma:migrate:dev --name add_tasks
```

**3. Create the module directory and schemas**

Create `src/modules/tasks/schemas.ts` with TypeBox schemas:

```typescript
import { Type, type Static } from '@sinclair/typebox';

export const TaskSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  title: Type.String(),
  status: Type.String(),
  assigned_to: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' }),
});

export type Task = Static<typeof TaskSchema>;

export const CreateTaskSchema = Type.Object({
  title: Type.String(),
  status: Type.String(),
  assigned_to: Type.Optional(Type.String()),
});

export const UpdateTaskSchema = Type.Object({
  title: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
  assigned_to: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
```

**4. Create the entity config and register it**

Create `src/modules/tasks/index.ts`:

```typescript
import {
  EntityRegistry,
  type EntityConfig,
  type FieldMeta,
} from '../_base/index.js';
import { TaskSchema, CreateTaskSchema, UpdateTaskSchema } from './schemas.js';

const fields: FieldMeta[] = [
  {
    key: 'id',
    label: 'Id',
    type: 'str',
    nullable: false,
    is_auto: true,
    is_primary_key: true,
    filterable: true,
    has_foreign_key: false,
    field_type: 'text',
  },
  {
    key: 'title',
    label: 'Title',
    type: 'str',
    nullable: false,
    is_auto: false,
    is_primary_key: false,
    filterable: true,
    has_foreign_key: false,
    field_type: 'text',
  },
  {
    key: 'status',
    label: 'Status',
    type: 'str',
    nullable: false,
    is_auto: false,
    is_primary_key: false,
    filterable: true,
    has_foreign_key: false,
    field_type: 'text',
  },
  {
    key: 'assigned_to',
    label: 'Assigned To',
    type: 'str',
    nullable: true,
    is_auto: false,
    is_primary_key: false,
    filterable: true,
    has_foreign_key: false,
    field_type: 'text',
  },
  {
    key: 'created_at',
    label: 'Created At',
    type: 'datetime',
    nullable: false,
    is_auto: true,
    is_primary_key: false,
    filterable: true,
    has_foreign_key: false,
    field_type: 'datetime',
  },
  {
    key: 'updated_at',
    label: 'Updated At',
    type: 'datetime',
    nullable: false,
    is_auto: true,
    is_primary_key: false,
    filterable: true,
    has_foreign_key: false,
    field_type: 'datetime',
  },
];

export const taskConfig: EntityConfig = {
  name: 'Task',
  tableName: 'tasks',
  prismaModel: 'Task',
  apiPrefix: '/tasks',
  tags: ['tasks'],
  readonly: false,
  softDelete: false,
  bulkOperations: true,
  columnNames: [
    'id',
    'title',
    'status',
    'assigned_to',
    'created_at',
    'updated_at',
  ],
  searchableFields: ['title', 'assigned_to'],
  fields,
  schema: TaskSchema,
  createSchema: CreateTaskSchema,
  updateSchema: UpdateTaskSchema,
};

EntityRegistry.register(taskConfig);
```

**5. Import the module in `app.ts`**

Add one line to `src/app.ts`:

```typescript
import './modules/tasks/index.js';
```

That is it. The following routes are now live:

| Method | Path               | Description      |
| ------ | ------------------ | ---------------- |
| GET    | /api/v1/tasks      | List (paginated) |
| GET    | /api/v1/tasks/:id  | Get by ID        |
| POST   | /api/v1/tasks      | Create           |
| PATCH  | /api/v1/tasks/:id  | Partial update   |
| DELETE | /api/v1/tasks/:id  | Delete           |
| POST   | /api/v1/tasks/bulk | Bulk create      |
| DELETE | /api/v1/tasks/bulk | Bulk delete      |

### EntityConfig Reference

```typescript
interface EntityConfig {
  name: string; // PascalCase name (e.g. "Task")
  tableName: string; // DB table name (e.g. "tasks")
  prismaModel: string; // Prisma model name (e.g. "Task")
  apiPrefix: string; // URL prefix (e.g. "/tasks")
  tags: string[]; // Swagger tags
  readonly: boolean; // true = GET routes only (no POST/PATCH/DELETE)
  softDelete: boolean; // true = set deleted_at instead of hard delete (requires deleted_at column)
  bulkOperations: boolean; // true = enable /bulk endpoints
  columnNames: string[]; // All column names (used for filter validation)
  searchableFields: string[]; // Columns searched by ?search= (case-insensitive contains)
  fields: FieldMeta[]; // Field metadata (used by _meta endpoint and frontends)
  schema: TObject; // TypeBox schema for response
  createSchema: TObject; // TypeBox schema for POST body
  updateSchema: TObject; // TypeBox schema for PATCH body
  relations?: Record<string, { model: string; field: string }>; // FK relations for ?expand=
  auth?: {
    protected: boolean;
    permissions?: {
      list?: string;
      get?: string;
      create?: string;
      update?: string;
      delete?: string;
    };
  };
}
```

## Authentication

The auth plugin (`src/plugins/auth.ts`) supports JWT-based authentication with three provider modes configured via `JWT_PROVIDER`:

| Provider        | Use case                  | Config needed    |
| --------------- | ------------------------- | ---------------- |
| `shared_secret` | Development / simple apps | `JWT_SECRET`     |
| `public_key`    | OIDC providers            | `JWT_PUBLIC_KEY` |
| `jwks`          | Auto-rotating keys        | `JWT_JWKS_URL`   |

Per-entity auth is configured via the `auth` field on `EntityConfig`. When `auth.protected` is true, the `authenticate` hook runs on every route for that entity. Optional `permissions` map operations to permission strings checked against the JWT `permissions` claim.

## Database

**ORM:** Prisma with PostgreSQL.

**Key commands:**

```bash
pnpm prisma:migrate:dev          # Create and apply a migration
pnpm prisma:migrate:deploy       # Apply pending migrations (CI/production)
pnpm prisma:generate             # Regenerate Prisma client after schema changes
pnpm prisma:studio               # Open Prisma Studio GUI
```

The schema lives at `prisma/schema.prisma`. The built-in `AuditLog` model is included as a reference.

## Query Features

All list endpoints (`GET /api/v1/<entity>`) support:

**Pagination**

```
?page=2&page_size=25
```

Default page size is 10, maximum is 100. Responses include a `pagination` object with `current_page`, `page_size`, `total_pages`, and `total_records`.

**Filtering**

Filter by any column in `columnNames`:

```
?status=active                       # exact match
?status=active,pending               # IN (comma-separated)
?created_at__gte=2025-01-01          # greater than or equal
?created_at__lte=2025-12-31          # less than or equal
?assigned_to__isnull=true            # null check
?title__like=urgent                  # case-insensitive contains
?status__in=active,done              # explicit IN
```

Supported suffixes: `__gte`, `__lte`, `__gt`, `__lt`, `__like`, `__in`, `__isnull`.

**Search**

```
?search=keyword
```

Searches across all fields listed in `searchableFields` using case-insensitive contains.

**Sorting**

```
?order_by=created_at                 # ascending
?order_by=-created_at                # descending (prefix with -)
?order_by=-status,created_at         # multi-field sort (comma-separated)
```

Default sort is `created_at` descending.

**FK Expansion**

```
?expand=author,category
```

Include related records inline (only works for relations defined in `EntityConfig.relations`).

## Environment Variables

| Variable             | Default                           | Description                                   |
| -------------------- | --------------------------------- | --------------------------------------------- |
| `DATABASE_URL`       | (required)                        | PostgreSQL connection string                  |
| `HOST`               | `0.0.0.0`                         | Server bind address                           |
| `PORT`               | `3000`                            | Server port                                   |
| `LOG_LEVEL`          | `info`                            | Pino log level                                |
| `JWT_SECRET`         | `dev-secret-change-in-production` | Shared secret for JWT signing/verifying       |
| `JWT_PROVIDER`       | `shared_secret`                   | JWT strategy: shared_secret, public_key, jwks |
| `JWT_PUBLIC_KEY`     | (empty)                           | PEM public key for public_key provider        |
| `JWT_JWKS_URL`       | (empty)                           | JWKS endpoint URL for jwks provider           |
| `CORS_ALLOW_ORIGINS` | `http://localhost:5173`           | Comma-separated allowed origins               |

See `.env.example` for a ready-to-use template.

## Testing

Tests use Vitest with `fastify.inject()` for zero-overhead HTTP testing (no actual server started).

```bash
pnpm test                  # Run all tests
pnpm test:watch            # Watch mode
pnpm test:coverage         # Run with V8 coverage report
```

The test suite covers: auto-routes, query engine, repository, service, entity validation, error handler, auth routes, FK expansion, health check, meta endpoint, and audit logs.

## Docker

**Production build:**

```bash
docker build -t fastify-backend .
```

The image runs under `pm2-runtime` in cluster mode (see `ecosystem.config.cjs`). The named `migrate` build target runs `prisma migrate deploy` and is invoked by the root `docker-compose.yml`.

## Available Scripts

| Script                       | Description                                 |
| ---------------------------- | ------------------------------------------- |
| `pnpm dev`                   | Start dev server with hot reload (tsx)      |
| `pnpm build`                 | Compile TypeScript to `dist/`               |
| `pnpm start`                 | Run compiled output (`dist/server.js`)      |
| `pnpm test`                  | Run all tests with Vitest                   |
| `pnpm test:watch`            | Vitest in watch mode                        |
| `pnpm test:coverage`         | Tests with V8 coverage                      |
| `pnpm lint`                  | ESLint with auto-fix on `src/` and `tests/` |
| `pnpm format`                | Prettier format all files                   |
| `pnpm typecheck`             | Type-check without emitting                 |
| `pnpm prisma:generate`       | Regenerate Prisma client                    |
| `pnpm prisma:migrate:dev`    | Create and apply migration                  |
| `pnpm prisma:migrate:deploy` | Apply migrations (production)               |
| `pnpm prisma:studio`         | Open Prisma Studio                          |

## Error Handling

The centralized error handler (`src/plugins/error-handler.ts`) maps errors to appropriate HTTP responses:

| Error                    | HTTP Status | Description                            |
| ------------------------ | ----------- | -------------------------------------- |
| Fastify validation error | 400         | Invalid request body/params/query      |
| `NotFoundError`          | 404         | Record not found                       |
| Prisma P2025             | 404         | Record not found (Prisma level)        |
| Prisma P2002             | 409         | Unique constraint violation            |
| Prisma P2003             | 409         | Foreign key constraint violation       |
| `BusinessRuleError`      | 422         | Custom business logic violation        |
| Unhandled error          | 500         | Internal server error (message hidden) |

All error responses include a `request_id` for tracing.
