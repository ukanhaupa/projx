# Changelog

All notable changes to projx are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.2] - 2026-05-20

### Added

- **`scripts/check-bundle-size.sh`** ships with every scaffold — frontend chunks over budget fail the build. Defaults: initial entry chunks ≤ 500KB, async chunks ≤ 800KB; override via `BUNDLE_BUDGET_INITIAL_KB` / `BUNDLE_BUDGET_ASYNC_KB`. Backed by `scripts/check-bundle-size.test.sh` (7 assertions). [cli.yml.ejs:287](cli/src/templates/ci.yml.ejs#L287) was already invoking this script, but the file wasn't being copied — every `--components frontend` scaffold shipped a broken CI step.
- **`sec_secrets` in `scripts/ci-local.sh`** — runs gitleaks against tracked + untracked, honouring the project's `.gitleaks.toml`. Always-on in the section dispatch; gracefully skips with a warning if `gitleaks` isn't installed.
- **`sec_e2e` opt-in real-backend boot** — set `E2E_REAL_BACKEND=1` to make ci-local detect a sibling `fastify/` or `express/`, boot it via `tsx src/server.ts`, wait on `/api/health`, then run the full Playwright matrix. Configurable via `E2E_BACKEND_PORT` (default 3000) and `E2E_HEALTH_PATH` (default `/api/health`). Without the flag, behaviour is unchanged (typecheck-only).
- **`sec_frontend` bundle-size step** — runs `scripts/check-bundle-size.sh` after build if `frontend/dist/assets/` exists.
- **`sec_scripts` in `scripts/ci-local.sh`** — picks up every `scripts/*.test.sh` and runs it. `check-bundle-size.test.sh` is the first occupant; future shell-script tests drop into the same glob without further wiring.
- **Regression test for `pm.exec → undefined` rendering** in [cli/tests/utils.test.ts](cli/tests/utils.test.ts) — asserts template-literal ternaries that reference `pm.exec` resolve to the real value and never produce the literal string `undefined`. Runs across all four package managers via `describe.each(ALL_PMS)`.
- **Defensive guard in `evalExpr`** — throws with a clear message if `vars.pm` is passed as a bare string. Catches the same class of bug at call-time instead of producing silently-broken output.

### Fixed

- **`pm.exec` rendering as the literal string `undefined` in scaffolded READMEs.** The internal `evalExpr` ([cli/src/utils.ts:551](cli/src/utils.ts#L551)) was rebinding `pm` to the package-manager name string instead of the full `PmCommands` object. Template-literal ternaries that referenced `pm.exec` inside backticks therefore resolved `pm.exec` to `"npm".exec` = `undefined`, producing lines like `... npm install && undefined prisma migrate dev && npm run dev` in every scaffold's quickstart. Simple `pm.install` references used a different fast-path and worked correctly, which is why this slipped through. Fix: pass the full `PmCommands` object into evaluated expressions and update templates to compare `pm.name === 'pnpm'` (etc.) instead of `pm === 'pnpm'`.
- **`scripts/ci-local.sh` was silencing coverage** with `--coverage.enabled=false` for every JS component, so the 80% thresholds declared in each template's `vitest.config.ts` weren't enforced anywhere. Flipped to `vitest run --coverage`. Combined with the express CI change below, ci-local is now the canonical gate before push.
- **Scaffolded express CI step `vitest run --coverage.enabled=false`** removed — it was running tests without enforcing the thresholds. Sibling model picked: scaffolded CI does lint/typecheck/build/audit, ci-local runs tests with coverage pre-push.
- **`sec_e2e` would orphan its backend on Ctrl-C and never resolve `pm_exec`.** `start_background` was called inside a subshell, so the parent's `LAST_PID` / `PIDS` arrays never saw the e2e backend — the script-level cleanup trap couldn't kill it, and even the explicit `kill "$backend_pid"` at end-of-function targeted a stale or empty PID. Separately, `setsid pm_exec tsx …` was passing a shell function (`pm_exec`) to a binary (`setsid`), which couldn't resolve it. Both fixed: `start_background` now runs in the function's own scope (PID propagates), and the daemon command is wrapped as `bash -c "$(declare -f pm_exec detect_pm); pm_exec …"` so `setsid` invokes `bash` (real binary) which then resolves the function. Cleanup also upgraded to process-group kill with TERM→KILL fallback.
- **Pre-commit infra block was `fmt`-only.** Both [.githooks/pre-commit](.githooks/pre-commit) and [cli/src/templates/pre-commit.ejs](cli/src/templates/pre-commit.ejs) now run `terraform validate` + `tflint --recursive` + `trivy config --severity HIGH,CRITICAL` after format, gated on `command -v` so missing binaries don't block commits. `terraform init` is cached with `[ -d .terraform ] || init …` so the hook doesn't re-download providers on every `.tf` edit.
- **`idna` bumped 3.13 → 3.15** (CVE-2026-45409 — DNS label length DoS). Transitive via `anyio` + `httpx` in [fastapi/uv.lock](fastapi/uv.lock). Dependabot PR #49.

### Changed

- **Gitleaks allowlist extended** in [.gitleaks.toml](.gitleaks.toml) for build artefacts (`*/dist/*`), Terraform module cache (`*/.terraform/*`), local environment files (`.env.{local,dev,staging,prod}`), Terraform `random_password.X.result` references, Kubernetes secret-reference field names (`passwordSecretKey`, `existingSecretPasswordKey`), and auth-feature test fixtures. The auth-test allowlist is intentionally broad — review new files added there for real secrets before commit; pragma markers (`# pragma: allowlist secret`) remain the per-line opt-out.
- **`pip-audit` ignores `PYSEC-2025-183`** (`CVE-2025-45768`, "pyjwt weak encryption") across [scripts/ci-local.sh](scripts/ci-local.sh), [.github/workflows/ci.yml](.github/workflows/ci.yml), and [cli/src/templates/ci.yml.ejs](cli/src/templates/ci.yml.ejs). The advisory is **disputed by the pyjwt maintainer** — key length is the application's responsibility, and projx supplies `JWT_SECRET` from the encrypted `service_configs` DB table (or env at bootstrap). No fix version exists upstream. Joins the existing `CVE-2026-3219` ignore.

## [1.7.1] - 2026-05-18

### Added

- **Auth feature ported across the full backend × ORM matrix.** 9 ports total: `fastify` and `express` each on `prisma` / `drizzle` / `sequelize` / `typeorm`, plus `fastapi`. Every port ships email/password + JWT with refresh-token rotation and replay detection, MFA (TOTP + recovery codes), email verification, password reset, account lockout, and the background-cleanup cron — all using the same external contract.
- **Nested `common/` + `<orm>/` layout for stack-scoped features.** [cli/src/features.ts](cli/src/features.ts) now loads `features/<name>/<stack>/common/{files,patches}` (shared across ORMs) first, then `features/<name>/<stack>/<orm>/{files,patches}` (ORM-specific overrides) on top. Same-named patches in `<orm>/` win over `common/`. Flat `<stack>/{files,patches}` (legacy) still works.
- **Express base now ships auth primitives** — [express/src/lib/crypto.ts](express/src/lib/crypto.ts), [express/src/lib/service-config.ts](express/src/lib/service-config.ts), [express/src/middlewares/authenticate.ts](express/src/middlewares/authenticate.ts), [express/src/middlewares/authz.ts](express/src/middlewares/authz.ts), [express/src/types.d.ts](express/src/types.d.ts), `JWT_SECRET` + `CRED_ENCRYPTION_KEY` in `envSchema`, and `// projx-anchor: imports` / `// projx-anchor: plugins` in `src/app.ts`. Mirrors fastify's hardening surface.
- **`features/auth/fastapi/pyproject.toml`** — scopes ruff to `line-length = 120` so format-checking the source template under `features/auth/fastapi/files/` produces the same output as the scaffolded fastapi project.
- **ORM-agnostic mailer** — `initMailer` now takes a `getSmtpConfig: () => Promise<...>` callback instead of a Prisma client, so the same mailer file is shared across all 4 Node ORMs.
- **`gen` accepts `--local <path>`** when invoked from a scaffolded project, mirroring the create-time flag — used by the test matrix to exercise generators without a fetch.

### Fixed

- **`update` / `diff` / `add` no longer crash on non-prisma ORMs** when `.projx-component` skips `package.json`. [cli/src/baseline.ts:713-717](cli/src/baseline.ts#L713-L717) `applyOrmAddon` now guards the `readJsonObject(packageJson)` call with `existsSync` — addon source files still get copied, package.json overrides are skipped when the file is absent (which is the expected post-scaffold state for components that own their package.json).
- **fastapi auth test reformatted at line-length 120.** Previously formatted at ruff's default 88 chars, so `ruff format --check` failed inside a scaffolded fastapi project (which uses 120). The new feature-local `pyproject.toml` keeps source and scaffold consistent.
- **fastify auth feature layout normalized to match express.** Renamed `features/auth/fastify/{files,patches}` → `features/auth/fastify/common/{files,patches}`; moved prisma-specific `routes.ts` / `session.ts` / `verification-jobs.ts` + `03-app-plugins` / `04-prisma-models` patches under `features/auth/fastify/prisma/`. Same convention now across all three stack scopes.

### Changed

- **`features/auth/feature.json` broadened** — `supports: ["fastify", "fastapi", "express"]`, `requiresOrm: ["prisma", "drizzle", "sequelize", "typeorm"]`, with per-stack `env` keys (fastify/express: `JWT_SECRET`, `FRONTEND_URL`, `AUTH_BACKGROUND_JOBS`; fastapi adds `JWT_ALGORITHMS`, `MFA_ISSUER`, `AUTH_CLEANUP_INTERVAL_SECONDS`).
- **ORM addons relocated** from `cli/src/addons/orms/` to repo-root `addons/orms/`. CLI bundle on npm ships only `cli/dist/` + `cli/src/templates/`; addons are pulled at scaffold-time and `gen`-time from the projx repo tarball — same model as `features/` and the base templates. Adding a new ORM no longer touches the CLI source layout. `cli/tsconfig.json` and `cli/vitest.config.ts` exclude `addons/` accordingly.
- **CLAUDE.md, README, docs/feature-templates.md** updated to reflect the matrix layout, the loader's `common/` + `<orm>/` convention, and the relocated addon root.

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

[1.7.1]: https://github.com/ukanhaupa/projx/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/ukanhaupa/projx/compare/v1.6.5...v1.7.0
