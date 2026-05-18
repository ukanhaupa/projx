import { describe, expect, it } from 'vitest';
import { assertTemplateVars, defineTemplate, renderTemplate } from '../../../src/modules/auth/mailer.js';

describe('mailer templates', () => {
  it('fails when a template references a key that was not declared', () => {
    expect(() => assertTemplateVars('Hello {{name}} {{code}}', ['name'])).toThrow(/missing keys: code/);
  });

  it('fails when a declared key is not used by the template', () => {
    expect(() => assertTemplateVars('Hello {{name}}', ['name', 'code'])).toThrow(/extra keys: code/);
  });

  it('fails when render data drifts from the template contract', () => {
    const template = defineTemplate('Hello {{name}}', ['name']);

    expect(() => renderTemplate(template, {} as Record<'name', string>)).toThrow(/missing values: name/);
    expect(() =>
      renderTemplate(template, { name: 'Kanha', code: '123' } as Record<'name', string>),
    ).toThrow(/extra values: code/);
  });

  it('renders only declared placeholders and escapes html by default', () => {
    const template = defineTemplate('Hello {{name}}', ['name']);

    expect(renderTemplate(template, { name: '<Kanha>' })).toBe('Hello &lt;Kanha&gt;');
  });
});
