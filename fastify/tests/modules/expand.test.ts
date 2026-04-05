import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import {
  parseExpandParam,
  buildIncludeFromExpand,
  getExpandableFieldNames,
} from '../../src/modules/_base/expand.js';
import type { EntityConfig } from '../../src/modules/_base/entity-registry.js';

const dummySchema = Type.Object({ id: Type.String() });

const entityWithRelations: EntityConfig = {
  name: 'Test',
  tableName: 'tests',
  prismaModel: 'Test',
  apiPrefix: '/tests',
  tags: ['test'],
  readonly: false,
  softDelete: false,
  bulkOperations: false,
  columnNames: ['id', 'category_id'],
  searchableFields: [],
  fields: [],
  schema: dummySchema,
  createSchema: dummySchema,
  updateSchema: dummySchema,
  relations: {
    category: { model: 'Category', field: 'category_id' },
    tags: { model: 'Tag', field: 'tags' },
  },
};

const entityWithoutRelations: EntityConfig = {
  ...entityWithRelations,
  name: 'NoRel',
  tableName: 'no_rels',
  relations: undefined,
};

describe('parseExpandParam', () => {
  it('returns empty array for undefined', () => {
    expect(parseExpandParam(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseExpandParam('')).toEqual([]);
  });

  it('returns empty array for whitespace', () => {
    expect(parseExpandParam('   ')).toEqual([]);
  });

  it('parses comma-separated fields', () => {
    expect(parseExpandParam('category,tags')).toEqual(['category', 'tags']);
  });

  it('trims whitespace from fields', () => {
    expect(parseExpandParam(' category , tags ')).toEqual(['category', 'tags']);
  });

  it('filters out empty entries', () => {
    expect(parseExpandParam('category,,tags')).toEqual(['category', 'tags']);
  });
});

describe('buildIncludeFromExpand', () => {
  it('returns undefined for empty expand fields', () => {
    expect(buildIncludeFromExpand([], entityWithRelations)).toBeUndefined();
  });

  it('returns undefined when entity has no relations', () => {
    expect(buildIncludeFromExpand(['category'], entityWithoutRelations)).toBeUndefined();
  });

  it('builds include map for valid relations', () => {
    expect(buildIncludeFromExpand(['category'], entityWithRelations)).toEqual({ category: true });
  });

  it('builds include map for multiple relations', () => {
    expect(buildIncludeFromExpand(['category', 'tags'], entityWithRelations)).toEqual({
      category: true,
      tags: true,
    });
  });

  it('ignores unknown relation names', () => {
    expect(buildIncludeFromExpand(['unknown'], entityWithRelations)).toBeUndefined();
  });

  it('includes valid and ignores invalid', () => {
    expect(buildIncludeFromExpand(['category', 'unknown'], entityWithRelations)).toEqual({
      category: true,
    });
  });
});

describe('getExpandableFieldNames', () => {
  it('returns relation keys', () => {
    expect(getExpandableFieldNames(entityWithRelations)).toEqual(['category', 'tags']);
  });

  it('returns empty array when no relations', () => {
    expect(getExpandableFieldNames(entityWithoutRelations)).toEqual([]);
  });
});
