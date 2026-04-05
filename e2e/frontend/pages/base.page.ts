import { type Locator, type Page, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export class BasePage {
  constructor(readonly page: Page) {}

  get themeToggle(): Locator {
    return this.page.getByRole('button', { name: /Switch to/ });
  }

  get toastContainer(): Locator {
    return this.page.locator('div[role="status"][aria-label="Notifications"]');
  }

  async getTheme(): Promise<string | null> {
    return this.page.locator('html').getAttribute('data-theme');
  }

  async toggleTheme(): Promise<void> {
    const before = await this.getTheme();
    await this.themeToggle.first().click();
    await expect(this.page.locator('html')).not.toHaveAttribute(
      'data-theme',
      before ?? '',
    );
  }

  async expectToast(message: string | RegExp): Promise<void> {
    await expect(
      this.page.getByRole('alert').filter({ hasText: message }),
    ).toBeVisible();
  }

  async dismissToast(): Promise<void> {
    await this.page.getByLabel('Dismiss notification').first().click();
  }

  async runAccessibilityScan(): Promise<void> {
    const results = await new AxeBuilder({ page: this.page }).analyze();
    expect(results.violations).toEqual([]);
  }
}
