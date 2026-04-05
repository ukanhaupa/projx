import { type Locator, type Page, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class DashboardPage extends BasePage {
  readonly heading: Locator;
  readonly cardGrid: Locator;
  readonly sidebar: Locator;
  readonly skipLink: Locator;
  readonly mobileMenuButton: Locator;
  readonly logoutButton: Locator;
  readonly collapseButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: 'Dashboard', level: 2 });
    this.cardGrid = page.locator('div[role="list"]');
    this.sidebar = page.getByRole('navigation', { name: 'Main navigation' });
    this.skipLink = page.getByText('Skip to main content');
    this.mobileMenuButton = page.getByLabel('Open navigation menu');
    this.logoutButton = page.getByRole('button', { name: 'Log out' });
    this.collapseButton = page.getByRole('button', {
      name: /collapse sidebar|expand sidebar/i,
    });
  }

  get entityCards(): Locator {
    return this.page.locator('div[role="list"] [role="listitem"]');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.heading).toBeVisible({ timeout: 10000 });
  }

  async navigateToEntity(name: string): Promise<void> {
    await this.sidebar.getByRole('listitem').filter({ hasText: name }).click();
  }

  async navigateToEntityBySlug(slug: string): Promise<void> {
    await this.sidebar.locator(`a[href="/${slug}"]`).click();
  }

  async expectEntityCardCount(count: number): Promise<void> {
    await expect(this.entityCards).toHaveCount(count);
  }

  async toggleSidebar(): Promise<void> {
    await this.collapseButton.click();
  }

  async logout(): Promise<void> {
    await this.logoutButton.click();
  }
}
