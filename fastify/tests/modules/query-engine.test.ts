import { describe, it, expect } from 'vitest';
import {
  extractFilters,
  buildWhereClause,
  buildSearchClause,
  buildOrderByClause,
  buildPagination,
  formatPaginatedResponse,
} from '../../src/modules/_base/query-engine.js';

describe('Query Engine', () => {
  const columns = new Set([
    'id',
    'name',
    'price',
    'is_active',
    'created_at',
    'category_id',
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

    it('strips empty values', () => {
      const filters = extractFilters({
        name: '',
        price: undefined,
        is_active: 'true',
      });
      expect(filters).toEqual({ is_active: 'true' });
    });
  });

  describe('buildWhereClause', () => {
    it('builds exact match', () => {
      const where = buildWhereClause({ name: 'Widget' }, columns);
      expect(where).toEqual({ name: 'Widget' });
    });

    it('ignores unknown columns', () => {
      const where = buildWhereClause(
        { unknown_field: 'value', name: 'Widget' },
        columns,
      );
      expect(where).toEqual({ name: 'Widget' });
    });

    it('builds __in filter', () => {
      const where = buildWhereClause({ name__in: 'Widget,Gadget' }, columns);
      expect(where).toEqual({ name: { in: ['Widget', 'Gadget'] } });
    });

    it('builds __isnull filter (true)', () => {
      const where = buildWhereClause({ category_id__isnull: 'true' }, columns);
      expect(where).toEqual({ category_id: null });
    });

    it('builds __isnull filter (false)', () => {
      const where = buildWhereClause({ category_id__isnull: 'false' }, columns);
      expect(where).toEqual({ category_id: { not: null } });
    });

    it('builds __gte and __lte range filter', () => {
      const where = buildWhereClause(
        { price__gte: '10', price__lte: '100' },
        columns,
      );
      expect(where).toEqual({ price: { gte: 10, lte: 100 } });
    });

    it('builds __gt and __lt range filter', () => {
      const where = buildWhereClause(
        { price__gt: '10', price__lt: '100' },
        columns,
      );
      expect(where).toEqual({ price: { gt: 10, lt: 100 } });
    });

    it('builds __like filter', () => {
      const where = buildWhereClause({ name__like: 'wid' }, columns);
      expect(where).toEqual({ name: { contains: 'wid', mode: 'insensitive' } });
    });

    it('builds comma-separated IN filter', () => {
      const where = buildWhereClause({ name: 'Widget,Gadget' }, columns);
      expect(where).toEqual({ name: { in: ['Widget', 'Gadget'] } });
    });
  });

  describe('buildSearchClause', () => {
    it('returns undefined for empty search', () => {
      expect(buildSearchClause(undefined, ['name'])).toBeUndefined();
      expect(buildSearchClause('', ['name'])).toBeUndefined();
      expect(buildSearchClause('  ', ['name'])).toBeUndefined();
    });

    it('builds OR clause for searchable fields', () => {
      const clause = buildSearchClause('test', ['name', 'price']);
      expect(clause).toEqual({
        OR: [
          { name: { contains: 'test', mode: 'insensitive' } },
          { price: { contains: 'test', mode: 'insensitive' } },
        ],
      });
    });

    it('returns undefined when no searchable fields', () => {
      expect(buildSearchClause('test', [])).toBeUndefined();
    });
  });

  describe('buildOrderByClause', () => {
    it('defaults to created_at desc', () => {
      expect(buildOrderByClause(undefined, columns)).toEqual([
        { created_at: 'desc' },
      ]);
    });

    it('parses ascending sort', () => {
      expect(buildOrderByClause('name', columns)).toEqual([{ name: 'asc' }]);
    });

    it('parses descending sort', () => {
      expect(buildOrderByClause('-price', columns)).toEqual([
        { price: 'desc' },
      ]);
    });

    it('parses multi-column sort', () => {
      expect(buildOrderByClause('-price,name', columns)).toEqual([
        { price: 'desc' },
        { name: 'asc' },
      ]);
    });

    it('ignores invalid columns', () => {
      expect(buildOrderByClause('name,invalid_col', columns)).toEqual([
        { name: 'asc' },
      ]);
    });
  });

  describe('buildPagination', () => {
    it('calculates offset correctly', () => {
      expect(buildPagination(1, 10)).toEqual({ skip: 0, take: 10 });
      expect(buildPagination(3, 25)).toEqual({ skip: 50, take: 25 });
    });
  });

  describe('formatPaginatedResponse', () => {
    it('formats response correctly', () => {
      const result = formatPaginatedResponse(['a', 'b'], 5, 1, 2);
      expect(result).toEqual({
        data: ['a', 'b'],
        pagination: {
          current_page: 1,
          page_size: 2,
          total_pages: 3,
          total_records: 5,
        },
      });
    });

    it('handles empty data', () => {
      const result = formatPaginatedResponse([], 0, 1, 10);
      expect(result.pagination.total_pages).toBe(1);
      expect(result.pagination.total_records).toBe(0);
    });
  });
});
