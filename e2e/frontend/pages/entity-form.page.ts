import { type Locator, type Page, expect } from '@playwright/test';

export class EntityFormPage {
  readonly dialog: Locator;
  readonly title: Locator;
  readonly cancelButton: Locator;
  readonly submitButton: Locator;
  readonly formError: Locator;

  constructor(readonly page: Page) {
    this.dialog = page.locator('div[role="dialog"]');
    this.title = this.dialog.locator('#form-dialog-title');
    this.cancelButton = this.dialog.getByRole('button', { name: 'Cancel' });
    this.submitButton = this.dialog.locator('button[type="submit"]');
    this.formError = this.dialog.locator('.error[role="alert"]');
  }

  async expectOpen(titlePattern: string | RegExp): Promise<void> {
    await expect(this.dialog).toBeVisible();
    await expect(this.title).toHaveText(titlePattern);
  }

  async fillField(label: string, value: string): Promise<void> {
    const field = this.dialog.getByLabel(label, { exact: false });
    const tagName = await field.evaluate((el) => el.tagName.toLowerCase());

    if (tagName === 'select') {
      await field.selectOption(value);
    } else if (tagName === 'textarea') {
      await field.fill(value);
    } else {
      const type = await field.getAttribute('type');
      if (type === 'checkbox') {
        const checked = await field.isChecked();
        if ((value === 'true') !== checked) await field.click();
      } else {
        await field.fill(value);
      }
    }
  }

  async fillFields(fields: Record<string, string>): Promise<void> {
    for (const [label, value] of Object.entries(fields)) {
      await this.fillField(label, value);
    }
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  async submitAndWaitForClose(): Promise<void> {
    await this.submitButton.click();
    await expect(this.dialog).toBeHidden();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.dialog).toBeHidden();
  }

  async closeWithEscape(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await expect(this.dialog).toBeHidden();
  }

  async expectFieldError(
    fieldKey: string,
    message: string | RegExp,
  ): Promise<void> {
    await expect(this.dialog.locator(`#form-error-${fieldKey}`)).toHaveText(
      message,
    );
  }

  async expectFormError(message: string | RegExp): Promise<void> {
    await expect(this.formError).toHaveText(message);
  }

  async expectSubmitDisabled(): Promise<void> {
    await expect(this.submitButton).toBeDisabled();
  }
}
