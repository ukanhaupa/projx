import type { ReactNode } from 'react';

export interface Column {
  key: string;
  label: string;
  filterable?: boolean;
  sortable?: boolean;
  hidden?: boolean;
  render?: (value: unknown, row: Record<string, unknown>) => ReactNode;
}

export interface Field {
  key: string;
  label: string;
  type?:
    | 'text'
    | 'number'
    | 'date'
    | 'datetime'
    | 'textarea'
    | 'select'
    | 'boolean'
    | 'email'
    | 'url'
    | 'tel'
    | 'multi-select';
  required?: boolean;
  options?: string[];
  max_length?: number;
  hidden?: boolean;
  placeholder?: string;
  helpText?: string;
  validate?: (value: unknown) => string | undefined;
  transform?: (value: unknown) => unknown;
  dependsOn?: { field: string; condition: (value: unknown) => boolean };
}

export interface EntityPermissions {
  create?: string[];
  update?: string[];
  delete?: string[];
}

export interface EntityConfig {
  name: string;
  slug: string;
  apiPrefix: string;
  columns: Column[];
  fields?: Field[];
  permissions?: EntityPermissions;
  bulkOperations?: boolean;
  className?: string;
  defaultSort?: string;
  defaultSortDir?: 'asc' | 'desc';
  defaultPageSize?: number;
  expandFields?: string[];
  softDelete?: boolean;
}

export interface MetaField {
  key: string;
  label: string;
  type: string;
  nullable: boolean;
  is_auto: boolean;
  is_primary_key: boolean;
  filterable: boolean;
  has_foreign_key: boolean;
  field_type: string;
  options?: string[];
  max_length?: number;
}

export interface MetaEntity {
  name: string;
  table_name: string;
  api_prefix: string;
  tags: string[];
  readonly: boolean;
  soft_delete: boolean;
  bulk_operations: boolean;
  fields: MetaField[];
}

export interface MetaResponse {
  entities: MetaEntity[];
}

export interface EntityOverride extends Partial<EntityConfig> {
  columnOverrides?: Record<string, Partial<Column>>;
  fieldOverrides?: Record<string, Partial<Field>>;
}

export function metaToEntityConfig(meta: MetaEntity): EntityConfig {
  const columns: Column[] = [];
  const fields: Field[] = [];

  for (const f of meta.fields) {
    columns.push({
      key: f.key,
      label: f.label,
      filterable: f.filterable && !f.is_auto,
      sortable: true,
    });

    if (!f.is_auto && !f.is_primary_key) {
      const field: Field = {
        key: f.key,
        label: f.label,
        type: f.field_type as Field['type'],
        required: !f.nullable,
      };
      if (f.options) field.options = f.options;
      if (f.max_length) field.max_length = f.max_length;
      fields.push(field);
    }
  }

  const expandFields = meta.fields
    .filter((f) => f.has_foreign_key)
    .map((f) => f.key.replace(/_id$/, ''));

  return {
    name: meta.name.replace(/([A-Z])/g, ' $1').trim(),
    slug: meta.api_prefix.replace(/^\//, ''),
    apiPrefix: meta.api_prefix,
    columns,
    fields: meta.readonly ? undefined : fields,
    bulkOperations: meta.bulk_operations,
    softDelete: meta.soft_delete,
    expandFields: expandFields.length ? expandFields : undefined,
  };
}
