import { test, expect, AUTH_ENABLED } from './fixtures';
import { LoginPage } from './pages/login.page';

test.describe('Theme Switching', () => {
  test('toggle switches between light and dark on login page', async ({
    page,
  }) => {
    test.skip(!AUTH_ENABLED, 'Auth disabled — login page not shown');
    const login = new LoginPage(page);
    await login.goto();

    const initial = await login.getTheme();
    await login.toggleTheme();
    const toggled = await login.getTheme();
    expect(toggled).not.toBe(initial);
    expect(['light', 'dark']).toContain(toggled);
  });

  test('toggle switches between light and dark on dashboard', async ({
    authenticatedPage,
  }) => {
    const initial = await authenticatedPage.getTheme();
    await authenticatedPage.toggleTheme();
    const toggled = await authenticatedPage.getTheme();
    expect(toggled).not.toBe(initial);
    expect(['light', 'dark']).toContain(toggled);
  });

  test('theme persists across page reload', async ({ authenticatedPage }) => {
    await authenticatedPage.toggleTheme();
    const theme = await authenticatedPage.getTheme();

    await authenticatedPage.page.reload();
    await expect(authenticatedPage.page.locator('html')).toHaveAttribute(
      'data-theme',
      theme!,
    );
  });

  test('theme is stored in localStorage', async ({ authenticatedPage }) => {
    await authenticatedPage.toggleTheme();
    const theme = await authenticatedPage.getTheme();
    const stored = await authenticatedPage.page.evaluate(() =>
      localStorage.getItem('theme'),
    );
    expect(stored).toBe(theme);
  });
});
