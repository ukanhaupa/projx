# Frontend

React 19 + TypeScript SPA with auto-entity discovery, design token theming, and Playwright E2E tests.

## Quick Start

Prerequisites: Node.js 20+, pnpm 10+ (`corepack enable && corepack prepare pnpm@latest --activate`)

```bash
cp .env.example .env     # set VITE_API_URL
pnpm install
pnpm dev                 # http://localhost:3000
```

## Project Structure

```
src/
├── main.tsx              # Entry — ErrorBoundary > ThemeProvider > ToastProvider > ConfirmProvider > App
├── App.tsx               # Auth gate, entity loading, routing, NotFound route
├── api.ts                # HTTP client (raw, list, get, create, update, delete, bulkCreate, bulkDelete)
├── auth.ts               # OIDC auth (login, token storage, refresh, role helpers)
├── types.ts              # EntityConfig, MetaEntity, MetaField, metaToEntityConfig()
├── theme.tsx             # Light/dark theme context with localStorage persistence
├── index.css             # Design token system (70+ CSS variables)
├── components/
│   ├── Layout.tsx        # Sidebar + content shell with mobile hamburger toggle
│   ├── EntityTable.tsx   # Paginated table with search (400ms debounce), filter, sort, loading spinner, retry on error
│   ├── EntityForm.tsx    # CRUD modal form (text/number/date/datetime/textarea/select/boolean)
│   ├── Toast.tsx         # Toast notification system (useToast hook; success/error/warning/info)
│   ├── ConfirmDialog.tsx # Promise-based confirm dialog (useConfirm hook; danger/primary variants)
│   └── ErrorBoundary.tsx # React class component error boundary with "Go to Dashboard" recovery
├── hooks/
│   ├── useEntity.ts          # Full CRUD state manager for any entity (fetch, paginate, sort, filter, select, bulk ops)
│   ├── useEntityForm.ts      # Form state with validation, field errors, dirty tracking, and submit handling
│   ├── useEntityUrlState.ts  # Syncs page, sort, search, and filter state to URL search params
│   └── useKeyboardShortcuts.ts # Global keyboard shortcuts (Cmd/Ctrl+K to focus search)
├── pages/
│   ├── Login.tsx         # OIDC password grant login with SVG eye toggle for password visibility
│   ├── Dashboard.tsx     # Entity card grid
│   ├── EntityPage.tsx    # Generic CRUD page for any entity (confirm dialog for delete, entity-not-found state)
│   └── NotFound.tsx      # Themed 404 page with link back to dashboard
├── entities/
│   ├── index.ts          # Auto-discovery from backend /_meta (loadEntities, getEntities, applyOverrides)
│   ├── overrides.ts      # Per-entity customization (columns, name, className)
│   └── formatters.ts     # Cell value formatting (dates, booleans, nulls) using MetaField type info
```

E2E tests live at the project root: `e2e/`

## How Auto-Discovery Works

On startup (after authentication, if enabled), `App.tsx` calls `loadEntities()` which fetches `GET /api/v1/_meta` from the backend. This endpoint returns metadata for every registered entity -- columns, field types, constraints, readonly status, and bulk operation support.

`metaToEntityConfig()` in `types.ts` converts each `MetaEntity` into an `EntityConfig`. The conversion:

- Derives the display name from CamelCase (`AuditLog` becomes `Audit Log`)
- Builds column definitions from all fields
- Builds form field definitions from non-auto, non-primary-key fields
- Marks readonly entities as having no form fields (hides create/edit/delete)

`applyOverrides()` in `entities/index.ts` then merges any per-entity customizations from `overrides.ts`.

No frontend entity config files are needed. Add a model to the backend, and the UI appears automatically.

## Customizing an Entity

Edit `src/entities/overrides.ts` to customize how specific entities render:

```typescript
export const entityOverrides: Record<string, Partial<EntityConfig>> = {
  users: {
    name: 'Team Members', // override display name
    columns: [
      // override which columns show
      { key: 'name', label: 'Name', filterable: true },
      { key: 'email', label: 'Email', filterable: true },
      { key: 'role', label: 'Role', filterable: true },
    ],
    className: 'entity-users', // custom CSS class on the page
  },
};
```

For deeper customization (custom form, custom page), create a dedicated route in `App.tsx` that renders your own component for that entity's slug.

### Entity-Specific CSS

Use the `className` override to scope custom styles:

```css
/* in index.css or a separate file */
.entity-users .actions button.danger {
  display: none; /* hide delete for users */
}

.entity-users th:nth-child(3) {
  color: var(--color-primary);
}
```

## Authentication

Authentication uses the OIDC Resource Owner Password Grant flow. The auth module (`src/auth.ts`) handles:

- Login with username/password against the OIDC token endpoint
- Token storage in localStorage with automatic refresh 30s before expiry
- Role extraction from JWT (both realm and client-level roles)
- `hasAnyRole()` helper for role-based access checks
- Auto-logout on failed token refresh

## Hooks

### useEntity

Full CRUD state manager for any `EntityConfig`. Handles data fetching, pagination, sorting, search (400ms debounce), column filters, row selection, and bulk delete. Syncs all state to URL search params via `useEntityUrlState`.

```typescript
const entity = useEntity(config);
// entity.items, entity.loading, entity.error
// entity.search, entity.setSearch
// entity.page, entity.setPage, entity.pageSize, entity.setPageSize
// entity.toggleSort, entity.orderBy, entity.orderDir
// entity.filters, entity.setFilter, entity.clearFilters
// entity.selectedIds, entity.toggleSelect, entity.toggleSelectAll, entity.bulkRemove
// entity.create, entity.update, entity.remove, entity.refresh
```

### useEntityForm

