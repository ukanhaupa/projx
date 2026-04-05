import { useCallback, useEffect, useRef } from 'react';
import { useEntityForm } from '../hooks/useEntityForm';
import type { Field } from '../types';

export interface EntityFormProps {
  fields: Field[];
  initial?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  entityName?: string;
}

export function EntityForm({
  fields,
  initial,
  onSubmit,
  onCancel,
  entityName,
}: EntityFormProps) {
  const form = useEntityForm(fields, initial, onSubmit);
  const visibleFields = fields.filter(
    (f) =>
      !f.hidden &&
      (!f.dependsOn || f.dependsOn.condition(form.values[f.dependsOn.field])),
  );
  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLFormElement>(null);

  const isEditing = !!initial;
  const title = isEditing
    ? `Edit ${entityName || 'Record'}`
    : `Create ${entityName || 'Record'}`;
  const submitLabel = isEditing
    ? 'Save Changes'
    : `Create ${entityName || 'Record'}`;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();

      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'input, select, textarea, button, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  useEffect(() => {
    const firstInput = modalRef.current?.querySelector<HTMLElement>(
      'input:not([type="checkbox"]), select, textarea',
    );
    firstInput?.focus();
  }, []);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onCancel();
    },
    [onCancel],
  );

  const fieldId = (key: string) => `form-field-${key}`;
  const errorId = (key: string) => `form-error-${key}`;
  const helpId = (key: string) => `form-help-${key}`;

  const renderField = (f: Field) => {
    const value = form.values[f.key];
    const fieldError = form.fieldErrors[f.key];
    const hasError = !!fieldError;
    const describedBy = [
      hasError ? errorId(f.key) : null,
      f.helpText && !hasError ? helpId(f.key) : null,
    ]
      .filter(Boolean)
      .join(' ');

    const commonProps = {
      id: fieldId(f.key),
      'aria-invalid': hasError ? ('true' as const) : undefined,
      'aria-describedby': describedBy || undefined,
      'aria-required': f.required || undefined,
    };

    const input = (() => {
      switch (f.type) {
        case 'textarea':
          return (
            <textarea
              {...commonProps}
              value={String(value ?? '')}
              onChange={(e) => form.setValue(f.key, e.target.value)}
              required={f.required}
              placeholder={f.placeholder}
              rows={3}
            />
          );

        case 'select':
          return (
            <select
              {...commonProps}
              value={String(value ?? '')}
              onChange={(e) => form.setValue(f.key, e.target.value)}
              required={f.required}
            >
              <option value=''>Select...</option>
              {(f.options ?? []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          );

        case 'boolean':
          return (
            <div className='checkbox-field'>
              <input
                {...commonProps}
                type='checkbox'
                checked={Boolean(value)}
                onChange={(e) => form.setValue(f.key, e.target.checked)}
              />
              <span>{value ? 'Yes' : 'No'}</span>
            </div>
          );

        case 'datetime':
          return (
            <input
              {...commonProps}
              type='datetime-local'
              value={String(value ?? '')}
              onChange={(e) => form.setValue(f.key, e.target.value)}
              required={f.required}
            />
          );

        case 'date':
          return (
            <input
              {...commonProps}
              type='date'
              value={String(value ?? '')}
              onChange={(e) => form.setValue(f.key, e.target.value)}
              required={f.required}
            />
          );

        case 'number':
          return (
            <input
              {...commonProps}
              type='number'
              value={String(value ?? '')}
              onChange={(e) => form.setValue(f.key, Number(e.target.value))}
              required={f.required}
              placeholder={f.placeholder}
            />
          );

        case 'email':
        case 'url':
        case 'tel':
          return (
            <input
              {...commonProps}
              type={f.type}
              value={String(value ?? '')}
              onChange={(e) => form.setValue(f.key, e.target.value)}
              required={f.required}
              placeholder={f.placeholder}
            />
          );

        case 'multi-select':
          return (
            <fieldset {...commonProps} className='multi-select-field'>
              {(f.options ?? []).map((opt) => (
                <label key={opt} className='multi-select-option'>
                  <input
                    type='checkbox'
                    checked={Array.isArray(value) && value.includes(opt)}
                    onChange={(e) => {
                      const arr = Array.isArray(value) ? [...value] : [];
                      if (e.target.checked) {
                        arr.push(opt);
                      } else {
                        const idx = arr.indexOf(opt);
                        if (idx >= 0) arr.splice(idx, 1);
                      }
                      form.setValue(f.key, arr);
                    }}
                  />
                  {opt}
                </label>
              ))}
            </fieldset>
          );

        default:
          return (
            <input
              {...commonProps}
              type='text'
              value={String(value ?? '')}
              onChange={(e) => form.setValue(f.key, e.target.value)}
              required={f.required}
              maxLength={f.max_length}
              placeholder={f.placeholder}
            />
          );
      }
    })();

    return (
      <>
        {input}
        {fieldError && (
          <span className='field-error' id={errorId(f.key)} role='alert'>
            {fieldError}
          </span>
        )}
        {f.helpText && !fieldError && (
          <span className='field-help' id={helpId(f.key)}>
            {f.helpText}
          </span>
        )}
      </>
    );
  };

  return (
    <div
      className='modal-overlay'
      ref={overlayRef}
      onClick={handleOverlayClick}
      role='dialog'
      aria-modal='true'
      aria-labelledby='form-dialog-title'
    >
      <form
        className='modal'
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        onSubmit={form.handleSubmit}
        noValidate
      >
        <h3 id='form-dialog-title'>{title}</h3>
        {form.error && (
          <div className='error' role='alert'>
            {form.error}
          </div>
        )}
        {visibleFields.map((f) => (
          <label key={f.key} htmlFor={fieldId(f.key)}>
            {f.label}
            {f.required && (
              <span className='required-indicator' aria-hidden='true'>
                *
              </span>
            )}
            {renderField(f)}
          </label>
        ))}
        <div className='form-actions'>
          <button type='button' onClick={onCancel}>
            Cancel
          </button>
          <button type='submit' disabled={form.saving}>
            {form.saving ? 'Saving...' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
