import { test, expect } from './fixtures';

test.describe('Theme Switching', () => {
  test('toggle switches between light and dark on login page', async ({
    loginPage,
  }) => {
    await loginPage.goto();

    const initial = await loginPage.getTheme();
    await loginPage.toggleTheme();
    const toggled = await loginPage.getTheme();
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
