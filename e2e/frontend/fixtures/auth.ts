import { createHmac } from 'node:crypto';
import { test as base, expect, type Page } from '@playwright/test';
import { DashboardPage } from '../pages/dashboard.page';
import { LoginPage } from '../pages/login.page';
import { collectCoverage } from './coverage';
import { attachPageErrorTracking } from './page-errors';

const TEST_USER = process.env.TEST_USER || 'admin';
const TEST_PASS = process.env.TEST_PASS || 'admin';

function resolveE2eJwtSecret(): string {
  const secret = process.env.E2E_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'E2E_JWT_SECRET or JWT_SECRET must be set for e2e auth fixtures',
    );
  }
  return secret;
}

const E2E_JWT_SECRET = resolveE2eJwtSecret();

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function issueTokens(subject: string): {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const accessPayload = {
    sub: subject,
    permissions: ['*:*.*'],
    iat: now,
    exp: now + 3600,
  };
  const refreshPayload = {
    sub: subject,
    iat: now,
    exp: now + 86400,
    type: 'refresh',
  };
  return {
    access_token: signJwt(accessPayload, E2E_JWT_SECRET),
    refresh_token: signJwt(refreshPayload, E2E_JWT_SECRET),
    token_type: 'Bearer',
    expires_in: 3600,
  };
}

async function installOidcMock(page: Page): Promise<void> {
  await page.route('**/protocol/openid-connect/token', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }

    const form = new URLSearchParams(route.request().postData() ?? '');
    const grantType = form.get('grant_type');

    if (grantType === 'password') {
      const username = form.get('username') ?? '';
      const password = form.get('password') ?? '';
      if (username === TEST_USER && password === TEST_PASS) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(issueTokens(username)),
        });
        return;
      }
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Invalid credentials',
        }),
      });
      return;
    }

    if (grantType === 'refresh_token') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(issueTokens(TEST_USER)),
      });
      return;
    }

    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'unsupported_grant_type',
      }),
    });
  });
}

export type AuthFixtures = {
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  authenticatedPage: DashboardPage;
};

export const test = base.extend<AuthFixtures>({
  page: async ({ page }, use, testInfo) => {
    await installOidcMock(page);
    const assertNoPageErrors = attachPageErrorTracking(page, testInfo);
    await use(page);
    await collectCoverage(page);
    assertNoPageErrors();
  },

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },

  authenticatedPage: async ({ page }, use) => {
    await page.goto('/');
    const login = new LoginPage(page);
    await expect(login.form).toBeVisible();
    await login.usernameInput.fill(TEST_USER);
    await login.passwordInput.fill(TEST_PASS);
    await login.submitButton.click();
    const dashboard = new DashboardPage(page);
    await expect(dashboard.heading).toBeVisible({ timeout: 10000 });
    await use(dashboard);
  },
});

export { expect };
export { TEST_USER, TEST_PASS };
