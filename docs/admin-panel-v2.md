# Admin Panel v2 — Replace Directus with a Go + HTMX scaffold

> **Status:** design proposal, not implemented.
> **Author:** Kanha + Claude session, 2026-06-07.
> **Replaces:** the current `admin-panel/` template (Directus, Docker-only).
> **Scope:** v1 of the new template — auth + generic CRUD + impersonation. No dashboards (devs add their own).

## Why we're replacing Directus

The current `admin-panel/` template ships [Directus](https://directus.io) as a Docker service. The pitch — "instant admin UI + REST/GraphQL over your DB" — is misleading in two ways that cost real time:

1. **"Instant CRUD" is API-only.** Directus introspects every table on first boot and exposes it through `/items/<table>`, but the Data Studio (the actual click-through UI) requires each table to be **manually registered** via a "Create Collection → use existing table" flow. For a Postgres with 60 application tables, that's 60 manual clicks before the panel is usable. Bulk-registration via the `POST /collections` API exists but isn't documented as the expected workflow.
2. **Sub-path mounting is broken-by-design.** Directus hard-codes its app mount at `/admin` and emits `<base href>` accordingly. Putting it behind `nginx /admin/` produces doubled paths (`/admin/admin/`), broken asset MIME types, and redirect loops. The only working deployment is a separate subdomain, which fights the projx "one-domain, behind-nginx" pattern.

Add the implicit costs — BSL 1.1 license, the runtime dependency on a non-Ekarche project, the YAML-snapshot configuration drift, the field-level redaction that's off by default — and Directus stops being a fit for a scaffolder whose pitch is "production-ready out of the box."

The replacement: a small, self-contained admin panel that projx generates as a subrepo inside the scaffolded project. The dev owns every line. Onboarding cost is ~30 minutes regardless of stack. The pitch we make is honest.

## Decisions locked in before writing this doc

| Decision                             | Choice                                                                                                       | Why                                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Integration shape**                | projx component generating an `admin-panel/` subrepo inside the scaffolded project                           | Devs see and own the code; no `node_modules/@ekarche/admin-panel` to debug through; matches projx's "scaffold then it's yours" model                                                        |
| **Stack — backend**                  | **Go** + `chi` router + `pgx` Postgres driver                                                                | Single static binary deploy. Schema introspection is idiomatic. ~50ms cold start, ~30MB binary, ~30MB RSS. Approachable for any TS/Python developer.                                        |
| **Stack — frontend**                 | **HTMX + templ** (server-rendered HTML)                                                                      | Admin panels are mostly forms and tables. SPA tax (build pipeline, bundler config, state mgmt) isn't justified for 5-user internal tools. Hot-reload of HTML templates is faster than Vite. |
| **Auth boundary**                    | Separate `admin_users` table + own `ADMIN_JWT_SECRET` + mandatory TOTP MFA                                   | Eliminates the single-bit privilege-escalation risk where `users.role = 'super_admin'` grants god mode. Mass-assignment on tenant `users` table becomes a non-event for admin access.       |
| **DB layout**                        | Admin tables live in tenant's Postgres, in a separate `admin_panel` schema (`admin_panel.admin_users`, etc.) | Cleanest separation. Impersonation can FK to `public.users(id)` for audit integrity. Generic CRUD denylist becomes trivially "deny everything in `admin_panel.*`."                          |
| **v1 scope**                         | Admin auth, generic CRUD over `public.*`, impersonation with banner + audit                                  | Smallest surface that's genuinely useful. Dashboards are inherently project-specific; devs add their own as new Go handlers + templ files.                                                  |
| **Generic CRUD permission default**  | New tables auto-appear as **read-only**; writes require explicit allowlist                                   | Avoids the "anyone with admin access can wipe a fresh sensitive table the moment a migration ships" risk.                                                                                   |
| **Impersonation TTL**                | Hard-capped at 30 minutes in code                                                                            | Configurability invites raising "just this once" and never lowering. 30 min is enough; admin can re-impersonate.                                                                            |
| **Component naming**                 | Replace `admin-panel` in place; bump projx major version (1.6 → 2.0)                                         | No existing Ekarche project has integrated the Directus version; honest deprecation beats `admin-panel-v2` becoming permanent.                                                              |
| **License of generated code**        | Same as the scaffolded project (MIT by default). All dependencies are MIT/BSD/Apache-2.                      | No BSL/AGPL anywhere. Free to use in commercial closed-source if a future Ekarche product needs it.                                                                                         |
| **Supported tenant backends for v1** | Any — the admin panel is a separate service, talks to Postgres directly                                      | The tenant backend's language doesn't matter. Today: Fastify, FastAPI, Express. Tomorrow: anything. The admin panel doesn't import or interact with the tenant backend's code path.         |

## What the new `admin-panel/` looks like

After `npx create-projx my-app --components fastify,frontend,admin-panel` (or `--components fastapi,frontend,admin-panel` — backend language doesn't matter), the project layout is:

```
my-app/
├── backend/                  # Fastify (or fastapi/, express/) — unchanged by admin-panel component
├── frontend/                 # React + Vite marketing/app UI — unchanged
├── admin-panel/              # ← NEW: self-contained Go + HTMX admin
│   ├── cmd/admin/
│   │   └── main.go           # entrypoint: load env, wire deps, http.ListenAndServe
│   ├── internal/
│   │   ├── auth/
│   │   │   ├── login.go      # POST /admin/login, password verify, session cookie
│   │   │   ├── mfa.go        # TOTP enrollment, verify, recovery codes
│   │   │   ├── password.go   # change, reset, argon2id hashing
│   │   │   ├── session.go    # refresh/access JWT, blacklist on rotate
│   │   │   └── middleware.go # RequireAdmin, RequireMFA, RecordAudit
│   │   ├── crud/
│   │   │   ├── introspect.go # query information_schema + pg_catalog
│   │   │   ├── handlers.go   # GET/POST/PATCH/DELETE /admin/db/{table}/...
│   │   │   ├── filters.go    # parse req query into typed WHERE clauses
│   │   │   ├── redact.go     # column-level redaction per Config.Deny
│   │   │   └── allowlist.go  # validate identifiers against live schema
│   │   ├── impersonation/
│   │   │   ├── start.go      # POST /admin/impersonation/start
│   │   │   ├── stop.go       # POST /admin/impersonation/stop/:session_id
│   │   │   ├── token.go      # mint impersonation JWT with tenant's JWT_SECRET
│   │   │   ├── blocklist.go  # path patterns blocked under impersonation
│   │   │   └── session.go    # admin_impersonation_sessions CRUD
│   │   ├── views/
│   │   │   ├── layout.templ        # shell: nav, banner slot, content slot
│   │   │   ├── login.templ
│   │   │   ├── mfa.templ
│   │   │   ├── table_list.templ    # left-nav list of tables
│   │   │   ├── table_explorer.templ # main grid: filters, sort, pagination, rows
│   │   │   ├── row_editor.templ    # form rendered from column metadata
│   │   │   ├── audit_log.templ
│   │   │   ├── admin_users.templ
│   │   │   └── impersonation_banner.templ
│   │   ├── audit/
│   │   │   └── log.go        # append to admin_audit_logs in a request-scoped hook
│   │   ├── db/
│   │   │   ├── conn.go       # pgx pool
│   │   │   └── migrate.go    # apply schema migrations on boot (idempotent)
│   │   └── config.go         # AdminPanelConfig: Deny, Permissions, Bootstrap — TENANT EDITS THIS
│   ├── migrations/
│   │   ├── 0001_init.sql     # CREATE SCHEMA admin_panel; CREATE TABLE admin_users; ...
│   │   └── 0002_*.sql        # future migrations, embedded in binary via go:embed
│   ├── static/
│   │   ├── htmx.min.js       # vendored, version-pinned
│   │   └── style.css         # ~200 lines of CSS, no Tailwind, no build step
│   ├── go.mod
│   ├── go.sum
│   ├── Dockerfile            # multi-stage: golang:1.23 → distroless static
│   ├── .env.example
│   └── README.md             # how to run, how to add a dashboard, how to extend
├── docker-compose.yml        # tenant compose, gets admin-panel service added
└── nginx.conf                # gets admin.<DOMAIN> server block added (or /admin location if subpath)
```

Roughly **~3,500 LOC of Go + templ** total for v1, fully tested (~1,500 LOC of tests on top). Everything is **in the tenant's git repo**, code-reviewed in PRs, runs in CI like any other service.

Compare to memoria's current custom admin: 6,044 LOC of code + ~5,000 LOC of tests, all hand-written. The new template eliminates the need for that across every Ekarche project, replaced by a single Go + templ service that's identical across siblings.

## Component contract with projx

### Manifest

`admin-panel/.projx-component`:

```json
{
  "component": "admin-panel",
  "version": "2.0.0",
  "stack": "go",
  "ui": "htmx+templ",
  "requires": [],
  "optionalIntegrates": ["fastify", "fastapi", "express"]
}
```

The component does NOT require a specific backend component — it only requires Postgres. The `optionalIntegrates` field signals which existing backend components, if present, will get a small integration patch (described in "Tenant backend integration" below).

### Generation

`npx create-projx my-app --components fastify,frontend,admin-panel,infra,e2e` runs:

1. **Base scaffold** — `fastify/`, `frontend/`, etc., as today
2. **Admin panel component** — copy `admin-panel/` template directly into `my-app/admin-panel/`. No EJS rendering needed inside; the template is project-agnostic Go code. Only `.env.example`, `Dockerfile`, and `README.md` are EJS-rendered with project name.
3. **docker-compose service injection** — `cli/src/templates/docker-compose.yml.ejs` gets a new conditional block:
   ```yaml
   <% if (components.includes('admin-panel')) { %>
   admin-panel:
     build: ./admin-panel
     environment:
       DATABASE_URL: ${DATABASE_URL}
       ADMIN_JWT_SECRET: ${ADMIN_JWT_SECRET}
       TENANT_JWT_SECRET: ${JWT_SECRET}  # for minting impersonation tokens tenant auth accepts
       ADMIN_BOOTSTRAP_EMAIL: ${ADMIN_BOOTSTRAP_EMAIL}
       ADMIN_BOOTSTRAP_PASSWORD: ${ADMIN_BOOTSTRAP_PASSWORD}
       PUBLIC_URL: https://admin.${DOMAIN}
     expose:
       - "8080"
     depends_on:
       - postgres
     restart: unless-stopped
   <% } %>
   ```
4. **nginx server block** (if `infra/` or compose ships nginx) — add an `admin.<DOMAIN>` server block proxying to `admin-panel:8080`. Default to subdomain because the Directus debacle taught us sub-path mounting is fragile for any admin tool with a non-root-aware SPA.
5. **GH Actions secret list** — `deploy-ec2.yml.ejs` adds `ADMIN_JWT_SECRET`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` to the required-secrets list.
6. **Tenant backend integration patch** — see next section.

### Tenant backend integration

The admin panel mints **impersonation tokens** that the tenant backend's existing auth plugin must recognize, because the impersonation token is presented to the tenant backend (not to the admin panel) when an admin browses the user-side app under impersonation. The integration is small and one-time:

For **Fastify backends**, the component adds ~30 lines to `backend/src/plugins/auth.ts`:

```ts
// projx-anchor: impersonation-recognition
fastify.decorateRequest("impersonator", null);
fastify.addHook("preHandler", async (request) => {
  const auth = request.requestContext?.auth;
  if (auth?.type === "impersonation") {
    request.impersonator = auth.impersonator;
    // expose to clients so they can render the banner
    request.headers["x-impersonated-by"] = auth.impersonator.admin_email;
  }
});
```

These are placed at named anchors that survive `projx update` 3-way merge. If the tenant has edited surrounding code, the merge still works because the inserted lines are pinpointed by anchor.

For **FastAPI backends**, a parallel patch is applied to `app/middleware/auth.py`.

For **Express backends**, to `src/middleware/auth.ts`.

For backends not in `optionalIntegrates`, the admin panel still works — but impersonation tokens won't be honored by the tenant backend, so the impersonation feature is auto-disabled. The component prints a clear warning at scaffold time:

```
[admin-panel] No supported backend detected. Impersonation will be disabled.
              Supported: fastify, fastapi, express. To enable impersonation
              for a custom backend, see docs/admin-panel-v2-impersonation.md.
```

### `projx update` semantics

| File                                  | Owner      | Update behavior                                                        |
| ------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| `admin-panel/cmd/admin/main.go`       | projx (us) | Overwrite                                                              |
| `admin-panel/internal/auth/`          | projx (us) | Overwrite                                                              |
| `admin-panel/internal/crud/`          | projx (us) | Overwrite                                                              |
| `admin-panel/internal/impersonation/` | projx (us) | Overwrite                                                              |
| `admin-panel/internal/views/`         | projx (us) | Overwrite (devs add new `.templ` files for dashboards — those survive) |
| `admin-panel/internal/config.go`      | **dev**    | 3-way merge — projx adds new fields, dev's customizations survive      |
| `admin-panel/migrations/`             | projx (us) | Append-only — projx adds new migrations, never edits historical ones   |
| `admin-panel/Dockerfile`              | shared     | 3-way merge                                                            |
| `admin-panel/.env.example`            | projx (us) | Overwrite                                                              |
| `admin-panel/go.mod` / `go.sum`       | shared     | Projx adds new deps; dev's added deps survive                          |
| `admin-panel/README.md`               | shared     | 3-way merge                                                            |

The `internal/views/` and `internal/handlers/dashboards/` directories are the dev-extension surface — adding new `.templ` files and new route handlers there is exactly how custom dashboards land. Projx never deletes a file in those directories.

## Schema — what the admin panel adds to the tenant's Postgres

All in a separate `admin_panel` schema. Generated on first boot via `admin-panel/migrations/0001_init.sql` (idempotent).

```sql
CREATE SCHEMA IF NOT EXISTS admin_panel;

CREATE TABLE admin_panel.admin_users (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    TEXT UNIQUE NOT NULL,
  display_name             TEXT NOT NULL,
  password_hash            TEXT NOT NULL,                    -- argon2id
  totp_secret_encrypted    TEXT,                              -- AES-GCM via TENANT_JWT_SECRET-derived key
  totp_enrolled_at         TIMESTAMPTZ,
  recovery_codes_hash      TEXT[] DEFAULT '{}'::TEXT[],
  password_changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  failed_login_count       INT NOT NULL DEFAULT 0,
  locked_until             TIMESTAMPTZ,
  last_login_at            TIMESTAMPTZ,
  last_login_ip            INET,
  permissions              JSONB NOT NULL DEFAULT '{"role":"admin"}'::JSONB,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  disabled_at              TIMESTAMPTZ,
  disabled_by              UUID REFERENCES admin_panel.admin_users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               UUID REFERENCES admin_panel.admin_users(id)
);

CREATE TABLE admin_panel.admin_audit_logs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id          UUID NOT NULL REFERENCES admin_panel.admin_users(id),
  action                 TEXT NOT NULL,                       -- e.g. 'login', 'impersonate.start', 'crud.update'
  target_schema          TEXT,                                -- 'public' for tenant tables
  target_table           TEXT,
  target_id              TEXT,
  impersonated_user_id   TEXT,                                -- denormalized as TEXT to allow non-UUID PKs
  ip_address             INET NOT NULL,
  user_agent             TEXT,
  request_id             TEXT,
  before_value           JSONB,
  after_value            JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON admin_panel.admin_audit_logs (admin_user_id, created_at DESC);
CREATE INDEX ON admin_panel.admin_audit_logs (impersonated_user_id, created_at DESC);

CREATE TABLE admin_panel.admin_impersonation_sessions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id          UUID NOT NULL REFERENCES admin_panel.admin_users(id),
  impersonated_user_id   TEXT NOT NULL,                       -- text to allow non-UUID PKs
  reason                 TEXT NOT NULL,
  ticket_url             TEXT,
  started_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at             TIMESTAMPTZ NOT NULL,
  ended_at               TIMESTAMPTZ,
  ended_reason           TEXT
);
CREATE INDEX ON admin_panel.admin_impersonation_sessions (admin_user_id, started_at DESC);
CREATE INDEX ON admin_panel.admin_impersonation_sessions (impersonated_user_id) WHERE ended_at IS NULL;

CREATE TABLE admin_panel.admin_refresh_tokens (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id          UUID NOT NULL REFERENCES admin_panel.admin_users(id) ON DELETE CASCADE,
  token_hash             TEXT NOT NULL UNIQUE,
  expires_at             TIMESTAMPTZ NOT NULL,
  revoked_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address             INET,
  user_agent             TEXT
);
CREATE INDEX ON admin_panel.admin_refresh_tokens (admin_user_id) WHERE revoked_at IS NULL;
```

The tenant's own Prisma/SQLAlchemy/whatever migration runner is unaware of these tables because they live in a different schema. The admin panel applies its own migrations on boot via embedded `go:embed` of the `migrations/` directory — same pattern as `golang-migrate`, but without the extra binary.

## HTTP surface

All routes live on the admin panel's own port (8080 internal, behind `admin.<DOMAIN>` via nginx).

```
# Unauthenticated (rate-limited to 5r/m per IP at nginx level)
GET  /                                       # → 302 to /login or /dashboard
GET  /login                                  # login form
POST /login                                  # password verify, sets `mfa_pending` cookie
GET  /mfa                                    # TOTP entry form (requires mfa_pending)
POST /mfa                                    # TOTP verify, sets refresh + access tokens
POST /logout

# First-time setup (one-shot, gated by ADMIN_BOOTSTRAP_PASSWORD env)
GET  /setup                                  # only reachable if zero admin_users rows
POST /setup                                  # creates the first admin user

# Authenticated (require valid admin access token)
GET  /dashboard                              # landing page; default shows recent activity
GET  /tables                                 # left-nav list of `public.*` tables
GET  /tables/{table}                         # main explorer for one table
POST /tables/{table}                         # create row
GET  /tables/{table}/{id}                    # view + edit form
POST /tables/{table}/{id}                    # update row (form-encoded for HTMX)
POST /tables/{table}/{id}/delete             # soft-delete if `deleted_at` exists, hard-delete otherwise
GET  /tables/{table}/_export.csv             # stream CSV of current filter set

# Generic CRUD JSON API (parallel surface for power users / scripts)
GET    /api/v1/admin/db/_tables
GET    /api/v1/admin/db/{table}
GET    /api/v1/admin/db/{table}/_columns
GET    /api/v1/admin/db/{table}/{id}
POST   /api/v1/admin/db/{table}
PATCH  /api/v1/admin/db/{table}/{id}
DELETE /api/v1/admin/db/{table}/{id}

# Admin user management
GET  /admins                                 # list admin users
GET  /admins/new                             # form
POST /admins                                 # create
GET  /admins/{id}                            # view + edit form
POST /admins/{id}                            # update
POST /admins/{id}/disable                    # soft-disable
POST /admins/{id}/reset-password             # email reset link (if SMTP configured)

# Impersonation
GET  /impersonate                            # form: user_id, reason, ticket_url, ttl
POST /impersonate                            # mint token; show "open user-side app" link
POST /impersonate/{session_id}/stop          # end session

# Audit log
GET  /audit                                  # filtered list of admin_audit_logs

# Health / observability
GET  /healthz                                # liveness
GET  /readyz                                 # readiness — pings DB
GET  /metrics                                # Prometheus exposition (optional, gated by env)
```

The HTMX-driven UI exclusively uses the form-encoded routes. The JSON API exists for scripted access — useful for one-off CLI work via `curl` with an admin token.

## Generic CRUD safety contract

This is the load-bearing security boundary. Three rules cannot be relaxed:

### 1. Identifier whitelist resolved at request time

Table names and column names appearing in any dynamically-built SQL come exclusively from a per-request fetch of `information_schema.tables` and `information_schema.columns` scoped to `schema='public'`. Anything not in the live introspection result returns 404.

```go
func (s *Server) resolveTable(ctx context.Context, name string) (*TableInfo, error) {
    tbl, ok := s.schemaCache.Get(ctx, "public", name)
    if !ok {
        return nil, ErrNotFound
    }
    if s.config.IsDenied("public", name) {
        return nil, ErrNotFound
    }
    return tbl, nil
}
```

`req.params["table"]` and `req.params["column"]` go through `resolveTable` / `resolveColumn` before being interpolated into any SQL skeleton. The skeleton is built with the already-validated identifier; values are always parameterized via `$1, $2, ...`.

### 2. System / sensitive denylist

Ships with sensible defaults; tenant extends via `internal/config.go`:

```go
var DefaultDeny = DenyConfig{
    Schemas: []string{"admin_panel", "pg_catalog", "information_schema"},
    Tables: []string{
        "_prisma_migrations", "alembic_version",
    },
    ColumnPatterns: []string{
        "*_password_hash", "password_hash",
        "*_secret_encrypted", "value_encrypted",
        "*_token_hash", "refresh_token_hash",
        "totp_secret_*",
    },
}
```

Tenant adds project-specific rules:

```go
// admin-panel/internal/config.go — tenant edits this
var Config = AdminPanelConfig{
    Deny: crud.DenyConfig{
        Tables: []string{"sensitive_audit_log"},
        Columns: map[string][]string{
            "users": {"locked_until"},  // hide column from explorer
        },
    },
    ...
}
```

Per-column denylist hides the column from list views, redacts it as `***` in detail views, and rejects writes that try to set it.

### 3. Per-table permission tiers

Three tiers: `read`, `write`, `none`. **Default is `read`** for tables not in the allowlist — explicit opt-in for write access.

```go
var Config = AdminPanelConfig{
    Permissions: crud.PermissionConfig{
        Default: crud.PermRead,                    // new tables auto-appear read-only
        Tables: map[string]crud.Permission{
            "users":             crud.PermWrite,
            "households":        crud.PermWrite,
            "data_requests":     crud.PermWrite,
            "audit_logs":        crud.PermNone,    // hidden entirely
            "payment_events":    crud.PermRead,    // webhook log, never edit
        },
    },
}
```

A tenant who adds a new Prisma model and runs migrations sees the table appear in the admin panel automatically as **read-only**. To allow edits, they add one line to `internal/config.go`. The migration history of `internal/config.go` is the audit trail of "what became editable when."

## Impersonation contract

This is where most teams ship footguns; locking in the safe pattern up front.

### Token shape

Mint a JWT signed with `TENANT_JWT_SECRET` (so the tenant's existing auth plugin accepts it without any new code beyond the impersonation-recognition patch):

```json
{
  "aud": "user",
  "type": "impersonation",
  "sub": "<impersonated_user_id>",
  "household_id": "<resolved_via_tenant_lookup>",
  "impersonator": {
    "admin_user_id": "<uuid>",
    "admin_email": "<email>",
    "session_id": "<impersonation_session_uuid>",
    "started_at": "<iso8601>",
    "expires_at": "<iso8601>"
  },
  "iat": 1780900000,
  "exp": 1780901800,
  "jti": "<random>"
}
```

The tenant's auth plugin reads it just like a regular user token, but the impersonation-recognition patch (see "Tenant backend integration") sets `request.impersonator` and adds the `X-Impersonated-By` response header.

### Banner

Every API call made under an impersonation token sets `X-Impersonated-By: <admin_email>` in the response. Tenant mobile/web clients render a non-dismissable banner: "Support is viewing your account. Started 14:32 IST by `admin@example.com`."

Mobile (Flutter) implementation lives in the `mobile/` projx component as a feature overlay enabled when `admin-panel` is in the components list. Same for `frontend/` (React).

### Blocked actions during impersonation

Hardcoded denylist of route patterns in `internal/impersonation/blocklist.go`:

```go
var DefaultBlocklist = []string{
    "POST /api/v1/auth/password",
    "POST /api/v1/auth/2fa/*",
    "POST /api/v1/auth/email",
    "POST /api/v1/auth/phone",
    "DELETE /api/v1/users/me",
    "POST /api/v1/users/me/devices",
    "POST /api/v1/auth/oauth/*/grant",
    "POST /api/v1/invites/accept/*",
    "POST /api/v1/notifications/*/read",
    "POST /api/v1/messages/*/read",
}
```

Tenant extends via config. Calls to blocked routes during an impersonation session return `403 {"code": "impersonation_blocked", "detail": "This action cannot be performed while support is viewing the account."}`.

The blocklist enforcement lives in the **tenant backend** (the impersonation-recognition patch is extended in `add` mode to also enforce blocklist). The admin panel cannot enforce it because the requests don't go through the admin panel.

### TTL

Hard-coded `MaxImpersonationTTL = 30 * time.Minute` in `internal/impersonation/start.go`. Admin can request shorter via the form; server caps at 30 min regardless. Re-impersonation is allowed (creates a new session row).

### Revocation

Two paths:

1. Admin clicks "End session" in `/impersonate` page → `POST /impersonate/{session_id}/stop` sets `ended_at`
2. User clicks "End support session" in their banner → tenant-side `POST /api/v1/auth/end-impersonation` extracts `session_id` from the JWT and calls a small admin-panel endpoint to set `ended_at`

The tenant auth plugin checks `session.ended_at IS NULL AND session.expires_at > now()` on every request bearing an impersonation token. If false, returns 401. The session check is cached per-token with a 30-second TTL — bounded staleness, bounded DB load.

## Deploy

### Dockerfile

```dockerfile
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /admin ./cmd/admin

FROM gcr.io/distroless/static:nonroot
COPY --from=build /admin /admin
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/admin"]
```

Final image: ~30 MB (vs Directus' ~600 MB).

### docker-compose entry

Injected by projx into the tenant's `docker-compose.yml`:

```yaml
admin-panel:
  build: ./admin-panel
  environment:
    DATABASE_URL: ${DATABASE_URL}
    ADMIN_JWT_SECRET: ${ADMIN_JWT_SECRET}
    TENANT_JWT_SECRET: ${JWT_SECRET}
    ADMIN_BOOTSTRAP_EMAIL: ${ADMIN_BOOTSTRAP_EMAIL}
    ADMIN_BOOTSTRAP_PASSWORD: ${ADMIN_BOOTSTRAP_PASSWORD}
    PUBLIC_URL: https://admin.${DOMAIN}
    LOG_LEVEL: info
  expose:
    - "8080"
  depends_on:
    postgres:
      condition: service_healthy
  restart: unless-stopped
  healthcheck:
    test: ["CMD", "/admin", "healthcheck"] # binary supports a healthcheck subcommand
    interval: 30s
    timeout: 5s
    retries: 3
    start_period: 10s
```

### nginx

Subdomain only — no sub-path mounting (lesson from the Directus debacle, even though Go + HTMX wouldn't suffer the same bug, it keeps the pattern uniform):

```nginx
server {
    listen 80;
    server_name admin.${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl;
    http2 on;
    server_name admin.${DOMAIN};
    ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    location / {
        resolver 127.0.0.11 valid=10s;
        set $admin_upstream admin-panel;
        proxy_pass http://$admin_upstream:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Certbot is extended to issue an additional cert SAN for `admin.<DOMAIN>` in the projx-shipped `setup-ssl.sh` script. DNS A record for `admin.<domain>` is documented in the README as a manual step (or wired via the `infra/` component's Terraform DNS provider if present).

## Bootstrap flow

First-deploy chicken-and-egg: how does the first admin user get created without an existing admin to create them?

```
1. Operator sets ADMIN_BOOTSTRAP_EMAIL + ADMIN_BOOTSTRAP_PASSWORD env vars
2. Admin panel boots, applies migrations
3. /setup endpoint is gated:
   - returns 404 if any row exists in admin_users
   - returns 200 with a form if zero rows
4. Form POST creates the first admin user with the bootstrap credentials
5. /setup is now permanently 404
6. Operator unsets ADMIN_BOOTSTRAP_PASSWORD env (no longer needed)
```

Bootstrap secrets live in GH Actions secrets (`ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`) injected via the deploy workflow per the existing `BACKEND_ENV` / `AI_ENV` pattern documented in [memoria/CLAUDE.md](https://github.com/ekarche/memoria/blob/main/CLAUDE.md).

After first login, the operator:

1. Rotates the bootstrap password via `/admins/{me}/reset-password`
2. Enrolls TOTP via `/admins/{me}/mfa`
3. Updates `ADMIN_BOOTSTRAP_PASSWORD` in GH Actions secrets to a fresh random (so it's not the live password sitting in secrets)
4. Onboards additional admin users via `/admins/new`

## Customization surface — what devs edit

Three files are dev-owned and survive `projx update` via 3-way merge:

| File                                        | Purpose                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `admin-panel/internal/config.go`            | Deny rules, permission tiers, impersonation blocklist extensions, branding (display name, theme colors) |
| `admin-panel/internal/views/dashboards/`    | New `.templ` files for project-specific dashboard pages                                                 |
| `admin-panel/internal/handlers/dashboards/` | New `.go` files for the handlers backing those pages                                                    |

Dashboard pattern: create a Go file, register a route, write a templ file. Example for a "Revenue Today" dashboard:

```go
// admin-panel/internal/handlers/dashboards/revenue.go
package dashboards

import (
    "context"
    "net/http"

    "github.com/jackc/pgx/v5/pgxpool"

    "myapp/admin-panel/internal/views/dashboards"
)

func RevenueToday(db *pgxpool.Pool) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        var total int64
        err := db.QueryRow(r.Context(), `
            SELECT COALESCE(SUM(amount_cents), 0)
            FROM payment_events
            WHERE status = 'received'
              AND created_at >= CURRENT_DATE
        `).Scan(&total)
        if err != nil {
            http.Error(w, err.Error(), 500)
            return
        }
        dashboards.RevenueToday(total).Render(r.Context(), w)
    }
}
```

```html
<!-- admin-panel/internal/views/dashboards/revenue.templ -->
templ RevenueToday(totalCents int64) {
<div class="kpi-card">
  <div class="kpi-label">Revenue today</div>
  <div class="kpi-value">${ fmt.Sprintf("%.2f", float64(totalCents)/100) }</div>
</div>
}
```

Route registration in `cmd/admin/main.go` is gated by an anchor comment so devs can add lines without conflict:

```go
// projx-anchor: dashboard-routes
r.Get("/dashboards/revenue-today", dashboards.RevenueToday(db))
// /projx-anchor
```

Projx update preserves anything between the anchor comments.

## Testing

The component ships with:

- **Unit tests** for handlers, services, repositories — `internal/auth/*_test.go`, etc. Standard Go test pattern.
- **Integration tests** using `testcontainers-go` to spin up a real Postgres per test run. Covers schema migration idempotency, generic CRUD against a sample schema, impersonation token round-trip.
- **HTML smoke tests** via `chromedp` for the HTMX-driven UI. Loads the login page, signs in with a seeded admin, navigates the explorer, edits a row, asserts the audit log entry. Single suite, runs in ~30 seconds.

Test coverage gate: 80% line coverage on `internal/` packages, enforced in CI via `go test -cover ./...`. Same threshold as the rest of the projx-scaffolded components.

## Migration path from current `admin-panel/` template

For new projects: nothing to migrate; they get the new template directly.

For existing projects that have integrated the current Directus template:

1. `projx update` does not auto-migrate (the new component is structurally incompatible — Directus' Docker-only setup vs Go binary)
2. Manual migration: delete the existing `admin-panel/` directory, re-run `projx add admin-panel`, copy any custom Directus extensions over (none expected for memoria)
3. RDS cleanup: `DROP SCHEMA admin_panel CASCADE` if any Directus config snapshot tables exist; new component creates its own `admin_panel` schema

For projects using a hand-rolled admin (memoria's current state — 6,000 LOC of custom admin):

1. Scaffold the new admin-panel into the project via `projx add admin-panel`
2. Configure deny/permissions in `internal/config.go` to match the current admin's exposed surface
3. Reimplement the 3-5 KPI cards from the existing dashboard as Go handlers + templ files in `internal/handlers/dashboards/`
4. Delete the custom admin routes, services, frontend pages, tests
5. Net effect on memoria: ~5,000 LOC of custom admin deleted, replaced by ~50 LOC of config + ~200 LOC of dashboard handlers

## What's explicitly NOT in v1

Listed so the v1 scope stays honest and the temptation to scope-creep is visible:

- **Dashboards as a templating system.** Devs write Go handlers + templ files. No `dashboards.yaml` DSL. Add it in v2 if pattern repeats across 3+ projects.
- **SSO / OIDC.** Email + password + TOTP only. SSO is a future feature overlay (`--admin-sso=google`).
- **Multi-tenancy in the admin panel itself.** v1 assumes one admin team for one project. If two projects share an admin panel (unlikely), spin up two admin panels pointed at two databases.
- **Role-based fine-grained permissions.** v1 has three tiers: `read`, `write`, `none`. Per-row policies, conditional permissions, attribute-based access — all v2+.
- **Visual schema editor.** v1 reads what's in Postgres; doesn't let admins create tables. Schema changes happen via tenant's normal migration flow.
- **File / image upload management.** v1 has CRUD; for blob handling, devs route uploads through the tenant backend.
- **Mobile-responsive UI.** v1 is desktop-first. The HTMX templates degrade reasonably on mobile but aren't optimized for it. Most admin work happens on a desk.
- **i18n.** v1 is English-only. The admin panel is internal, not customer-facing.
- **Email / Slack notifications.** No "the admin made a change, post to #ops". v2 feature.
- **Open-source distribution.** v1 is for Ekarche internal use. If it works across memoria/docusift/argus for ~3 months, then consider extracting and open-sourcing.

## Implementation order

1. **Skeleton + auth + admin user management** — get login + MFA + first admin onboarding working end-to-end against a real Postgres. ~1.5 days.
2. **Generic CRUD** — introspection, list/detail/create/edit/delete handlers, HTMX templates. ~2 days.
3. **Impersonation** — start/stop, token mint, blocklist, banner contract. Including the small patches to fastify/fastapi/express auth plugins. ~1.5 days.
4. **Audit log + viewer** — write hook, viewer page. ~0.5 day.
5. **Bootstrap flow + Dockerfile + nginx integration** — ~0.5 day.
6. **Tests** — unit + integration + smoke. ~1.5 days.
7. **projx CLI integration** — manifest, generation, anchors, update semantics. ~1 day.
8. **Docs** — README in `admin-panel/`, top-level projx component entry, migration guide. ~0.5 day.

**Total: ~9 focused days.** Realistic 2 weeks given context-switching.

## Open questions to resolve before code

1. **DNS automation in `infra/` component.** Should the projx `infra/` component auto-add an `admin.<DOMAIN>` DNS record via Terraform when both `infra` and `admin-panel` are in the components list? Or stay manual (operator adds A record in their DNS provider)? Lean: auto-add when `infra/` is present.
2. **Per-row impersonation start.** From a user row in the explorer, should there be an "Impersonate this user" button that auto-fills the form? Adds a small frontend dependency between explorer and impersonation modules but is the right UX. Lean: yes for v1.
3. **CSRF strategy.** HTMX needs explicit CSRF on form submissions. Plan: double-submit cookie pattern, validated by middleware. Standard, well-tested. No question really, just flagging it.
4. **SMTP for password reset.** If no SMTP configured, password reset is admin-to-admin only (one admin resets another's password and shares the temp credential out-of-band). v1 default: no SMTP required. SMTP becomes a feature overlay (`--admin-smtp=mailtrap` or similar) later.
5. **Rate limiting strategy.** Login endpoint: 5r/m per IP at nginx, plus per-account exponential backoff in code. CRUD endpoints: 60r/s per admin user. Documented in deploy section but not in code yet. Confirm targets before implementing.

Open questions go in a follow-up doc once we start implementing.

## Why this design will succeed where Directus failed

Six explicit ways:

| Directus failure mode                                                                    | How this design avoids it                                                                             |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| "Instant CRUD" needed 60 manual table registrations                                      | Generic CRUD is truly automatic; new tables appear on next page load with `read` default permission   |
| Sub-path mounting was broken                                                             | Subdomain-only by design; documented as the only supported deploy pattern                             |
| YAML config snapshot drift                                                               | Config lives in `internal/config.go` — typed, code-reviewed, no external config language              |
| BSL 1.1 license, runtime vendor dependency                                               | Generated code is owned by the tenant project; no external vendor; all deps MIT/BSD/Apache            |
| Field redaction off by default                                                           | Sensitive column patterns denied by default; tenant must explicitly expose                            |
| Built around an SPA with no server-render fallback                                       | HTMX + server-rendered templ; loads in 80ms, no client-side state machine to debug                    |
| Big runtime footprint (~600MB image, slow cold start)                                    | ~30MB image, ~50ms cold start, ~30MB RSS                                                              |
| Auth integration required impersonating Directus users with no clean tie to tenant users | Impersonation mints a token the tenant's existing auth plugin natively recognizes via a 30-line patch |
