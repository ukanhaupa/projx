import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';

export const BUILT_IN_PRIVATE_COLUMNS = new Set([
  'password',
  'password_hash',
  'secret',
  'secret_hash',
  'token_hash',
  'refresh_token_jti',
  'mfa_secret',
  'recovery_codes',
  'salt',
  'api_key',
  'private_key',
  'encryption_key',
]);

export interface FieldMeta {
  key: string;
  label: string;
  type: string;
  nullable: boolean;
  is_auto: boolean;
  is_primary_key: boolean;
  filterable: boolean;
  searchable?: boolean;
  has_foreign_key: boolean;
  foreign_key_target?: string;
  in_create?: boolean;
  in_update?: boolean;
  field_type: string;
  max_length?: number;
  options?: string[];
}

export type EntitySchema = z.ZodObject<Record<string, z.ZodType>>;
export type BeforeCreateHook = (
  request: Request | undefined,
  data: Record<string, unknown>,
) => void | Promise<void>;

export type AfterCreateHook = (
  request: Request,
  record: Record<string, unknown>,
) => void | Promise<void>;

export type BeforeUpdateHook = (
  request: Request,
  response: Response,
  data: Record<string, unknown>,
) => void | Promise<void>;

export type AfterUpdateHook = (
  request: Request,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) => void | Promise<void>;

export type BeforeDeleteHook = (
  request: Request,
  recordId: string,
) => void | Promise<void>;

export interface EntityConfig {
  name: string;
  tableName: string;
  prismaModel: string;
  apiPrefix: string;
  tags: string[];
  readonly: boolean;
  softDelete: boolean;
  bulkOperations: boolean;
  columnNames?: string[];
  searchableFields: string[];
  hiddenFields?: string[];
  private?: boolean;
  skipAutoRoutes?: boolean;
  fields?: FieldMeta[];
  fieldOverrides?: Record<string, Partial<FieldMeta>>;
  schema: EntitySchema;
  createSchema: EntitySchema;
  updateSchema: EntitySchema;
  relations?: Record<string, { model: string; field: string }>;
  beforeCreate?: BeforeCreateHook;
  beforeCreateFields?: string[];
  afterCreate?: AfterCreateHook;
  beforeUpdate?: BeforeUpdateHook;
  afterUpdate?: AfterUpdateHook;
  beforeDelete?: BeforeDeleteHook;
  _effectiveHiddenFields?: Set<string>;
}

export function ensureEffectiveHiddenFields(config: EntityConfig): Set<string> {
  if (config._effectiveHiddenFields) return config._effectiveHiddenFields;
  const columnSet = new Set(config.columnNames ?? []);
  const explicit = new Set(config.hiddenFields ?? []);
  const baseline = new Set(
    [...BUILT_IN_PRIVATE_COLUMNS].filter((col) => columnSet.has(col)),
  );
  config._effectiveHiddenFields = new Set([...explicit, ...baseline]);
  return config._effectiveHiddenFields;
}

interface DmmfField {
  name: string;
  kind: string;
  type: string;
  isRequired: boolean;
  isId: boolean;
  isUnique: boolean;
  hasDefaultValue: boolean;
  isUpdatedAt?: boolean;
  relationFromFields?: string[];
}

interface DmmfModel {
  name: string;
  fields: DmmfField[];
}

interface DmmfEnum {
  name: string;
  values: Array<{ name: string }>;
}

interface SkippedEntity {
  name: string;
  tableName: string;
  reason: string;
}

function datamodel(): { models: DmmfModel[]; enums: DmmfEnum[] } {
  const raw = Prisma.dmmf.datamodel as unknown as {
    models?: DmmfModel[];
    enums?: DmmfEnum[];
  };
  return { models: raw.models ?? [], enums: raw.enums ?? [] };
}

function findModel(modelName: string): DmmfModel | undefined {
  return datamodel().models.find((model) => model.name === modelName);
}

function scalarFields(model: DmmfModel): DmmfField[] {
  return model.fields.filter((field) => field.kind !== 'object');
}

