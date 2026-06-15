# create-projx

Scaffold production-grade fullstack projects in seconds. FastAPI, Fastify, Express, Go, React, Flutter, Terraform — with auth, database, CI/CD, E2E tests, and Docker. One command, ready to deploy.

```bash
npx create-projx my-app
```

Interactive prompts pick components, package manager, and ORM. Or pass flags:

```bash
npx create-projx my-app --components fastify,frontend,e2e --orm drizzle
```

## Features

Opt-in modules layered on top of components via `--<feature>=<targets>`. Today, one ships: **auth**.

```bash
# Fastify + Prisma
npx create-projx my-app --components fastify --auth fastify

# Express + Drizzle
npx create-projx my-app --components express --orm drizzle --auth express

# FastAPI + SQLAlchemy
npx create-projx my-app --components fastapi --auth fastapi
```

`--auth` ships:

- Email + password signup — first user auto-promoted to admin
- Login with JWT access tokens and refresh-token rotation with replay detection
- Account lockout after 5 failed logins (15-minute cooldown)
- MFA via TOTP authenticator app — enroll, verify, disable
- MFA recovery codes — generate, single-use consume, regenerate
- Password reset via emailed single-use token (30-minute TTL)
- Email verification with resend (24-hour TTL token)
- Authenticated password change — revokes all other sessions
- Active session listing
- Current-user lookup via `/me`, role-based permissions in the JWT
- SMTP mailer — falls back to logging the link when SMTP is unset
- Cron-driven cleanup of expired tokens (`AUTH_BACKGROUND_JOBS`)
- Centralized error responses with `request_id` propagation

Sixteen endpoints. Same external contract on every backend — mounted at `/auth/*` on fastify and express, `/api/v1/auth/*` on fastapi.

**Compatibility:** `fastify` and `express` work with Prisma, Drizzle, Sequelize, and TypeORM. `fastapi` uses its own SQLAlchemy + Alembic stack. Comma-separable targets — `--auth fastify,express` applies to both in one project.

Full spec in [docs/feature-templates.md](../docs/feature-templates.md).

## Components

- `fastify` — Fastify + Prisma (or Drizzle / Sequelize / TypeORM) backend with auto-CRUD entity registry, JWT auth primitives, encrypted service-config table, request_id error envelope.
- `express` — Same surface on Express 5.
- `fastapi` — FastAPI + SQLAlchemy + Alembic backend with identical external contract.
- `go` — Chi + GORM backend with auto-CRUD entity registry, request_id error envelope, soft-delete, and the same lifecycle-hook contract. M1 base only — no `--auth` feature yet.
- `frontend` — React + Vite + TypeScript with type-sync against any backend instance.
- `mobile` — Flutter app with auth, FCM, Isar, theming, Fastlane.
- `e2e` — Playwright end-to-end tests pre-wired against the scaffolded stack.
- `infra` — Terraform modules for AWS deploys.

Mix any subset; every project ships docker-compose, GitHub Actions CI, pre-commit hooks, and ≥80% coverage gates.

## Commands

```bash
npx create-projx <name>             # create a new project
npx create-projx update             # pull template updates into an existing project
npx create-projx add <component>    # add a component to an existing project
npx create-projx gen entity <name>  # generate a full CRUD entity end-to-end
npx create-projx doctor             # health-check an existing project
npx create-projx --help             # full flag reference
```

## Documentation

Full docs, ORM matrix, gen-entity DSL, and contribution guide: https://github.com/ukanhaupa/projx

## License

MIT
