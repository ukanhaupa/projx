import type { TObject, TProperties } from '@sinclair/typebox';

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

export type CustomRouteRegistrar = (
  fastify: import('fastify').FastifyInstance,
  entityConfig: EntityConfig,
) => void;

export interface EntityConfig {
  name: string;
  tableName: string;
  prismaModel: string;
  apiPrefix: string;
  tags: string[];
  readonly: boolean;
  softDelete: boolean;
  bulkOperations: boolean;
  columnNames: string[];
  searchableFields: string[];
  hiddenFields?: string[];
  private?: boolean;
  fields: FieldMeta[];
  schema: TObject<TProperties>;
  createSchema: TObject<TProperties>;
  updateSchema: TObject<TProperties>;
  relations?: Record<string, { model: string; field: string }>;
  customRoutes?: CustomRouteRegistrar;
  _effectiveHiddenFields?: Set<string>;
}

export function ensureEffectiveHiddenFields(config: EntityConfig): Set<string> {
  if (config._effectiveHiddenFields) return config._effectiveHiddenFields;
  const columnSet = new Set(config.columnNames);
  const explicit = new Set(config.hiddenFields ?? []);
  const baseline = new Set([...BUILT_IN_PRIVATE_COLUMNS].filter((col) => columnSet.has(col)));
  config._effectiveHiddenFields = new Set([...explicit, ...baseline]);
  return config._effectiveHiddenFields;
}

class EntityRegistryClass {
  private entities: Map<string, EntityConfig> = new Map();

  register(config: EntityConfig): void {
    if (config.private) return;

    if (config.softDelete && !config.columnNames.includes('deleted_at')) {
      throw new Error(
        `Entity "${config.name}" has softDelete enabled but "deleted_at" is not in columnNames. ` +
          `Add a deleted_at column to your Prisma model and columnNames array.`,
      );
    }

    const columnSet = new Set(config.columnNames);
    for (const field of config.searchableFields) {
      if (!columnSet.has(field)) {
        throw new Error(
          `Entity "${config.name}" has searchableField "${field}" that does not exist in columnNames. ` +
            `Valid columns: ${config.columnNames.join(', ')}`,
        );
      }
    }

    ensureEffectiveHiddenFields(config);

    this.entities.set(config.tableName, config);
  }

  getAll(): EntityConfig[] {
    return Array.from(this.entities.values());
  }

  get(tableName: string): EntityConfig | undefined {
    return this.entities.get(tableName);
  }

  reset(): void {
    this.entities.clear();
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
          fields: entity.fields.filter((f) => !hidden.has(f.key)),
        };
      }),
    };
  }
}

export const EntityRegistry = new EntityRegistryClass();