Manages form state for create/edit modals. Tracks values, dirty state, field-level validation, and server-side `ValidationError` field errors.

```typescript
const form = useEntityForm(fields, initialValues, onSubmit);
// form.values, form.setValue, form.dirty, form.saving
// form.fieldErrors, form.error, form.handleSubmit, form.reset
```

### useEntityUrlState

Syncs pagination, sort, search, and filter state to URL query parameters. Used internally by `useEntity`.

### useKeyboardShortcuts

Registers global keyboard shortcuts. Currently supports Cmd/Ctrl+K to focus the search input (skipped when focus is in an input/textarea/select).

## Components

### Toast Notifications

```typescript
import { useToast } from './components/Toast';

const toast = useToast();
toast('Record created', 'success'); // types: success | error | warning | info
```

Toasts auto-dismiss after 4 seconds and support a close button. The exit animation runs for 150ms.

### Confirm Dialog

```typescript
import { useConfirm } from './components/ConfirmDialog';

const confirm = useConfirm();
const ok = await confirm({
  title: 'Delete Record',
  message: 'Are you sure?',
  confirmLabel: 'Delete',
  variant: 'danger', // danger | primary
});
if (ok) {
  /* proceed */
}
```

Promise-based: `confirm()` returns a `Promise<boolean>` that resolves when the user clicks confirm or cancel.

### Error Boundary

Wraps the entire app (outermost provider in `main.tsx`). On unhandled errors, displays the error message with a "Go to Dashboard" recovery button that resets state and navigates to `/`.

### Mobile Sidebar

`Layout.tsx` includes a hamburger button (visible on small screens) that toggles the sidebar open. A backdrop overlay closes it on tap. The sidebar lists all auto-discovered entities as nav links.

## Theming

The entire UI is driven by CSS custom properties defined in `src/index.css`. Override any variable to rebrand:

```css
:root {
  --color-primary: #7c3aed; /* purple brand */
  --color-primary-hover: #6d28d9;
  --font-sans: 'Outfit', sans-serif; /* custom font */
  --radius-md: 8px; /* rounder corners */
}
```

Dark mode is automatic via `[data-theme='dark']`. Users toggle via the UI button. Preference persists in `localStorage`.

### Token Categories

| Category    | Examples                                                                             |
| ----------- | ------------------------------------------------------------------------------------ |
| Colors      | `--color-primary`, `--color-bg`, `--color-text`, `--color-danger`, `--color-success` |
| Typography  | `--font-sans`, `--font-mono`, `--text-base`, `--font-medium`, `--leading-normal`     |
| Spacing     | `--space-1` (4px) through `--space-12` (48px)                                        |
| Borders     | `--radius-sm` through `--radius-full`, `--border-width`                              |
| Shadows     | `--shadow-xs` through `--shadow-xl`                                                  |
| Transitions | `--transition-fast`, `--transition-base`, `--transition-slow`                        |
| Layout      | `--sidebar-w` (240px), `--header-h` (56px), `--content-max-w` (1200px)               |

## API Client

The `api.ts` module provides a typed HTTP client with:

- Automatic Bearer token injection and 401 retry with token refresh
- Typed error classes: `ValidationError` (with field-level errors), `ForbiddenError`, `ConflictError`, `NotFoundError`
- Rate limit handling (429 with Retry-After)
- Paginated list responses with `PaginatedResponse<T>` type

## Testing

### Unit Tests (Vitest)

```bash
pnpm test              # run once
pnpm test:watch        # watch mode
```

Vitest is configured in `vite.config.ts` with jsdom environment. Coverage thresholds are set to 80% for statements, branches, functions, and lines.

### E2E Tests (Playwright)

E2E tests live at the project root (`e2e/`), not inside frontend. Run from the project root:

```bash
cd e2e && npx playwright install chromium   # first time only
cd e2e && npx playwright test
```

### Type Checking

```bash
pnpm typecheck         # tsc --noEmit (not part of build)
```

Type checking is separated from the build for speed. Run it in CI or pre-commit.

## Build

```bash
pnpm build             # ~500ms via Vite + esbuild
```

Output goes to `dist/`. Vite uses esbuild for TypeScript transpilation (no tsc in the build path), so builds are near-instant regardless of codebase size.

## Environment Variables

| Variable              | Default                 | Description       |
| --------------------- | ----------------------- | ----------------- |
| `VITE_API_URL`        | `http://localhost:8000` | Backend base URL  |
| `VITE_OIDC_URL`       | `http://localhost:8080` | OIDC provider URL |
| `VITE_OIDC_REALM`     | `master`                | OIDC realm        |
| `VITE_OIDC_CLIENT_ID` | `frontend`              | OIDC client ID    |

## Scripts Reference

| Script         | Command                                         | Description                      |
| -------------- | ----------------------------------------------- | -------------------------------- |
| `dev`          | `vite`                                          | Start dev server on port 3000    |
| `build`        | `vite build`                                    | Production build to `dist/`      |
| `typecheck`    | `tsc --noEmit`                                  | Type check without emitting      |
| `preview`      | `vite preview`                                  | Preview production build locally |
| `test`         | `vitest run`                                    | Run unit tests once              |
| `test:watch`   | `vitest`                                        | Run unit tests in watch mode     |
| `format`       | `prettier --write 'src/**/*.{ts,tsx,css,json}'` | Format source files              |
| `format:check` | `prettier --check 'src/**/*.{ts,tsx,css,json}'` | Check formatting                 |
| `lint`         | `eslint 'src/**/*.{ts,tsx}'`                    | Lint source files                |
| `lint:fix`     | `eslint --fix 'src/**/*.{ts,tsx}'`              | Lint and auto-fix                |
