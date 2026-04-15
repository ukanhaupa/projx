import { test, expect } from './fixtures';
import { LoginPage } from './pages/login.page';

test.describe('App Shell', () => {
  test('shows login page on initial visit', async ({ page }) => {
    await page.goto('/');
    const login = new LoginPage(page);
    await expect(login.form).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
  });

  test('skip link is present and points to main content', async ({
    authenticatedPage,
  }) => {
    await expect(authenticatedPage.skipLink).toHaveAttribute(
      'href',
      '#main-content',
    );
  });

  test('sidebar shows all entity links from meta', async ({
    authenticatedPage,
    meta,
  }) => {
    test.skip(meta.length === 0, 'No entities discovered');
    for (const entity of meta) {
      const slug = entity.api_prefix.replace(/^\//, '');
      await expect(
        authenticatedPage.sidebar.locator(`a[href="/${slug}"]`),
      ).toBeVisible();
    }
  });

  test('sidebar collapse toggle works', async ({ authenticatedPage }) => {
    await authenticatedPage.toggleSidebar();
    await expect(
      authenticatedPage.page.getByRole('button', {
        name: /expand sidebar/i,
      }),
    ).toBeVisible();
    await authenticatedPage.toggleSidebar();
    await expect(
      authenticatedPage.page.getByRole('button', {
        name: /collapse sidebar/i,
      }),
    ).toBeVisible();
  });

  test('dashboard shows a card for every entity', async ({
    authenticatedPage,
    meta,
  }) => {
    test.skip(meta.length === 0, 'No entities discovered');
    await authenticatedPage.expectEntityCardCount(meta.length);
  });

  test('404 page shown for non-existent route', async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.page.goto('/non-existent-entity-slug-xyz');
    await expect(
      authenticatedPage.page.getByRole('heading', { name: 'Page Not Found' }),
    ).toBeVisible();
    await expect(
      authenticatedPage.page.getByRole('link', { name: 'Back to Dashboard' }),
    ).toBeVisible();
  });
});
