import { type Locator, type Page, expect } from '@playwright/test';
import { BasePage } from './base.page';
import { DashboardPage } from './dashboard.page';

export class LoginPage extends BasePage {
  readonly form: Locator;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorAlert: Locator;
  readonly passwordToggle: Locator;

  constructor(page: Page) {
    super(page);
    this.form = page.getByLabel('Login form');
    this.usernameInput = page.getByLabel('Username');
    this.passwordInput = page.locator('#login-password');
    this.submitButton = page.getByRole('button', { name: 'Sign In' });
    this.errorAlert = page.getByRole('alert');
    this.passwordToggle = page.getByLabel(/password$/i);
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.form).toBeVisible();
  }

  async login(username: string, password: string): Promise<DashboardPage> {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
    const dashboard = new DashboardPage(this.page);
    await expect(dashboard.heading).toBeVisible({ timeout: 10000 });
    return dashboard;
  }

  async loginExpectingError(username: string, password: string): Promise<void> {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
    await expect(this.errorAlert).toBeVisible();
  }

  async togglePasswordVisibility(): Promise<void> {
    await this.passwordToggle.click();
  }
}
