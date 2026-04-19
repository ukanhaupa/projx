# Projx -- E2E Tests

Playwright end-to-end tests for the Projx frontend (React + Vite).

## Prerequisites

- Node.js 20+
- The backend (`fastapi/`) and frontend (`frontend/`) projects set up and able to run locally

## Project Structure

```
e2e/
├── frontend/
│   ├── fixtures/          # Test fixtures (auth, entity helpers, custom test fn)
│   │   ├── index.ts       # Re-exports for convenient imports
│   │   ├── auth.ts        # Auth-related constants (TEST_USER, TEST_PASS)
│   │   └── entity.ts      # Entity API helpers and extended test fixture
│   ├── pages/             # Page Object Models
│   │   ├── base.page.ts           # Theme toggle, toasts, axe-core a11y scan
│   │   ├── login.page.ts          # Login form and error handling
│   │   ├── dashboard.page.ts      # Sidebar nav, entity cards, collapse
│   │   ├── entity-list.page.ts    # Table, search, filters, pagination, CRUD
│   │   ├── entity-form.page.ts    # Modal form, dynamic fields, validation
│   │   └── confirm-dialog.page.ts # Confirm/cancel dialogs
│   ├── app.spec.ts            # App shell, sidebar, dashboard cards, 404
│   ├── auth.spec.ts           # Login, logout, protected routes, password toggle
│   ├── theme.spec.ts          # Light/dark toggle, localStorage persistence
│   ├── entity-crud.spec.ts    # Table, create/edit/delete forms, search, sort
│   └── error-states.spec.ts   # API errors, empty states, loading, XSS, keyboard nav
├── playwright.config.ts   # Playwright configuration
└── package.json
```

## Setup

```bash
cd e2e
pnpm install
pnpm exec playwright install chromium
```

To install all configured browsers (Chromium, Firefox, WebKit):

```bash
pnpm install-browsers
```

## Running Tests

```bash
# All frontend tests across all browsers
cd e2e && pnpm exec playwright test

# Chromium only (faster local development)
cd e2e && pnpm test:frontend

# Interactive UI mode (great for debugging)
cd e2e && pnpm test:ui

# Run a specific test file
cd e2e && pnpm exec playwright test auth.spec.ts
```

## Quality Gates

```bash
cd e2e
pnpm format        # Prettier
pnpm lint          # ESLint
pnpm typecheck     # TypeScript
```

## Writing New Tests

### Page Object Pattern

All page interactions go through Page Object Models in `frontend/pages/`. Each POM extends `BasePage`, which provides shared helpers like theme toggling, toast assertions, and axe-core accessibility scanning.

```ts
// frontend/pages/example.page.ts
import { BasePage } from './base.page';

export class ExamplePage extends BasePage {
  readonly heading = this.page.getByRole('heading', { name: 'Example' });

  async goto() {
    await this.page.goto('/example');
  }
}
```

### Using Fixtures

Tests import `test` and `expect` from the local fixtures (not directly from `@playwright/test`). The custom `test` fixture pre-loads entity metadata and provides API helpers for setup/teardown.

```ts
// frontend/my-feature.spec.ts
import { test, expect } from './fixtures';

test('displays entity list', async ({ page, entities }) => {
  // `entities` comes from the custom fixture
});
```

### Adding a New Spec

1. Create `frontend/your-feature.spec.ts`.
2. Import `test` and `expect` from `./fixtures`.
3. Use existing POMs or create a new one in `frontend/pages/`.
4. Keep tests isolated -- use API helpers from fixtures for setup/teardown rather than relying on UI state from other tests.

## Configuration

| Variable    | Default                 | Description                                                                     |
| ----------- | ----------------------- | ------------------------------------------------------------------------------- |
| `BASE_URL`  | `http://localhost:3000` | Frontend URL to test against                                                    |
| `TEST_USER` | `admin`                 | Login username for auth tests                                                   |
| `TEST_PASS` | `admin`                 | Login password for auth tests                                                   |
| `CI`        | --                      | Enables CI mode (1 worker, 2 retries, GitHub reporter, no webServer auto-start) |

In local development, Playwright auto-starts both the backend (`fastapi/`) and frontend (`frontend/`) dev servers via the `webServer` config. In CI, servers are expected to already be running.
