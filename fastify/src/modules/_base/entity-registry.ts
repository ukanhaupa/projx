import type { TObject, TProperties } from '@sinclair/typebox';

export interface FieldMeta {
  key: string;
  label: string;
  type: string;
  nullable: boolean;
  is_auto: boolean;
  is_primary_key: boolean;
  filterable: boolean;
  has_foreign_key: boolean;
  field_type: string;
  max_length?: number;
  options?: string[];
}

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
  fields: FieldMeta[];
  schema: TObject<TProperties>;
  createSchema: TObject<TProperties>;
  updateSchema: TObject<TProperties>;
  relations?: Record<string, { model: string; field: string }>;
  auth?: {
    protected: boolean;
    permissions?: {
      list?: string;
      get?: string;
      create?: string;
      update?: string;
      delete?: string;
    };
  };
}

class EntityRegistryClass {
  private entities: Map<string, EntityConfig> = new Map();

  register(config: EntityConfig): void {
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
      entities: this.getAll().map((entity) => ({
        name: entity.name,
        table_name: entity.tableName,
        api_prefix: entity.apiPrefix,
        tags: entity.tags,
        readonly: entity.readonly,
        soft_delete: entity.softDelete,
        bulk_operations: entity.bulkOperations && !entity.readonly,
        fields: entity.fields,
      })),
    };
  }
}

export const EntityRegistry = new EntityRegistryClass();
