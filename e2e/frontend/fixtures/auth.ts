import { test as base, expect } from '@playwright/test';
import { DashboardPage } from '../pages/dashboard.page';
import { LoginPage } from '../pages/login.page';

const AUTH_ENABLED = process.env.VITE_AUTH_ENABLED !== 'false';
const TEST_USER = process.env.TEST_USER || 'admin';
const TEST_PASS = process.env.TEST_PASS || 'admin';

export type AuthFixtures = {
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  authenticatedPage: DashboardPage;
};

export const test = base.extend<AuthFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },

  authenticatedPage: async ({ page }, use) => {
    await page.goto('/');
    if (AUTH_ENABLED) {
      const login = new LoginPage(page);
      await expect(login.form).toBeVisible();
      await login.usernameInput.fill(TEST_USER);
      await login.passwordInput.fill(TEST_PASS);
      await login.submitButton.click();
    }
    const dashboard = new DashboardPage(page);
    await expect(dashboard.heading).toBeVisible({ timeout: 10000 });
    await use(dashboard);
  },
});

export { expect };
export { AUTH_ENABLED, TEST_USER, TEST_PASS };
