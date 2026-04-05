import { test, expect, fetchEntities } from './fixtures';
import { EntityListPage } from './pages/entity-list.page';
import { EntityFormPage } from './pages/entity-form.page';
import { ConfirmDialogPage } from './pages/confirm-dialog.page';
import type { MetaEntity } from './fixtures';

let entities: MetaEntity[] = [];

test.beforeAll(async () => {
  entities = await fetchEntities();
});

test.describe('Entity CRUD', () => {
  test('every entity page renders a table with search', async ({
    authenticatedPage,
  }) => {
    test.skip(entities.length === 0, 'No entities discovered');

    for (const entity of entities) {
      const slug = entity.api_prefix.replace(/^\//, '');
      const listPage = new EntityListPage(authenticatedPage.page, entity.name);
      await listPage.goto(slug);
      await expect(listPage.table).toBeVisible();
      await expect(listPage.searchInput).toBeVisible();
    }
  });

  test('readonly entities have no create button', async ({
    authenticatedPage,
  }) => {
    const readonlyEntities = entities.filter((e) => e.readonly);
    test.skip(readonlyEntities.length === 0, 'No readonly entities');

    for (const entity of readonlyEntities) {
      const slug = entity.api_prefix.replace(/^\//, '');
      const listPage = new EntityListPage(authenticatedPage.page, entity.name);
      await listPage.goto(slug);
      await expect(listPage.createButton).toHaveCount(0);
    }
  });

  test('writable entities have a create button that opens form', async ({
    authenticatedPage,
  }) => {
    const writable = entities.filter((e) => !e.readonly);
    test.skip(writable.length === 0, 'No writable entities');

    const entity = writable[0];
    const slug = entity.api_prefix.replace(/^\//, '');
    const listPage = new EntityListPage(authenticatedPage.page, entity.name);
    await listPage.goto(slug);
    await listPage.clickCreate();

    const form = new EntityFormPage(authenticatedPage.page);
    await form.expectOpen(`Create ${entity.name}`);
  });

  test('create form can be closed with cancel button', async ({
    authenticatedPage,
  }) => {
    const writable = entities.filter((e) => !e.readonly);
    test.skip(writable.length === 0, 'No writable entities');

    const entity = writable[0];
    const slug = entity.api_prefix.replace(/^\//, '');
    const listPage = new EntityListPage(authenticatedPage.page, entity.name);
    await listPage.goto(slug);
    await listPage.clickCreate();

    const form = new EntityFormPage(authenticatedPage.page);
    await form.cancel();
  });

  test('create form can be closed with Escape key', async ({
    authenticatedPage,
  }) => {
    const writable = entities.filter((e) => !e.readonly);
    test.skip(writable.length === 0, 'No writable entities');

    const entity = writable[0];
    const slug = entity.api_prefix.replace(/^\//, '');
    const listPage = new EntityListPage(authenticatedPage.page, entity.name);
    await listPage.goto(slug);
    await listPage.clickCreate();

    const form = new EntityFormPage(authenticatedPage.page);
    await form.closeWithEscape();
  });

  test('create entity via form and verify it appears in table', async ({
    authenticatedPage,
  }) => {
    const writable = entities.filter((e) => !e.readonly);
    test.skip(writable.length === 0, 'No writable entities');

    const entity = writable[0];
    const slug = entity.api_prefix.replace(/^\//, '');
    const listPage = new EntityListPage(authenticatedPage.page, entity.name);
    await listPage.goto(slug);

    const editableFields = entity.fields.filter(
      (f) => !f.is_auto && f.key !== 'id',
    );
    test.skip(editableFields.length === 0, 'No editable fields');

    await listPage.clickCreate();
    const form = new EntityFormPage(authenticatedPage.page);

    const uniqueSuffix = Date.now().toString();
    const fieldValues: Record<string, string> = {};
    for (const field of editableFields) {
      if (field.type === 'boolean') {
        fieldValues[field.label] = 'true';
      } else if (field.type === 'number' || field.type === 'integer') {
        fieldValues[field.label] = '42';
      } else {
        fieldValues[field.label] = `E2E Test ${uniqueSuffix}`;
      }
    }
    await form.fillFields(fieldValues);
    await form.submitAndWaitForClose();

    await expect(
      authenticatedPage.page.getByText(`E2E Test ${uniqueSuffix}`).first(),
    ).toBeVisible();
  });

  test('edit entity via table action button', async ({ authenticatedPage }) => {
    const writable = entities.filter((e) => !e.readonly);
    test.skip(writable.length === 0, 'No writable entities');

    const entity = writable[0];
    const slug = entity.api_prefix.replace(/^\//, '');
    const listPage = new EntityListPage(authenticatedPage.page, entity.name);
    await listPage.goto(slug);

    const firstEditButton = authenticatedPage.page
      .getByLabel(/Edit record/)
      .first();
    const isVisible = await firstEditButton.isVisible().catch(() => false);
    test.skip(!isVisible, 'No records to edit');

    await firstEditButton.click();
    const form = new EntityFormPage(authenticatedPage.page);
    await form.expectOpen(`Edit ${entity.name}`);
    await form.cancel();
  });

  test('delete entity shows confirmation dialog', async ({
    authenticatedPage,
  }) => {
    const writable = entities.filter((e) => !e.readonly);
    test.skip(writable.length === 0, 'No writable entities');

    const entity = writable[0];
    const slug = entity.api_prefix.replace(/^\//, '');
    const listPage = new EntityListPage(authenticatedPage.page, entity.name);
    await listPage.goto(slug);

    const firstDeleteButton = authenticatedPage.page
      .getByLabel(/Delete record/)
      .first();
    const isVisible = await firstDeleteButton.isVisible().catch(() => false);
    test.skip(!isVisible, 'No records to delete');

    await firstDeleteButton.click();
    const confirmDialog = new ConfirmDialogPage(authenticatedPage.page);
    await confirmDialog.expectOpen();
    await confirmDialog.cancel();
  });

  test('delete confirmation cancel does not remove record', async ({
    authenticatedPage,
  }) => {
    const writable = entities.filter((e) => !e.readonly);
    test.skip(writable.length === 0, 'No writable entities');

    const entity = writable[0];
    const slug = entity.api_prefix.replace(/^\//, '');
    const listPage = new EntityListPage(authenticatedPage.page, entity.name);
    await listPage.goto(slug);

    const deleteButtons = authenticatedPage.page.getByLabel(/Delete record/);
    const count = await deleteButtons.count();
    test.skip(count === 0, 'No records to delete');

    await deleteButtons.first().click();
    const confirmDialog = new ConfirmDialogPage(authenticatedPage.page);
    await confirmDialog.cancel();

    await expect(deleteButtons).toHaveCount(count);
  });

  test('search filters table results', async ({ authenticatedPage }) => {
    const writable = entities.filter(
      (e) => !e.readonly && e.searchable_fields.length > 0,
    );
    test.skip(writable.length === 0, 'No searchable entities');

    const entity = writable[0];
    const slug = entity.api_prefix.replace(/^\//, '');
    const listPage = new EntityListPage(authenticatedPage.page, entity.name);
    await listPage.goto(slug);

    await listPage.searchInput.fill('zzz-nonexistent-query-zzz');
    await expect(listPage.emptyState).toBeVisible();
  });

  test('column sorting updates table', async ({ authenticatedPage }) => {
    test.skip(entities.length === 0, 'No entities discovered');

    const entity = entities[0];
    const slug = entity.api_prefix.replace(/^\//, '');
    const listPage = new EntityListPage(authenticatedPage.page, entity.name);
    await listPage.goto(slug);

    const sortableHeader = listPage.table.locator('th[tabindex="0"]').first();
    const hasSortable = await sortableHeader.isVisible().catch(() => false);
    test.skip(!hasSortable, 'No sortable columns');

    await sortableHeader.click();
    await expect(sortableHeader).toHaveAttribute(
      'aria-sort',
      /ascending|descending/,
    );
  });
});
