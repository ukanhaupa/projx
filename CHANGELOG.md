# Changelog

All notable changes to projx are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] - 2026-05-16

### Added

- **Multi-ORM scaffolding for Node backends.** `--orm <provider>` accepts `prisma` (default), `drizzle`, `sequelize`, or `typeorm`. All four ship identical runtime surface — CRUD via `registerEntityRoutes`, pagination, equality filters, `ILIKE` search, `order_by` with `-` prefix, bulk operations, and the lifecycle hook contract (`beforeCreate` / `afterCreate` / `beforeUpdate` / `afterUpdate` / `beforeDelete`). ORM-specific scaffolding lives at [cli/src/addons/orms/](cli/src/addons/orms/) — each ORM is a self-contained folder with a `manifest.json` and per-framework overlays; adding a new ORM means adding a new folder.
- **`gen entity` support for Drizzle, Sequelize, and TypeORM.** Each ORM emits a schema/model/entity file, a router wired via anchor insertion, and a CRUD test scaffold.
- **`requiresOrm` field for feature manifests.** Restricts a feature to specific Node ORMs; `applyFeatures` errors before any file I/O if the project's `--orm` isn't compatible. Auth declares `requiresOrm: ["prisma"]`.
- **`scripts/ci-local.sh`** — runs every CI gate locally in parallel. Auto-detects available sections (`cli`, `fastapi`, `fastify`, `express`, `frontend`, `e2e`, `infra`) and supports `changed` (only sections with diff vs origin/main) and named-section invocation.
- **CLI prettier gate.** [cli/.prettierrc](cli/.prettierrc) + `prettier` devDep + `format` / `format:check` scripts. `cli` GitHub Actions job and `ci-local.sh` both run `prettier --check .`.
- **Unified prettier config across templates** — `{semi: true, singleQuote: true, trailingComma: "all", printWidth: 80, tabWidth: 2}` in cli/, fastify/, express/, frontend/, e2e/. Frontend keeps `jsxSingleQuote` + `bracketSameLine` as overrides.
- **`.prettierignore` in every JS/TS template** — covers `node_modules`, `dist`, `coverage`, and lockfiles for all three package managers (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`).

### Fixed

- **Auth feature no longer crashes mid-scaffold on non-Prisma ORMs.** Previously failed with `text patch anchor "// projx-anchor: imports" not found in src/app.ts`. Now errors before any I/O: `Feature "auth" requires --orm prisma (got "drizzle").`
- **TypeORM scaffolds failed typecheck.** `r.create(data as never)` resolved to the array overload, so `r.save()` returned `T[]` which couldn't cast to `Record<string, unknown>`. Switched to `r.create(data as DeepPartial<T>)` (and `items as DeepPartial<T>[]` for bulk) in both Fastify and Express auto-routes.
- **TypeORM shared tsconfig no longer flags `reflect-metadata` in IDE.** Removed redundant `types: [..., "reflect-metadata"]` entry; the side-effect `import 'reflect-metadata'` in `data-source.ts` covers both runtime registration and global type augmentation.
- **Drizzle `gen entity` no longer emits unused imports.** Schema imports are derived from the field types actually used; the always-needed set is just `pgTable`, `uuid`, `timestamp`.
- **Express `gen entity` test path.** Generated tests at `tests/<name>.test.ts` previously imported from `'../../src/...'` (one level above the project root). Fixed to `'../src/...'`.
- **Prettier drift in non-Prisma ORM scaffolds.** Ran the unified config across `cli/src/addons/orms/**` so fresh `--orm drizzle/sequelize/typeorm` scaffolds pass `prettier --check` out of the box.
- **Express `.prettierignore` missing lockfiles.** Plain `prettier --check .` was flagging `pnpm-lock.yaml`. Now all four JS/TS templates ignore all three lockfile names.

### Changed

- README, SKILL.md, CLAUDE.md, and docs/feature-templates.md updated to reflect multi-ORM coverage, the `requiresOrm` manifest field, and the express-as-first-class-backend posture.

[1.7.0]: https://github.com/ukanhaupa/projx/compare/v1.6.5...v1.7.0
