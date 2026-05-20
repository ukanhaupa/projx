import { describe, it, expect } from 'vitest';
import {
  extractFilters,
  buildWhereClause,
  buildSearchClause,
  buildOrderByClause,
  buildPagination,
  formatPaginatedResponse,
} from '../../src/modules/_base/query-engine.js';

const columns = new Set([
  'id',
  'name',
  'price',
  'is_active',
  'created_at',
  'category_id',
  'released_on',
]);

describe('extractFilters', () => {
  it('strips reserved params', () => {
    const filters = extractFilters({
      page: '1',
      page_size: '10',
      order_by: '-name',
      search: 'test',
      expand: 'category',
      name: 'Widget',
      is_active: 'true',
    });
    expect(filters).toEqual({ name: 'Widget', is_active: 'true' });
  });

  it('strips undefined and empty-string values', () => {
    const filters = extractFilters({
      name: '',
      price: undefined,
      is_active: 'true',
    });
    expect(filters).toEqual({ is_active: 'true' });
  });
});

describe('buildWhereClause', () => {
  it('builds exact match for a known column', () => {
    expect(buildWhereClause({ name: 'Widget' }, columns)).toEqual({
      name: 'Widget',
    });
  });

  it('ignores unknown columns', () => {
    expect(
      buildWhereClause({ unknown_field: 'value', name: 'Widget' }, columns),
    ).toEqual({ name: 'Widget' });
  });

  it('builds __in filter with trimmed non-empty values', () => {
    expect(
      buildWhereClause({ name__in: 'Widget, Gadget , ' }, columns),
    ).toEqual({ name: { in: ['Widget', 'Gadget'] } });
  });

  it('omits __in filter when all values are blank', () => {
    expect(buildWhereClause({ name__in: ', ,' }, columns)).toEqual({});
  });

  it('drops __in filter when column is unknown', () => {
    expect(buildWhereClause({ unknown__in: 'a,b' }, columns)).toEqual({});
  });

  it('builds __isnull true filter', () => {
    expect(buildWhereClause({ category_id__isnull: 'true' }, columns)).toEqual({
      category_id: null,
    });
  });

  it('builds __isnull false filter', () => {
    expect(buildWhereClause({ category_id__isnull: 'false' }, columns)).toEqual(
      { category_id: { not: null } },
    );
  });

  it('drops __isnull when column is unknown', () => {
    expect(buildWhereClause({ unknown__isnull: 'true' }, columns)).toEqual({});
  });

  it('merges __gte and __lte on the same column', () => {
    expect(
      buildWhereClause({ price__gte: '10', price__lte: '100' }, columns),
    ).toEqual({ price: { gte: 10, lte: 100 } });
  });

  it('merges __gt and __lt on the same column', () => {
    expect(
      buildWhereClause({ price__gt: '10', price__lt: '100' }, columns),
    ).toEqual({ price: { gt: 10, lt: 100 } });
  });

  it('drops __gte/__lte/__gt/__lt when column is unknown', () => {
    expect(
      buildWhereClause(
        {
          unknown__gte: '1',
          unknown__lte: '1',
          unknown__gt: '1',
          unknown__lt: '1',
        },
        columns,
      ),
    ).toEqual({});
  });

  it('coerces ISO date strings in comparison filters', () => {
    const where = buildWhereClause({ released_on__gte: '2024-01-15' }, columns);
    expect((where.released_on as { gte: Date }).gte).toBeInstanceOf(Date);
  });

  it('builds __like filter as case-insensitive contains', () => {
    expect(buildWhereClause({ name__like: 'wid' }, columns)).toEqual({
      name: { contains: 'wid', mode: 'insensitive' },
    });
  });

  it('drops __like when column is unknown', () => {
    expect(buildWhereClause({ unknown__like: 'x' }, columns)).toEqual({});
  });

  it('builds comma-separated IN filter from a plain column', () => {
    expect(buildWhereClause({ name: 'Widget,Gadget' }, columns)).toEqual({
      name: { in: ['Widget', 'Gadget'] },
    });
  });

  it('drops comma-list when every entry is blank', () => {
    expect(buildWhereClause({ name: ',,' }, columns)).toEqual({});
  });

  it('coerces boolean string values using columnTypes', () => {
    const types = new Map<string, string>([['is_active', 'boolean']]);
    expect(buildWhereClause({ is_active: 'TRUE' }, columns, types)).toEqual({
      is_active: true,
    });
  });

  it('coerces numeric string values using columnTypes', () => {
    const types = new Map<string, string>([['price', 'number']]);
    expect(buildWhereClause({ price: '42' }, columns, types)).toEqual({
      price: 42,
    });
  });

  it('falls back to the raw string when columnTypes number coercion fails', () => {
    const types = new Map<string, string>([['price', 'number']]);
    expect(buildWhereClause({ price: 'NaN-like' }, columns, types)).toEqual({
      price: 'NaN-like',
    });
  });

  it('coerces date strings using columnTypes', () => {
    const types = new Map<string, string>([['released_on', 'date']]);
    const where = buildWhereClause(
      { released_on: '2024-06-01' },
      columns,
      types,
    );
    expect(where.released_on).toBeInstanceOf(Date);
  });

  it('auto-coerces unannotated boolean and numeric strings', () => {
    expect(buildWhereClause({ is_active: 'false' }, columns)).toEqual({
      is_active: false,
    });
    expect(buildWhereClause({ price: '12' }, columns)).toEqual({ price: 12 });
    expect(buildWhereClause({ price: '12.5' }, columns)).toEqual({
      price: 12.5,
    });
  });
});

