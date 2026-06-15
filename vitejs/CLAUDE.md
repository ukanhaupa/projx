# frontend — React / Vite frontend (projx template)

> Stack-scoped notes. The root [`../CLAUDE.md`](../CLAUDE.md) carries cross-cutting standards — read both, they compose.
>
> This directory is a **projx template**: a working SPA whose own suite must stay green on the projx repo (root §"Per-template gates") **and** the source the CLI copies into scaffolded projects.

## Stack

- **Framework** — React (function components + hooks), TypeScript strict
- **Build** — Vite; `react-router.config.ts` present
- **Routing** — `react-router-dom`
- **State** — React Context (theme, toast, confirm); no Redux, no TanStack Query
- **Data** — one fetch wrapper in `src/api.ts` — never `fetch` direct from components
- **Styling** — CSS custom properties / design tokens in `src/index.css`. **No Tailwind, no raw hex/px** (root §"CSS discipline")
- **Test** — Vitest + React Testing Library + jsdom. **Tests live in `tests/`, not `src/`**
- **Package manager** — pnpm

## Layout

| Path                                                         | What it holds                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `src/main.tsx`                                               | DOM mount + provider tree (below)                                                                            |
| `src/App.tsx`                                                | Router / route definitions                                                                                   |
| `src/api.ts`                                                 | The only place `fetch` is called — Bearer header, `{ detail, request_id }` error normalization, 401 handling |
| `src/auth.ts`                                                | JWT decode / `isAuthenticated` (module, not a context provider)                                              |
| `src/theme.tsx`                                              | `ThemeProvider` — `data-theme` on `<html>`, localStorage, `prefers-color-scheme`                             |
| `src/index.css`                                              | Design tokens (light + dark), resets                                                                         |
| `src/components/`                                            | `Layout`, `Toast`, `ConfirmDialog`, `ErrorBoundary`, `ErrorScaffold`                                         |
| `src/pages/`                                                 | `Dashboard`, `Login`, `NotFound`                                                                             |
| `tests/`                                                     | `*.test.ts(x)` + `test-setup.ts` — mirrors `src/`                                                            |
| `nginx.conf`, `security-headers.inc`, `docker-entrypoint.sh` | Prod container serving config                                                                                |
| `scripts/check-bundle-size.sh`                               | Bundle-size budget gate                                                                                      |

## Provider tree — assembled at the mount (verified)

`src/main.tsx` nests: `ThemeProvider → ToastProvider → ConfirmProvider`. Order matters (toast needs theme; confirm needs toast). Auth is a module (`src/auth.ts`), not a provider. Add a provider? Slot it at the right depth.

## Conventions

- **API**: pages/hooks call typed wrappers in `src/api.ts`; new endpoints add a wrapper there, never an inline `fetch`. Errors are the backend's `{ detail, request_id }` shape — surface `request_id` in error UI for support.
- **CSS**: component styles read tokens only (`var(--…)`). Both themes, all breakpoints, zero raw values. `scripts/style-check.py` (repo root `scripts/`) lints raw `background`/`color` values + raw element selectors.
- **A11y**: semantic HTML, visible focus rings, ARIA on icon buttons, WCAG AA contrast in both themes.
- **Theme**: switches by toggling `[data-theme]`; dark is a distinct register, not inverted colors.

## Testing — `tests/`, never `src/`

Co-located tests under `src/` were migrated out to fix [issue #12](https://github.com/ukanhaupa/projx/issues/12) — **never re-introduce them.** Query by role/label/text, not class or test-id. Unit + component here; goldens + E2E live in the sibling `e2e/` (root §"Test pyramid").

## Quality gates (root §"Per-template gates")

`pnpm format` (prettier) → `pnpm lint` (eslint) → `pnpm typecheck` (`tsc --noEmit`) → `pnpm test` (vitest, v8 ≥80%) → `pnpm build` → `scripts/check-bundle-size.sh`. Green or not done; no `src/` excludes.
