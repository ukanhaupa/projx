import { type Locator, type Page, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class EntityListPage extends BasePage {
  readonly searchInput: Locator;
  readonly filterToggle: Locator;
  readonly filterPanel: Locator;
  readonly table: Locator;
  readonly paginationInfo: Locator;
  readonly prevPageButton: Locator;
  readonly nextPageButton: Locator;
  readonly pageSizeSelect: Locator;
  readonly emptyState: Locator;
  readonly errorAlert: Locator;
  readonly retryButton: Locator;

  constructor(
    page: Page,
    readonly entityName: string,
  ) {
    super(page);
    this.searchInput = page.getByLabel(`Search ${entityName}`);
    this.filterToggle = page.getByRole('button', { name: /Filters/ });
    this.filterPanel = page.getByRole('group', { name: 'Filters' });
    this.table = page.getByRole('table', { name: entityName });
    this.paginationInfo = page.locator('.pagination-info');
    this.prevPageButton = page.getByLabel('Previous page');
    this.nextPageButton = page.getByLabel('Next page');
    this.pageSizeSelect = page.getByLabel('Rows per page');
    this.emptyState = page.locator('.empty-state');
    this.errorAlert = page.getByRole('alert');
    this.retryButton = page.getByRole('button', { name: 'Retry' });
  }

  get createButton(): Locator {
    return this.page.locator('.page-header button');
  }

  get tableRows(): Locator {
    return this.table.locator('tbody tr:not(.skeleton-row)');
  }

  async goto(slug: string): Promise<void> {
    await this.page.goto(`/${slug}`);
    await expect(
      this.page.getByRole('region', { name: `${this.entityName} data table` }),
    ).toBeVisible();
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
    await this.page.waitForResponse((r) => r.url().includes('search'));
  }

  async clearSearch(): Promise<void> {
    await this.searchInput.clear();
  }

  async openFilters(): Promise<void> {
    if (!(await this.filterPanel.isVisible())) {
      await this.filterToggle.click();
    }
    await expect(this.filterPanel).toBeVisible();
  }

  async filterBy(fieldLabel: string, value: string): Promise<void> {
    await this.openFilters();
    await this.page.getByLabel(`Filter by ${fieldLabel}`).fill(value);
  }

  async clearFilters(): Promise<void> {
    await this.page.getByRole('button', { name: 'Clear Filters' }).click();
  }

  async sortByColumn(columnLabel: string): Promise<void> {
    await this.table.locator('th').filter({ hasText: columnLabel }).click();
  }

  async clickCreate(): Promise<void> {
    await this.createButton.click();
    await expect(this.page.locator('div[role="dialog"]')).toBeVisible();
  }

  async clickEdit(recordId: string | number): Promise<void> {
    await this.page.getByLabel(`Edit record ${recordId}`).click();
    await expect(this.page.locator('div[role="dialog"]')).toBeVisible();
  }

  async clickDelete(recordId: string | number): Promise<void> {
    await this.page.getByLabel(`Delete record ${recordId}`).click();
  }

  async expectRowCount(count: number): Promise<void> {
    await expect(this.tableRows).toHaveCount(count);
  }

  async expectEmptyState(): Promise<void> {
    await expect(this.emptyState).toBeVisible();
  }

  async goToNextPage(): Promise<void> {
    await this.nextPageButton.click();
  }

  async goToPrevPage(): Promise<void> {
    await this.prevPageButton.click();
  }

  async setPageSize(size: string): Promise<void> {
    await this.pageSizeSelect.selectOption(size);
  }
}
