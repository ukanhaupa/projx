import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../src/api';
import type { Field } from '../../src/types';
import { useEntityForm } from '../../src/hooks/useEntityForm';

const fields: Field[] = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    options: ['active', 'inactive'],
  },
  { key: 'is_active', label: 'Active', type: 'boolean' },
];

describe('useEntityForm', () => {
  it('initializes with default values for new record', () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useEntityForm(fields, undefined, onSubmit),
    );
    expect(result.current.values.name).toBe('');
    expect(result.current.values.status).toBe('');
    expect(result.current.values.is_active).toBe(false);
  });

  it('initializes with provided initial values', () => {
    const onSubmit = vi.fn();
    const initial = { id: 1, name: 'Test', status: 'active', is_active: true };
    const { result } = renderHook(() =>
      useEntityForm(fields, initial, onSubmit),
    );
    expect(result.current.values.name).toBe('Test');
    expect(result.current.values.status).toBe('active');
    expect(result.current.values.is_active).toBe(true);
  });

  it('updates values and tracks dirty state', () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useEntityForm(fields, undefined, onSubmit),
    );
    expect(result.current.dirty).toBe(false);

    act(() => result.current.setValue('name', 'New Name'));
    expect(result.current.values.name).toBe('New Name');
    expect(result.current.dirty).toBe(true);
  });

  it('clears field error when value changes', () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('error'));
    const fieldsWithValidation: Field[] = [
      {
        key: 'name',
        label: 'Name',
        type: 'text',
        validate: (v) => (v ? undefined : 'Required'),
      },
    ];
    const { result } = renderHook(() =>
      useEntityForm(fieldsWithValidation, undefined, onSubmit),
    );

    act(() => {
      result.current.handleSubmit({
        preventDefault: () => {},
      } as React.FormEvent);
    });

    expect(result.current.fieldErrors.name).toBe('Required');

    act(() => result.current.setValue('name', 'filled'));
    expect(result.current.fieldErrors.name).toBeUndefined();
  });

  it('calls onSubmit with transformed values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const fieldsWithTransform: Field[] = [
      {
        key: 'name',
        label: 'Name',
        type: 'text',
        transform: (v) => String(v).trim(),
      },
    ];
    const { result } = renderHook(() =>
      useEntityForm(fieldsWithTransform, undefined, onSubmit),
    );

    act(() => result.current.setValue('name', '  hello  '));

    await act(() =>
      result.current.handleSubmit({
        preventDefault: () => {},
      } as React.FormEvent),
    );

    expect(onSubmit).toHaveBeenCalledWith({ name: 'hello' });
  });

  it('includes id from initial when editing', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const initial = { id: 42, name: 'Test' };
    const simpleFields: Field[] = [
      { key: 'name', label: 'Name', type: 'text' },
    ];
    const { result } = renderHook(() =>
      useEntityForm(simpleFields, initial, onSubmit),
    );

    await act(() =>
      result.current.handleSubmit({
        preventDefault: () => {},
      } as React.FormEvent),
    );

    expect(onSubmit).toHaveBeenCalledWith({ id: 42, name: 'Test' });
  });

  it('resets form to initial state', () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useEntityForm(fields, undefined, onSubmit),
    );

    act(() => result.current.setValue('name', 'Changed'));
    expect(result.current.dirty).toBe(true);

    act(() => result.current.reset());
    expect(result.current.values.name).toBe('');
    expect(result.current.dirty).toBe(false);
  });

  it('skips hidden fields in submission', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const hiddenFields: Field[] = [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'secret', label: 'Secret', type: 'text', hidden: true },
    ];
    const { result } = renderHook(() =>
      useEntityForm(hiddenFields, undefined, onSubmit),
    );

    act(() => result.current.setValue('name', 'Test'));

    await act(() =>
      result.current.handleSubmit({
        preventDefault: () => {},
      } as React.FormEvent),
    );

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Test' });
  });

  it('runs custom validation before submit', async () => {
    const onSubmit = vi.fn();
    const validatedFields: Field[] = [
      {
        key: 'email',
        label: 'Email',
        type: 'text',
        validate: (v) =>
          String(v).includes('@') ? undefined : 'Invalid email',
      },
    ];
    const { result } = renderHook(() =>
      useEntityForm(validatedFields, undefined, onSubmit),
    );

    act(() => result.current.setValue('email', 'bad'));

    await act(() =>
      result.current.handleSubmit({
        preventDefault: () => {},
      } as React.FormEvent),
    );

    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.fieldErrors.email).toBe('Invalid email');
  });

  it('handles ValidationError with field errors from server', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      new ValidationError('Validation failed', {
        name: 'Name is already taken',
        email: 'Invalid email format',
      }),
    );
    const simpleFields: Field[] = [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
    ];
    const { result } = renderHook(() =>
      useEntityForm(simpleFields, undefined, onSubmit),
    );

    act(() => result.current.setValue('name', 'test'));
    act(() => result.current.setValue('email', 'bad'));

    await act(() =>
      result.current.handleSubmit({
        preventDefault: () => {},
      } as React.FormEvent),
    );

    expect(result.current.fieldErrors.name).toBe('Name is already taken');
    expect(result.current.fieldErrors.email).toBe('Invalid email format');
    expect(result.current.saving).toBe(false);
  });

  it('handles generic Error on submit failure', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Network failure'));
    const simpleFields: Field[] = [
      { key: 'name', label: 'Name', type: 'text' },
    ];
    const { result } = renderHook(() =>
      useEntityForm(simpleFields, undefined, onSubmit),
    );

    act(() => result.current.setValue('name', 'test'));

    await act(() =>
      result.current.handleSubmit({
        preventDefault: () => {},
      } as React.FormEvent),
    );

    expect(result.current.error).toBe('Network failure');
    expect(result.current.saving).toBe(false);
  });
});
