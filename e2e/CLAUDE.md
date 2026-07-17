# e2e — Playwright E2E (projx template)

> Stack-scoped notes. The root [`../CLAUDE.md`](../CLAUDE.md) carries the TDD discipline — read both, they compose.
>
> This directory is a **projx template**: it must stay green on the projx repo (root §"Per-template gates") **and** is copied into scaffolded projects. It drives the real `frontend/` against a real backend — it does **not** replace the backends' own integration tests.

## Stack

- **Framework** — `@playwright/test` on TypeScript
- **A11y** — `@axe-core/playwright`
- **Package manager** — pnpm
- **Config** — `playwright.config.ts`

## Layout & config (verified)

| Path                                               | What it holds                                  |
| -------------------------------------------------- | ---------------------------------------------- |
| `playwright.config.ts`                             | `testDir: './frontend'`, projects, `webServer` |
| `frontend/`                                        | The spec tree (the configured `testDir`)       |
| `eslint.config.js`, `tsconfig.json`, `.prettierrc` | Tooling                                        |

- **Projects** — three browsers: `chromium`, `firefox`, `webkit`.
- **`webServer`** — booted **only locally** (`process.env.CI ? undefined : localWebServers()`); CI runs against an already-running/external backend + frontend. Don't add a `sleep` — wait on the health endpoint. It resolves the frontend + backend **sibling directories from their `.projx-component` markers** at load time (`resolveSibling`) and picks the boot command by backend kind — never hard-code `../frontend` / `../fastapi` (root [`../CLAUDE.md`](../CLAUDE.md) §"Never hard-code a component directory").

## Conventions

- **Assert end-state, not implementation** — verify the row appears, not that a POST fired. Mock-free.
- **No `page.waitForTimeout(...)`** — wait on a visible element or network signal.
- Query by **role / label / text**, never `data-testid` unless nothing else works.
- **No `NODE_ENV === 'test'` branches in app code** — tests exercise the production path; behavior diverges via injected config, never env-name checks (root §"No env-name checks").
- Auth via the real endpoint or a backend test helper — never a hardcoded JWT.

## Scripts / gates (root §"Per-template gates")

- `pnpm test` → `playwright test` (full matrix) · `pnpm test:frontend` → `--project=chromium` (fast loop) · `pnpm test:ui` → `--ui` · `pnpm install-browsers` → install chromium/firefox/webkit.
- Gate: `pnpm format` (prettier) → `pnpm lint` (eslint) → `pnpm typecheck` (`tsc --noEmit`). No coverage gate here (the suite is the assertion).
