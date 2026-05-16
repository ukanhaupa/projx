import type { EntityConfig } from './entity-registry.js';
import { EntityRegistry } from './entity-registry.js';

export function parseExpandParam(expand: string | undefined): string[] {
  if (!expand?.trim()) return [];
  return expand
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
}

export function buildIncludeFromExpand(
  expandFields: string[],
  entityConfig: EntityConfig,
): Record<string, boolean> | undefined {
  if (!expandFields.length || !entityConfig.relations) return undefined;

  const include: Record<string, boolean> = {};
  for (const field of expandFields) {
    if (entityConfig.relations[field]) {
      include[field] = true;
    }
  }

  return Object.keys(include).length > 0 ? include : undefined;
}

export function getExpandableFieldNames(entityConfig: EntityConfig): string[] {
  if (!entityConfig.relations) return [];
  return Object.keys(entityConfig.relations);
}

export { EntityRegistry };
