import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../testing/entity-test-utils';
import { EntityForm } from '../../src/components/EntityForm';
import { ValidationError } from '../../src/api';
import type { Field } from '../../src/types';

const textField: Field = {
  key: 'name',
  label: 'Name',
  type: 'text',
  required: true,
  max_length: 255,
};
const textareaField: Field = {
  key: 'description',
  label: 'Description',
  type: 'textarea',
  placeholder: 'Enter description',
};
const selectField: Field = {
  key: 'status',
  label: 'Status',
  type: 'select',
  options: ['active', 'inactive'],
};
const booleanField: Field = {
  key: 'is_active',
  label: 'Active',
  type: 'boolean',
};
const dateField: Field = {
  key: 'start_date',
  label: 'Start Date',
  type: 'date',
};
const datetimeField: Field = {
  key: 'created_at',
  label: 'Created At',
  type: 'datetime',
};
const numberField: Field = {
  key: 'amount',
  label: 'Amount',
  type: 'number',
  placeholder: '0.00',
};
const hiddenField: Field = {
  key: 'hidden_field',
  label: 'Hidden',
  type: 'text',
  hidden: true,
};
const helpTextField: Field = {
  key: 'email',
  label: 'Email',
  type: 'text',
  helpText: 'Enter your email address',
};

const allFields = [
  textField,
  textareaField,
  selectField,
  booleanField,
  dateField,
  datetimeField,
  numberField,
  hiddenField,
  helpTextField,
];