function titleize(key: string): string {
  return key
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function typeMeta(field: DmmfField): Pick<FieldMeta, 'type' | 'field_type'> {
  if (field.kind === 'enum') return { type: 'str', field_type: 'select' };
  switch (field.type) {
    case 'Int':
    case 'BigInt':
      return { type: 'int', field_type: 'number' };
    case 'Float':
    case 'Decimal':
      return { type: 'float', field_type: 'number' };
    case 'Boolean':
      return { type: 'bool', field_type: 'checkbox' };
    case 'DateTime':
      return { type: 'datetime', field_type: 'datetime' };
    case 'Json':
      return { type: 'dict', field_type: 'textarea' };
    default:
      return { type: 'str', field_type: 'text' };
  }
}

function relationTargets(model: DmmfModel): Map<string, string> {
  const targets = new Map<string, string>();
  for (const field of model.fields) {
    if (field.kind !== 'object') continue;
    for (const source of field.relationFromFields ?? []) {
      targets.set(source, field.type);
    }
  }
  return targets;
}

function schemaKeys(schema: EntitySchema): Set<string> {
  return new Set(Object.keys(schema.shape));
}

function deriveFields(config: EntityConfig, model: DmmfModel): FieldMeta[] {
  const relationMap = relationTargets(model);
  const createKeys = schemaKeys(config.createSchema);
  const updateKeys = schemaKeys(config.updateSchema);
  const existing = new Map(
    (config.fields ?? []).map((field) => [field.key, field]),
  );
  const enumValues = new Map(
    datamodel().enums.map((item) => [
      item.name,
      item.values.map((value) => value.name),
    ]),
  );

  return scalarFields(model).map((field) => {
    const baseType = typeMeta(field);
    const base: FieldMeta = {
      key: field.name,
      label: titleize(field.name),
      ...baseType,
      nullable: !field.isRequired,
      is_auto:
        field.hasDefaultValue || field.isUpdatedAt === true || field.isId,
      is_primary_key: field.isId,
      filterable: field.type !== 'Json',
      searchable: field.type === 'String' ? true : undefined,
      has_foreign_key: relationMap.has(field.name),
      foreign_key_target: relationMap.get(field.name),
      in_create: createKeys.has(field.name),
      in_update: updateKeys.has(field.name),
      options: field.kind === 'enum' ? enumValues.get(field.type) : undefined,
    };
    return {
      ...base,
      ...(existing.get(field.name) ?? {}),
      ...(config.fieldOverrides?.[field.name] ?? {}),
    };
  });
}

function normalizeConfig(config: EntityConfig): EntityConfig {
  const model = findModel(config.prismaModel);
  if (!model) return config;
  return {
    ...config,
    columnNames: scalarFields(model).map((field) => field.name),
    fields: deriveFields(config, model),
  };
}

function validateCreateCoverage(config: EntityConfig): void {
  if (config.readonly) return;
  const model = findModel(config.prismaModel);
  if (!model) return;

  const createKeys = schemaKeys(config.createSchema);
  const hookFields = new Set(config.beforeCreateFields ?? []);
  const missing = scalarFields(model).filter((field) => {
    if (!field.isRequired) return false;
    if (field.isId || field.hasDefaultValue || field.isUpdatedAt === true)
      return false;
    return !createKeys.has(field.name) && !hookFields.has(field.name);
  });

  if (missing.length === 0) return;
  throw new Error(
    `Entity "${config.name}" does not accept or populate required Prisma field(s): ${missing
      .map((field) => field.name)
      .join(
        ', ',
      )}. Add them to createSchema or list them in beforeCreateFields.`,
  );
}

class EntityRegistryClass {
  private entities: Map<string, EntityConfig> = new Map();
  private skipped: Map<string, SkippedEntity> = new Map();

  register(config: EntityConfig): void {
    if (config.private || config.skipAutoRoutes) {
      this.skipped.set(config.tableName, {
        name: config.name,
        tableName: config.tableName,
        reason: config.skipAutoRoutes ? 'skipAutoRoutes=true' : 'private=true',
      });
      return;
    }

    const normalized = normalizeConfig(config);

    if (
      normalized.softDelete &&
      !(normalized.columnNames ?? []).includes('deleted_at')
    ) {
      throw new Error(
        `Entity "${normalized.name}" has softDelete enabled but "deleted_at" is not in columnNames. ` +
          `Add a deleted_at column to your Prisma model and columnNames array.`,
      );
    }

    const columnSet = new Set(normalized.columnNames ?? []);
    for (const field of normalized.searchableFields) {
      if (!columnSet.has(field)) {
        throw new Error(
          `Entity "${normalized.name}" has searchableField "${field}" that does not exist in columnNames. ` +
            `Valid columns: ${(normalized.columnNames ?? []).join(', ')}`,
        );
      }
    }

    validateCreateCoverage(normalized);
    ensureEffectiveHiddenFields(normalized);
    this.entities.set(normalized.tableName, normalized);
  }

  getAll(): EntityConfig[] {
    return Array.from(this.entities.values());
  }

  getSkipped(): SkippedEntity[] {
    return Array.from(this.skipped.values());
  }

  get(tableName: string): EntityConfig | undefined {
    return this.entities.get(tableName);
  }

  reset(): void {
    this.entities.clear();
    this.skipped.clear();
  }

  getMeta(): { entities: Array<Record<string, unknown>> } {
    return {
      entities: this.getAll().map((entity) => {
        const hidden = entity._effectiveHiddenFields ?? new Set<string>();
        return {
          name: entity.name,
          table_name: entity.tableName,
          api_prefix: entity.apiPrefix,
          tags: entity.tags,
          readonly: entity.readonly,
          soft_delete: entity.softDelete,
          bulk_operations: entity.bulkOperations && !entity.readonly,
          fields: (entity.fields ?? []).filter(
            (field) => !hidden.has(field.key),
          ),
        };
      }),
    };
  }
}

export const EntityRegistry = new EntityRegistryClass();
