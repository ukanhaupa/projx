export interface QueryParams {
  page: number;
  page_size: number;
  order_by?: string;
  search?: string;
  expand?: string;
  [key: string]: unknown;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    current_page: number;
    page_size: number;
    total_pages: number;
    total_records: number;
  };
}

const RESERVED_PARAMS = new Set([
  'page',
  'page_size',
  'order_by',
  'search',
  'expand',
]);

export function extractFilters(
  query: Record<string, unknown>,
): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (RESERVED_PARAMS.has(key) || value === undefined || value === '')
      continue;
    filters[key] = value;
  }
  return filters;
}

export function buildWhereClause(
  filters: Record<string, unknown>,
  columnNames: Set<string>,
  columnTypes?: Map<string, string>,
): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  for (const [key, rawValue] of Object.entries(filters)) {
    const value = String(rawValue);

    if (key.endsWith('__in')) {
      const colName = key.slice(0, -4);
      if (!columnNames.has(colName)) continue;
      const values = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      if (values.length) where[colName] = { in: values };
      continue;
    }

    if (key.endsWith('__isnull')) {
      const colName = key.slice(0, -8);
      if (!columnNames.has(colName)) continue;
      const isNull = ['1', 'true'].includes(value.toLowerCase());
      where[colName] = isNull ? null : { not: null };
      continue;
    }

    if (key.endsWith('__gte')) {
      const colName = key.slice(0, -5);
      if (!columnNames.has(colName)) continue;
      where[colName] = {
        ...((where[colName] as Record<string, unknown>) ?? {}),
        gte: coerceValue(value),
      };
      continue;
    }

    if (key.endsWith('__lte')) {
      const colName = key.slice(0, -5);
      if (!columnNames.has(colName)) continue;
      where[colName] = {
        ...((where[colName] as Record<string, unknown>) ?? {}),
        lte: coerceValue(value),
      };
      continue;
    }

    if (key.endsWith('__gt')) {
      const colName = key.slice(0, -4);
      if (!columnNames.has(colName)) continue;
      where[colName] = {
        ...((where[colName] as Record<string, unknown>) ?? {}),
        gt: coerceValue(value),
      };
      continue;
    }

    if (key.endsWith('__lt')) {
      const colName = key.slice(0, -4);
      if (!columnNames.has(colName)) continue;
      where[colName] = {
        ...((where[colName] as Record<string, unknown>) ?? {}),
        lt: coerceValue(value),
      };
      continue;
    }

    if (key.endsWith('__like')) {
      const colName = key.slice(0, -6);
      if (!columnNames.has(colName)) continue;
      where[colName] = { contains: value, mode: 'insensitive' };
      continue;
    }

    if (!columnNames.has(key)) continue;

    if (value.includes(',')) {
      const values = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      if (values.length) where[key] = { in: values };
    } else {
      where[key] = coerceForColumn(key, value, columnTypes);
    }
  }

  return where;
}

export function buildSearchClause(
  search: string | undefined,
  searchableFields: string[],
): Record<string, unknown> | undefined {
  if (!search?.trim() || !searchableFields.length) return undefined;
  const pattern = search.trim();

  return {
    OR: searchableFields.map((field) => ({
      [field]: { contains: pattern, mode: 'insensitive' },
    })),
  };
}

export function buildOrderByClause(
  orderBy: string | undefined,
  columnNames: Set<string>,
): Array<Record<string, 'asc' | 'desc'>> {
  if (!orderBy?.trim()) {
    return [{ created_at: 'desc' }];
  }

  return orderBy
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean)
    .map((field) => {
      const descending = field.startsWith('-');
      const name = descending ? field.slice(1) : field;
      if (!columnNames.has(name)) return null;
      return { [name]: descending ? ('desc' as const) : ('asc' as const) };
    })
    .filter((item): item is Record<string, 'asc' | 'desc'> => item !== null);
}

export function buildPagination(page: number, pageSize: number) {
  return {
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

export function formatPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResponse<T> {
  return {
    data,
    pagination: {
      current_page: page,
      page_size: pageSize,
      total_pages: Math.ceil(total / pageSize) || 1,
      total_records: total,
    },
  };
}

function coerceValue(value: string): string | number | Date {
  if (/^\d+$/.test(value)) return Number(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return new Date(value);
  return value;
}

function coerceForColumn(
  key: string,
  value: string,
  columnTypes?: Map<string, string>,
): string | number | boolean | Date {
  if (columnTypes) {
    const colType = columnTypes.get(key);
    if (colType === 'boolean' || colType === 'bool') {
      return ['true', '1'].includes(value.toLowerCase());
    }
    if (colType === 'number' || colType === 'float' || colType === 'int') {
      const num = Number(value);
      return Number.isNaN(num) ? value : num;
    }
    if (colType === 'datetime' || colType === 'date') {
      return new Date(value);
    }
  }

  if (value === 'true' || value === 'false') return value === 'true';
  if (/^\d+$/.test(value)) return Number(value);
  if (/^\d+\.\d+$/.test(value)) return Number(value);
  return value;
}
