# Feature Templates

Optional, opt-in modules that overlay onto an existing component (e.g. `fastify`, `fastapi`, `frontend`, `mobile`). Triggered by a CLI flag at `create` or `add` time. First feature: `auth`. Future: `billing`, `audit`, `mfa`, etc.

## Goals

- Keep the base templates lean. Anything optional ships as a feature.
- One canonical contract per backend stack. Routes, schemas, env vars, migrations all match across `fastify` and `fastapi` so the frontend/mobile clients don't branch.
- Reusable mechanism. Adding a future feature = drop a folder + manifest, no CLI surgery.
- Multi-instance aware. `--auth=fastify:api` targets a specific instance; without an instance suffix, the first instance of that component.

## Non-goals (v1)

- Cross-stack auto-wiring at runtime. The CLI generates code at scaffold time only — no plugin loader.
- Multi-tenant auth. Single-tenant only in v1.
- SSO/OIDC. Not in this feature.
- Passwordless / OTP-only login. Separate future `--otp` feature.
- Biometric / device pairing. Separate future feature.

## CLI grammar

```
projx create my-app \
  --components fastify,frontend,mobile \
  --auth fastify:api,frontend,mobile

projx add ./my-app fastify --auth fastify:api
```

Flag form: `--<feature>=<target>[:<instance>][,<target>[:<instance>]]...`

- `<target>` is a component (`fastify`, `fastapi`, `frontend`, `mobile`).
- `<instance>` is the path of a specific instance. Optional; defaults to first instance of that component.
- Comma-separated targets within one `--<feature>` flag.
- Validation: each `<target>` must be in `--components`. Each `<instance>` must resolve. Failure exits with `2` and a clear hint.

Mutually-supported set per feature is declared in the feature's manifest.

## Feature directory layout

```
features/<feature>/
  feature.json
  fastify/
    files/                  # ejs templates, mirrored under fastify instance path
    patches/                # JSON patch ops for existing files (e.g. add deps)
    migrations/             # SQL or prisma snippets, applied verbatim
  fastapi/
    files/
    patches/
    alembic/                # alembic revision scripts
  frontend/
    files/
    patches/
  mobile/
    files/
    patches/
```

### `feature.json`

```json
{
  "name": "auth",
  "summary": "Password + JWT auth with email verification, MFA, password reset, sessions",
  "supports": ["fastify"],
  "requires": { "fastify": [] },
  "env": {
    "fastify": [
      "JWT_SECRET", "JWT_ACCESS_TTL", "JWT_REFRESH_TTL",
      "BOOTSTRAP_ADMIN_EMAIL",
      "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM",
      "APP_URL", "AUTH_BACKGROUND_JOBS"
    ]
  },
  "deps": { "fastify": { ... } }
}
```

`requires` validates compatibility — adding auth to the frontend without a backend that ships it = error.

### Patches

A `patches/` file is a small declarative spec, one of:

- `package-json.patch.json` — JSON-merge into target `package.json` (`dependencies`, `scripts`).
- `text.patch.json` — `{ "type": "text", "file": "src/app.ts", "anchor": "// projx-anchor: routes", "insert": "..." }` for known anchor comments.

The base templates ship with anchor comments at integration points:

```ts
// projx-anchor: imports
// projx-anchor: plugins
// projx-anchor: models
```

Patches insert relative to anchors. If an anchor is missing, the patch fails fast with the file + anchor name.

### Apply mechanism

`cli/src/features.ts` exposes:

```ts
applyFeature(feature: string, targets: ResolvedFeatureTarget[], dest: string): Promise<void>
applyFeatures(opts: ApplyFeaturesOptions): Promise<void>
```

Pipeline per target:

1. Resolve instance path.
2. Render `files/**/*.ejs` with `{ inst, projectName, ... }` into `<dest>/<inst.path>/`.
3. Apply each `patches/*` file in alphabetical order.
4. Append `feature.json.env` keys to `<dest>/<inst.path>/.env.example` (commented placeholders).
5. Record applied feature in `<dest>/<inst.path>/.projx-component`.

