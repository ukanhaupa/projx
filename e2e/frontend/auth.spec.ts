import { test, expect, TEST_USER, TEST_PASS } from './fixtures';
import { LoginPage } from './pages/login.page';

test.describe('Authentication Flow', () => {
  test('login with valid credentials redirects to dashboard', async ({
    loginPage,
  }) => {
    await loginPage.goto();
    const dashboard = await loginPage.login(TEST_USER, TEST_PASS);
    await expect(dashboard.heading).toBeVisible();
  });

  test('login with invalid credentials shows error', async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.loginExpectingError('wrong-user', 'wrong-pass');
    await expect(loginPage.errorAlert).toBeVisible();
  });

  test('accessing protected route without auth redirects to login', async ({
    page,
  }) => {
    await page.goto('/some-entity');
    const login = new LoginPage(page);
    await expect(login.form).toBeVisible();
  });

  test('password visibility toggle works', async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.passwordInput.fill('secret');

    const inputType = async () => loginPage.passwordInput.getAttribute('type');

    expect(await inputType()).toBe('password');
    await loginPage.togglePasswordVisibility();
    expect(await inputType()).toBe('text');
    await loginPage.togglePasswordVisibility();
    expect(await inputType()).toBe('password');
  });

  test('logout returns to login page', async ({ authenticatedPage }) => {
    await authenticatedPage.logout();
    const login = new LoginPage(authenticatedPage.page);
    await expect(login.form).toBeVisible();
  });

  test('username input is focused on page load', async ({ loginPage }) => {
    await loginPage.goto();
    await expect(loginPage.usernameInput).toBeFocused();
  });
});
