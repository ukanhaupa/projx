import { api } from '../api';
import type {
  Column,
  EntityConfig,
  EntityOverride,
  Field,
  MetaEntity,
  MetaResponse,
} from '../types';
import { metaToEntityConfig } from '../types';
import { entityOverrides } from './overrides';

let _entities: EntityConfig[] = [];
let _meta: MetaEntity[] = [];
let _loading: Promise<EntityConfig[]> | null = null;

function mergeColumns(
  columns: Column[],
  overrides?: Record<string, Partial<Column>>,
): Column[] {
  if (!overrides) return columns;
  return columns
    .map((col) => {
      const override = overrides[col.key];
      return override ? { ...col, ...override } : col;
    })
    .filter((col) => !col.hidden);
}

function mergeFields(
  fields: Field[] | undefined,
  overrides?: Record<string, Partial<Field>>,
): Field[] | undefined {
  if (!fields) return undefined;
  if (!overrides) return fields;
  return fields
    .map((field) => {
      const override = overrides[field.key];
      return override ? { ...field, ...override } : field;
    })
    .filter((f) => !f.hidden);
}

function applyOverride(
  config: EntityConfig,
  override: EntityOverride,
): EntityConfig {
  const { columnOverrides, fieldOverrides, ...rest } = override;
  return {
    ...config,
    ...rest,
    columns: mergeColumns(rest.columns ?? config.columns, columnOverrides),
    fields: mergeFields(rest.fields ?? config.fields, fieldOverrides),
  };
}

function applyOverrides(configs: EntityConfig[]): EntityConfig[] {
  return configs.map((config) => {
    const override = entityOverrides[config.slug];
    return override ? applyOverride(config, override) : config;
  });
}

const LOAD_TIMEOUT = 10_000;

export async function loadEntities(): Promise<EntityConfig[]> {
  if (_entities.length) return _entities;
  if (_loading) return _loading;

  _loading = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT);
    try {
      const meta = await api.raw<MetaResponse>('/_meta', {
        signal: controller.signal,
      });
      clearTimeout(timer);
      _meta = meta.entities;
      _entities = applyOverrides(meta.entities.map(metaToEntityConfig));
      return _entities;
    } catch (e) {
      _loading = null;
      if (controller.signal.aborted) {
        throw new Error(
          'Loading timed out. Please check your connection and try again.',
          { cause: e },
        );
      }
      throw e;
    }
  })();

  return _loading;
}

export function getEntities(): EntityConfig[] {
  return _entities;
}

export function getEntityMeta(): MetaEntity[] {
  return _meta;
}

export function getEntityMetaBySlug(slug: string): MetaEntity | undefined {
  return _meta.find((m) => m.api_prefix.replace(/^\//, '') === slug);
}

export function resetEntityCache(): void {
  _entities = [];
  _meta = [];
  _loading = null;
}
