import { type Locator, type Page, expect } from '@playwright/test';

export class ConfirmDialogPage {
  readonly dialog: Locator;
  readonly title: Locator;
  readonly message: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;

  constructor(readonly page: Page) {
    this.dialog = page.locator('div[role="dialog"] .confirm-dialog');
    this.title = this.dialog.locator('#confirm-dialog-title');
    this.message = this.dialog.locator('#confirm-dialog-message');
    this.confirmButton = this.dialog.locator('.confirm-btn');
    this.cancelButton = this.dialog.locator('.form-actions button').first();
  }

  async expectOpen(): Promise<void> {
    await expect(this.dialog).toBeVisible();
  }

  async confirm(): Promise<void> {
    await this.confirmButton.click();
    await expect(this.dialog).toBeHidden();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.dialog).toBeHidden();
  }

  async dismissWithEscape(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await expect(this.dialog).toBeHidden();
  }

  async expectTitle(text: string | RegExp): Promise<void> {
    await expect(this.title).toHaveText(text);
  }

  async expectMessage(text: string | RegExp): Promise<void> {
    await expect(this.message).toHaveText(text);
  }
}