Idempotent via sentinel comments in patched files.

---

## Auth feature — concrete spec

Reference: docusift `backend/src/modules/auth/` (Fastify, ~1.7k LOC) is production-grade and ships the full set below. We lift that surface verbatim into the `fastify` flavor and mirror it in `fastapi` (reusing ops-pilot's bcrypt+JWT base; writing the verify/reset/mfa/sessions endpoints fresh to match the same contract).

### Route contract (identical on `fastify` and `fastapi`)

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/signup` | public, rate-limited | `{ email, password, first_name, last_name }` | `{ user, verification_required: true }` |
| POST | `/auth/verify-email` | public | `{ token }` | `204` |
| POST | `/auth/resend-verification` | public, rate-limited | `{ email }` | `204` (always) |
| POST | `/auth/login` | public, rate-limited | `{ email, password }` | `{ access_token, refresh_token, user }` or `{ mfa_required, mfa_token }` |
| POST | `/auth/mfa/verify` | mfa-token | `{ mfa_token, code }` | `{ access_token, refresh_token, user }` |
| POST | `/auth/mfa/enroll` | bearer | — | `{ secret, qr_url, recovery_codes }` |
| POST | `/auth/mfa/enroll/verify` | bearer | `{ code }` | `204` |
| POST | `/auth/mfa/disable` | bearer | `{ password, code }` | `204` |
| POST | `/auth/mfa/recovery-codes/regenerate` | bearer | `{ password }` | `{ recovery_codes }` |
| POST | `/auth/forgot-password` | public, rate-limited | `{ email }` | `204` (always) |
| POST | `/auth/reset-password` | public | `{ token, password }` | `204` |
| POST | `/auth/refresh` | public | `{ refresh_token }` | `{ access_token, refresh_token }` |
| POST | `/auth/change-password` | bearer | `{ current, next }` | `204` |
| GET | `/auth/sessions` | bearer | — | `{ sessions: [...] }` |
| POST | `/auth/logout` | bearer | `{ session_id? }` | `204` |
| GET | `/auth/me` | bearer | — | `{ user, role, permissions }` |

Error shape unchanged: `{ detail, request_id }`. Status codes: `401 invalid credentials / refresh / verification`, `403 forbidden`, `409 email already exists / password reuse`, `422 weak password / invalid token`, `429 rate limited`.

Rate limits (auth endpoints only): 5 req/min/IP on signup/login/forgot-password/resend-verification.

### JWT

- Algorithm `HS256`, secret from `JWT_SECRET` (DB-backed via centralized config — env is bootstrap only).
- Access TTL 15m, refresh TTL 7d (configurable).
- Access claims: `sub`, `email`, `role`, `permissions`, `iat`, `exp`.
- Refresh tokens stored hashed (sha256) in `refresh_tokens` table. Logout deletes by `jti`.

### DB schema (new tables)

```
users(id, email UNIQUE, password_hash, first_name, last_name, role_id FK,
      email_verified_at, is_active, mfa_enabled, mfa_secret, mfa_recovery_codes_hash,
      failed_login_attempts, locked_until, created_at, updated_at)
roles(id, name UNIQUE, description, created_at)
permissions(id, code UNIQUE, description)
role_permissions(role_id FK, permission_id FK, PRIMARY KEY)
refresh_tokens(id, user_id FK, token_hash, session_id, expires_at, revoked_at, created_at,
               user_agent, ip)
verification_tokens(id, user_id FK, kind, token_hash, expires_at, consumed_at, created_at)
  -- kind ∈ {'email_verify', 'password_reset', 'mfa_pending'}
```

`refresh_tokens.session_id` powers the `/auth/sessions` listing and per-session logout.

Seed: roles `admin`, `user`. Permissions `users:read`, `users:write` (extensible). One bootstrap admin email comes from `BOOTSTRAP_ADMIN_EMAIL` env (skipped if unset). Bootstrap admin is created with `email_verified_at` set so it can log in immediately.

### Middleware (both backends)

- Bearer token verifier sets `request.user` (or `request.state.user`).
- `requirePermission('users:write')` decorator/plugin returns `403` on miss.
- Routes default to public; any route needing auth opts in.

### Mailer (sub-module of auth)

Reference: docusift `mailer.ts` (306 LOC). Lift verbatim into fastify; mirror in fastapi using `aiosmtplib` + Jinja2 templates.

- Templates: `verify-email.html`, `reset-password.html`. Plain-text fallbacks.
- SMTP creds via the centralized DB-backed config module. Env (`SMTP_HOST/PORT/USER/PASS/FROM`) is bootstrap-only.
- A no-op driver is used in tests and in dev when `SMTP_HOST` is unset — emails get logged instead of sent.

### Verification jobs (sub-module of auth)

Reference: docusift `verification-jobs.ts` (212 LOC). Background worker that:
- expires unconsumed `verification_tokens` past `expires_at`,
- expires unconsumed signups past 7 days,
- revokes refresh tokens past `expires_at`.

Runs on a node-cron / `apscheduler` schedule (1× daily). Disabled via `AUTH_BACKGROUND_JOBS=false`. Off by default in tests.

### Env vars (added to `.env.example`)

All bootstrap-only via env; runtime reads through the centralized DB-backed config module.

| Stack | Var | Purpose |
|---|---|---|
| fastify, fastapi | `JWT_SECRET` | required, 32+ chars |
| fastify, fastapi | `JWT_ACCESS_TTL` | default `15m` |
| fastify, fastapi | `JWT_REFRESH_TTL` | default `7d` |
| fastify, fastapi | `BOOTSTRAP_ADMIN_EMAIL` | optional |
| fastify, fastapi | `SMTP_HOST` | optional (no-op driver if unset) |
| fastify, fastapi | `SMTP_PORT` | default `587` |
| fastify, fastapi | `SMTP_USER` / `SMTP_PASS` | optional |
| fastify, fastapi | `SMTP_FROM` | required if SMTP enabled |
| fastify, fastapi | `APP_URL` | for verify/reset links in emails |
| fastify, fastapi | `AUTH_BACKGROUND_JOBS` | default `true` |

### Tests shipped per feature

- Backend: route tests for every endpoint (happy + error paths), middleware tests for `requirePermission`, repository test for `refresh_tokens` rotation, mailer no-op driver test, verification-jobs test (token expiry), MFA enroll/verify cycle test, rate-limit test.
- Frontend: render tests for each auth page, refresh-interceptor test (mocked 401 → retry), `ProtectedRoute` redirect test, MFA flow render.
- Mobile: widget test for each auth screen, unit tests for `AuthService` (login/signup/verify/refresh/logout/mfa), interceptor test.

All tests count toward the existing 80% coverage thresholds.

---

## Implementation plan

1. ✓ Land the standard, no auth code yet (parser, validator, applier, tests, anchors).
2. ✓ Wire `parseArgs` for `--auth=` form.
3. Build `features/auth/fastify` — lift docusift verbatim, adapt to projx conventions.
4. Build `features/auth/fastapi` — mirror the docusift route contract.
5. Build `features/auth/frontend`.
6. Build `features/auth/mobile`.
7. Update README + `--help` + `cli/src/templates/README.md.ejs`.
8. CHANGELOG entry, version bump (minor — additive).

## Open questions

1. **JWT secret rotation.** Out of scope v1.
2. **Account lockout policy.** Default = 5 attempts → 15-minute window (docusift's behavior).
3. **MFA recovery code count.** Default = 10 (docusift's behavior).
4. **Refresh token rotation strategy.** Rotate every refresh (docusift's behavior).
