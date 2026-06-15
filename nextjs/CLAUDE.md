# nextjs — React / Next.js frontend (projx template)

> Stack-scoped notes. The root [`../CLAUDE.md`](../CLAUDE.md) carries cross-cutting standards — read both, they compose.
>
> This directory is a **projx template**: a working SPA-style app whose own suite must stay green on the projx repo (root §"Per-template gates") **and** the source the CLI copies into scaffolded projects. It mirrors `vitejs/` feature-for-feature but idiomatic to the App Router; `vitejs` remains the default frontend.

## Stack

- **Framework** — React 19 + Next.js (App Router), TypeScript strict
- **Build** — `next build` with `output: 'standalone'` (containerized `node server.js`)
- **Auth** — OIDC token flow (`src/lib/auth.ts`); request-path-only refresh with one shared in-flight lock (no timer)
- **Config** — DB-backed runtime config via server-injected `window.__RUNTIME_CONFIG__` (`src/lib/runtime-config*.ts`); env bootstrap-only, no `NODE_ENV` branching
- **Errors** — `ErrorScaffold` wired into route-level `error.tsx` / `global-error.tsx` / `not-found.tsx`; API client parses `{detail, request_id}`
- **Monitoring** — `@sentry/nextjs` (DSN-from-env gated), `instrumentation*.ts` + `sentry.*.config.ts`
- **Test** — Vitest + v8 coverage; E2E coverage via SWC instrument (`NEXT_COVERAGE`)

## Layout

| Path                | What it holds                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`          | App Router: `layout.tsx`, `page.tsx`, `login/`, `error.tsx`, `global-error.tsx`, `not-found.tsx`, `globals.css`             |
| `src/middleware.ts` | Edge auth gating                                                                                                            |
| `src/lib/`          | `api.ts`, `auth.ts`, `runtime-config.ts`, `runtime-config-script.ts`, `sentry.ts`, `types.ts`                               |
| `src/components/`   | `AuthProvider`, `Providers`, `ThemeProvider`, `Layout`, `Toast`, `ConfirmDialog`, `ErrorScaffold`, `Dashboard`, `LoginForm` |
| `tests/`            | Vitest suites (mirror `src/`, never co-located under `src/`)                                                                |
| `next.config.ts`    | `output: 'standalone'`, security headers via `headers()`                                                                    |
| `Dockerfile.ejs`    | Multi-stage standalone build                                                                                                |

## Quality gates (root §"Per-template gates")

`pnpm format:check` (prettier) → `pnpm lint` (eslint flat config) → `pnpm typecheck` (`tsc --noEmit`) → `pnpm build` (`next build`) → `pnpm test` (vitest, v8 ≥80%). Locally `bash ../scripts/ci-local.sh nextjs`.

## Things that bite

- **Tests live in `tests/`, not co-located under `src/`** — same rule as the other JS templates.
- **`NEXT_PUBLIC_` vars** are the only env exposed to the client; runtime config is server-injected, not build-time inlined — don't reach for `process.env` in client components.
- **OIDC env required at runtime**: the auth module fails loud without its OIDC config — CI/tests provide it (see the vitejs `VITE_OIDC_*` precedent; nextjs uses `NEXT_PUBLIC_OIDC_*`).
- **Standalone Docker** serves `node server.js` on port 3000 — no nginx/certbot (unlike `vitejs`).
