import { useCallback, useMemo, useState } from 'react';
import { ValidationError } from '../api';
import type { Field } from '../types';

export interface UseEntityFormReturn {
  values: Record<string, unknown>;
  setValue: (key: string, value: unknown) => void;
  fieldErrors: Record<string, string>;
  error: string;
  saving: boolean;
  dirty: boolean;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  reset: () => void;
}

function buildInitial(fields: Field[], initial?: Record<string, unknown>) {
  if (initial) return { ...initial };
  return Object.fromEntries(
    fields.map((f) => {
      if (f.type === 'boolean') return [f.key, false];
      if (f.type === 'multi-select') return [f.key, []];
      return [f.key, ''];
    }),
  );
}

export function useEntityForm(
  fields: Field[],
  initial: Record<string, unknown> | undefined,
  onSubmit: (data: Record<string, unknown>) => Promise<void>,
): UseEntityFormReturn {
  const initialValues = useMemo(
    () => buildInitial(fields, initial),
    [fields, initial],
  );
  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => {
    return Object.keys(values).some((k) => values[k] !== initialValues[k]);
  }, [values, initialValues]);

  const setValue = useCallback((key: string, value: unknown) => {
    setValues((v) => ({ ...v, [key]: value }));
    setFieldErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }, []);

  const validate = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    for (const f of fields) {
      if (f.hidden) continue;
      if (f.dependsOn && !f.dependsOn.condition(values[f.dependsOn.field]))
        continue;
      if (f.validate) {
        const msg = f.validate(values[f.key]);
        if (msg) errors[f.key] = msg;
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [fields, values]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!validate()) return;

      setSaving(true);
      setError('');
      setFieldErrors({});

      try {
        const transformed: Record<string, unknown> = {};
        for (const f of fields) {
          if (f.hidden) continue;
          if (f.dependsOn && !f.dependsOn.condition(values[f.dependsOn.field]))
            continue;
          const val = values[f.key];
          transformed[f.key] = f.transform ? f.transform(val) : val;
        }
        if (initial?.id !== undefined) transformed.id = initial.id;
        await onSubmit(transformed);
      } catch (err: unknown) {
        if (err instanceof ValidationError) {
          if (Object.keys(err.fieldErrors).length) {
            setFieldErrors(err.fieldErrors);
          }
          if (err.message && err.message !== 'Validation failed') {
            setError(err.message);
          }
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Save failed');
        }
      } finally {
        setSaving(false);
      }
    },
    [fields, values, initial, onSubmit, validate],
  );

  const reset = useCallback(() => {
    setValues(buildInitial(fields, initial));
    setFieldErrors({});
    setError('');
  }, [fields, initial]);

  return {
    values,
    setValue,
    fieldErrors,
    error,
    saving,
    dirty,
    handleSubmit,
    reset,
  };
}
