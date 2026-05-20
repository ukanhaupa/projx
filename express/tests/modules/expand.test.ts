import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  parseExpandParam,
  buildIncludeFromExpand,
  getExpandableFieldNames,
} from '../../src/modules/_base/expand.js';
import type { EntityConfig } from '../../src/modules/_base/entity-registry.js';

const dummySchema = z.object({ id: z.string() });

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
  it('returns an empty array for undefined', () => {
    expect(parseExpandParam(undefined)).toEqual([]);
  });

  it('returns an empty array for an empty string', () => {
    expect(parseExpandParam('')).toEqual([]);
  });

  it('returns an empty array for whitespace only', () => {
    expect(parseExpandParam('   ')).toEqual([]);
  });

  it('parses a single comma-separated value', () => {
    expect(parseExpandParam('category,tags')).toEqual(['category', 'tags']);
  });

  it('trims whitespace around each field', () => {
    expect(parseExpandParam(' category , tags ')).toEqual(['category', 'tags']);
  });

  it('filters out empty entries', () => {
    expect(parseExpandParam('category,,tags')).toEqual(['category', 'tags']);
  });
});

describe('buildIncludeFromExpand', () => {
  it('returns undefined when expand fields are empty', () => {
    expect(buildIncludeFromExpand([], entityWithRelations)).toBeUndefined();
  });

  it('returns undefined when the entity has no relations configured', () => {
    expect(
      buildIncludeFromExpand(['category'], entityWithoutRelations),
    ).toBeUndefined();
  });

  it('builds an include map for one valid relation', () => {
    expect(buildIncludeFromExpand(['category'], entityWithRelations)).toEqual({
      category: true,
    });
  });

  it('builds an include map for multiple valid relations', () => {
    expect(
      buildIncludeFromExpand(['category', 'tags'], entityWithRelations),
    ).toEqual({ category: true, tags: true });
  });

  it('returns undefined when only unknown relation names are passed', () => {
    expect(
      buildIncludeFromExpand(['unknown'], entityWithRelations),
    ).toBeUndefined();
  });

  it('keeps valid relations and drops unknown ones', () => {
    expect(
      buildIncludeFromExpand(['category', 'unknown'], entityWithRelations),
    ).toEqual({ category: true });
  });
});

describe('getExpandableFieldNames', () => {
  it('returns the list of configured relation keys', () => {
    expect(getExpandableFieldNames(entityWithRelations)).toEqual([
      'category',
      'tags',
    ]);
  });

  it('returns an empty array when no relations are configured', () => {
    expect(getExpandableFieldNames(entityWithoutRelations)).toEqual([]);
  });
});
