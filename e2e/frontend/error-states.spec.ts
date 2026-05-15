import { test, expect, fetchEntities, allowPageErrors } from './fixtures';
import { EntityListPage } from './pages/entity-list.page';
import type { MetaEntity } from './fixtures';

let entities: MetaEntity[] = [];

test.beforeAll(async () => {
  entities = await fetchEntities();
});

test.describe('Error States and Edge Cases', () => {
  test.describe('API Error Handling', () => {
    test('shows error and retry button on server error', async ({
      authenticatedPage,
    }, testInfo) => {
      allowPageErrors(testInfo, /response .*HTTP 500/);
      test.skip(entities.length === 0, 'No entities discovered');
      const entity = entities[0];
      const slug = entity.api_prefix.replace(/^\//, '');

      await authenticatedPage.page.route(
        `**/api/v1${entity.api_prefix}*`,
        (route) =>
          route.fulfill({ status: 500, body: 'Internal Server Error' }),
      );

      const listPage = new EntityListPage(authenticatedPage.page, entity.name);
      await listPage.goto(slug);
      await expect(listPage.errorAlert).toBeVisible();
      await expect(listPage.retryButton).toBeVisible();
    });

    test('retry button refetches data', async ({
      authenticatedPage,
    }, testInfo) => {
      allowPageErrors(testInfo, /response .*HTTP 500/);
      test.skip(entities.length === 0, 'No entities discovered');
      const entity = entities[0];
      const slug = entity.api_prefix.replace(/^\//, '');

      let callCount = 0;
      await authenticatedPage.page.route(
        `**/api/v1${entity.api_prefix}*`,
        (route) => {
          callCount++;
          if (callCount === 1) {
            return route.fulfill({ status: 500, body: 'Error' });
          }
          return route.continue();
        },
      );

      const listPage = new EntityListPage(authenticatedPage.page, entity.name);
      await listPage.goto(slug);
      await expect(listPage.errorAlert).toBeVisible();

      await listPage.retryButton.click();
      await expect(listPage.errorAlert).toBeHidden();
    });
  });

  test.describe('Empty States', () => {
    test('shows empty state when no records exist', async ({
      authenticatedPage,
    }) => {
      test.skip(entities.length === 0, 'No entities discovered');
      const entity = entities[0];
      const slug = entity.api_prefix.replace(/^\//, '');

      await authenticatedPage.page.route(
        `**/api/v1${entity.api_prefix}*`,
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              data: [],
              pagination: { total_records: 0, page: 1, page_size: 10 },
            }),
          }),
      );

      const listPage = new EntityListPage(authenticatedPage.page, entity.name);
      await listPage.goto(slug);
      await expect(listPage.emptyState).toBeVisible();
    });

    test('shows empty filter message when filters match nothing', async ({
      authenticatedPage,
    }) => {
      test.skip(entities.length === 0, 'No entities discovered');
      const entity = entities[0];
      const slug = entity.api_prefix.replace(/^\//, '');

      const listPage = new EntityListPage(authenticatedPage.page, entity.name);
      await listPage.goto(slug);
      await listPage.searchInput.fill('zzz-definitely-no-match-zzz');
      await expect(listPage.emptyState).toBeVisible();
    });
  });

  test.describe('Loading States', () => {
    test('shows skeleton rows while loading', async ({ authenticatedPage }) => {
      test.skip(entities.length === 0, 'No entities discovered');
      const entity = entities[0];
      const slug = entity.api_prefix.replace(/^\//, '');

      await authenticatedPage.page.route(
        `**/api/v1${entity.api_prefix}*`,
        async (route) => {
          await new Promise((r) => setTimeout(r, 2000));
          return route.continue();
        },
      );

      await authenticatedPage.page.goto(`/${slug}`);
      await expect(
        authenticatedPage.page.locator('.skeleton-row').first(),
      ).toBeVisible();
    });
  });

  test.describe('Edge Cases', () => {
    test('special characters in search do not break the page', async ({
      authenticatedPage,
    }) => {
      test.skip(entities.length === 0, 'No entities discovered');
      const entity = entities[0];
      const slug = entity.api_prefix.replace(/^\//, '');

      const listPage = new EntityListPage(authenticatedPage.page, entity.name);
      await listPage.goto(slug);

      await listPage.searchInput.fill('<script>alert("xss")</script>');
      await expect(listPage.page.locator('.entity-table')).toBeVisible();
    });

    test('unicode characters in search work correctly', async ({
      authenticatedPage,
    }) => {
      test.skip(entities.length === 0, 'No entities discovered');
      const entity = entities[0];
      const slug = entity.api_prefix.replace(/^\//, '');

      const listPage = new EntityListPage(authenticatedPage.page, entity.name);
      await listPage.goto(slug);

      await listPage.searchInput.fill('\u4F60\u597D\u4E16\u754C');
      await expect(listPage.page.locator('.entity-table')).toBeVisible();
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('table sort headers are keyboard accessible', async ({
      authenticatedPage,
    }) => {
      test.skip(entities.length === 0, 'No entities discovered');
      const entity = entities[0];
      const slug = entity.api_prefix.replace(/^\//, '');

      const listPage = new EntityListPage(authenticatedPage.page, entity.name);
      await listPage.goto(slug);

      const sortableHeader = listPage.table.locator('th[tabindex="0"]').first();
      const hasSortable = await sortableHeader.isVisible().catch(() => false);
      test.skip(!hasSortable, 'No sortable columns');

      await sortableHeader.focus();
      await authenticatedPage.page.keyboard.press('Enter');
      await expect(sortableHeader).toHaveAttribute(
        'aria-sort',
        /ascending|descending/,
      );
    });
  });
});