describe('buildSearchClause', () => {
  it('returns undefined for undefined, empty, and whitespace input', () => {
    expect(buildSearchClause(undefined, ['name'])).toBeUndefined();
    expect(buildSearchClause('', ['name'])).toBeUndefined();
    expect(buildSearchClause('   ', ['name'])).toBeUndefined();
  });

  it('returns undefined when no searchable fields are configured', () => {
    expect(buildSearchClause('test', [])).toBeUndefined();
  });

  it('builds an OR clause across every searchable field', () => {
    expect(buildSearchClause(' query ', ['name', 'description'])).toEqual({
      OR: [
        { name: { contains: 'query', mode: 'insensitive' } },
        { description: { contains: 'query', mode: 'insensitive' } },
      ],
    });
  });
});

describe('buildOrderByClause', () => {
  it('defaults to created_at desc when undefined or blank', () => {
    expect(buildOrderByClause(undefined, columns)).toEqual([
      { created_at: 'desc' },
    ]);
    expect(buildOrderByClause('   ', columns)).toEqual([
      { created_at: 'desc' },
    ]);
  });

  it('parses ascending and descending sorts', () => {
    expect(buildOrderByClause('name', columns)).toEqual([{ name: 'asc' }]);
    expect(buildOrderByClause('-price', columns)).toEqual([{ price: 'desc' }]);
  });

  it('parses multiple comma-separated columns', () => {
    expect(buildOrderByClause('-price,name', columns)).toEqual([
      { price: 'desc' },
      { name: 'asc' },
    ]);
  });

  it('drops unknown columns', () => {
    expect(buildOrderByClause('name,bogus_col', columns)).toEqual([
      { name: 'asc' },
    ]);
  });
});

describe('buildPagination', () => {
  it('computes skip and take from page and page_size', () => {
    expect(buildPagination(1, 10)).toEqual({ skip: 0, take: 10 });
    expect(buildPagination(3, 25)).toEqual({ skip: 50, take: 25 });
  });
});

describe('formatPaginatedResponse', () => {
  it('formats data with pagination metadata', () => {
    expect(formatPaginatedResponse(['a', 'b'], 5, 1, 2)).toEqual({
      data: ['a', 'b'],
      pagination: {
        current_page: 1,
        page_size: 2,
        total_pages: 3,
        total_records: 5,
      },
    });
  });

  it('reports total_pages=1 when total is zero', () => {
    const out = formatPaginatedResponse([], 0, 1, 10);
    expect(out.pagination.total_pages).toBe(1);
    expect(out.pagination.total_records).toBe(0);
  });
});