describe('EntityForm', () => {
  let onSubmit: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSubmit = vi.fn().mockResolvedValue(undefined);
    onCancel = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderForm(
    fields: Field[] = allFields,
    initial?: Record<string, unknown>,
  ) {
    return renderWithProviders(
      <EntityForm
        fields={fields}
        initial={initial}
        onSubmit={onSubmit as (data: Record<string, unknown>) => Promise<void>}
        onCancel={onCancel as () => void}
      />,
    );
  }

  it('renders text input', () => {
    renderForm([textField]);
    const input = screen.getByLabelText(/Name/);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'text');
  });

  it('renders textarea', () => {
    renderForm([textareaField]);
    const textarea = screen.getByLabelText(/Description/);
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('renders select with options', () => {
    renderForm([selectField]);
    const select = screen.getByLabelText(/Status/);
    expect(select).toBeInTheDocument();
    expect(select.tagName).toBe('SELECT');
    expect(screen.getByText('Select...')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('inactive')).toBeInTheDocument();
  });

  it('renders boolean checkbox', () => {
    renderForm([booleanField]);
    const checkbox = screen.getByLabelText(/Active/);
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toHaveAttribute('type', 'checkbox');
  });

  it('renders date input', () => {
    renderForm([dateField]);
    const input = screen.getByLabelText(/Start Date/);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'date');
  });

  it('renders datetime input', () => {
    renderForm([datetimeField]);
    const input = screen.getByLabelText(/Created At/);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'datetime-local');
  });

  it('renders number input', () => {
    renderForm([numberField]);
    const input = screen.getByLabelText(/Amount/);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'number');
  });

  it('hides hidden fields', () => {
    renderForm([textField, hiddenField]);
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Hidden/)).not.toBeInTheDocument();
  });

  it('shows required indicator', () => {
    renderForm([textField]);
    const label = screen.getByText('Name').closest('label');
    expect(label).toBeInTheDocument();
    expect(label!.textContent).toContain('*');
  });

  it('shows create title for new record', () => {
    renderForm([textField]);
    expect(
      screen.getByRole('heading', { name: 'Create Record' }),
    ).toBeInTheDocument();
  });

  it('shows edit title for existing record', () => {
    renderForm([textField], { id: 1, name: 'Test' });
    expect(
      screen.getByRole('heading', { name: 'Edit Record' }),
    ).toBeInTheDocument();
  });

  it('cancel button calls onCancel', async () => {
    const user = userEvent.setup();
    renderForm([textField]);
    await user.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('escape key calls onCancel', async () => {
    const user = userEvent.setup();
    renderForm([textField]);
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('overlay click calls onCancel', async () => {
    const user = userEvent.setup();
    renderForm([textField]);
    const overlay = screen.getByRole('dialog');
    await user.click(overlay);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('modal content click does not cancel', async () => {
    const user = userEvent.setup();
    renderForm([textField]);
    const form = screen.getByRole('dialog').querySelector('form')!;
    await user.click(form);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('submit calls onSubmit with values', async () => {
    const user = userEvent.setup();
    renderForm([textField, selectField]);
    const nameInput = screen.getByLabelText(/Name/);
    await user.clear(nameInput);
    await user.type(nameInput, 'Test Name');
    const selectInput = screen.getByLabelText(/Status/);
    await user.selectOptions(selectInput, 'active');
    await user.click(screen.getByRole('button', { name: /Create/ }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Name',
        status: 'active',
      }),
    );
  });

  it('shows help text', () => {
    renderForm([helpTextField]);
    expect(screen.getByText('Enter your email address')).toBeInTheDocument();
  });

  it('shows field errors', async () => {
    const user = userEvent.setup();
    const err = new ValidationError('Validation failed', {
      name: 'Name is required',
    });
    onSubmit.mockRejectedValueOnce(err);
    renderForm([textField]);
    await user.click(screen.getByRole('button', { name: /Create/ }));
    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument();
    });
    const errorEl = screen.getByText('Name is required');
    expect(errorEl).toHaveAttribute('role', 'alert');
  });

  it('shows form-level error', async () => {
    const user = userEvent.setup();
    onSubmit.mockRejectedValueOnce(new Error('Server error'));
    renderForm([textField]);
    await user.click(screen.getByRole('button', { name: /Create/ }));
    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('submit button shows saving state', async () => {
    let resolveSubmit: () => void;
    onSubmit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const user = userEvent.setup();
    renderForm([textField]);
    await user.click(screen.getByRole('button', { name: /Create/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled();
    });
    resolveSubmit!();
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /Saving/ }),
      ).not.toBeInTheDocument();
    });
  });

  it('dialog has correct ARIA attributes', () => {
    renderForm([textField]);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'form-dialog-title');
  });

  it('renders email input', () => {
    const emailField: Field = { key: 'email', label: 'Email', type: 'email' };
    renderForm([emailField]);
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute('type', 'email');
  });

  it('renders url input', () => {
    const urlField: Field = { key: 'website', label: 'Website', type: 'url' };
    renderForm([urlField]);
    const input = screen.getByLabelText(/Website/);
    expect(input).toHaveAttribute('type', 'url');
  });

  it('renders tel input', () => {
    const telField: Field = { key: 'phone', label: 'Phone', type: 'tel' };
    renderForm([telField]);
    const input = screen.getByLabelText(/Phone/);
    expect(input).toHaveAttribute('type', 'tel');
  });

  it('renders multi-select with checkboxes', () => {
    const multiField: Field = {
      key: 'tags',
      label: 'Tags',
      type: 'multi-select',
      options: ['frontend', 'backend', 'devops'],
    };
    renderForm([multiField]);
    expect(screen.getByText('Tags')).toBeInTheDocument();
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);
    expect(screen.getByLabelText('frontend')).toBeInTheDocument();
    expect(screen.getByLabelText('backend')).toBeInTheDocument();
    expect(screen.getByLabelText('devops')).toBeInTheDocument();
  });

  it('multi-select toggles values', async () => {
    const user = userEvent.setup();
    const multiField: Field = {
      key: 'tags',
      label: 'Tags',
      type: 'multi-select',
      options: ['frontend', 'backend'],
    };
    renderForm([multiField]);
    await user.click(screen.getByLabelText('frontend'));
    await user.click(screen.getByLabelText('backend'));
    await user.click(screen.getByRole('button', { name: /Create/ }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.arrayContaining(['frontend', 'backend']),
        }),
      );
    });
  });

  it('hides field when dependsOn condition is false', () => {
    const fields: Field[] = [
      {
        key: 'type',
        label: 'Type',
        type: 'select',
        options: ['basic', 'advanced'],
      },
      {
        key: 'detail',
        label: 'Detail',
        type: 'text',
        dependsOn: { field: 'type', condition: (v) => v === 'advanced' },
      },
    ];
    renderForm(fields);
    expect(screen.queryByLabelText(/Detail/)).not.toBeInTheDocument();
  });

  it('shows field when dependsOn condition is true', async () => {
    const user = userEvent.setup();
    const fields: Field[] = [
      {
        key: 'type',
        label: 'Type',
        type: 'select',
        options: ['basic', 'advanced'],
      },
      {
        key: 'detail',
        label: 'Detail',
        type: 'text',
        dependsOn: { field: 'type', condition: (v) => v === 'advanced' },
      },
    ];
    renderForm(fields);
    const select = screen.getByLabelText(/Type/);
    await user.selectOptions(select, 'advanced');
    expect(screen.getByLabelText(/Detail/)).toBeInTheDocument();
  });
});
