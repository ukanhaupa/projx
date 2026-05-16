import { ILike, type FindOptionsOrder, type FindOptionsWhere } from 'typeorm';

export interface ParsedQuery {
  page: number;
  page_size: number;
  order_by?: string;
  search?: string;
  filters: Record<string, string>;
}

const RESERVED = new Set(['page', 'page_size', 'order_by', 'search']);

export function parseRawQuery(rawQs: string): ParsedQuery {
  const params = new URLSearchParams(rawQs);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const page_size = Math.min(
    100,
    Math.max(1, Number(params.get('page_size')) || 10),
  );
  const filters: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (RESERVED.has(key)) continue;
    filters[key] = value;
  }
  return {
    page,
    page_size,
    order_by: params.get('order_by') ?? undefined,
    search: params.get('search') ?? undefined,
    filters,
  };
}

export function buildWhere<T>(
  columns: Set<string>,
  filters: Record<string, string>,
): FindOptionsWhere<T> {
  const where: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (!columns.has(key)) continue;
    where[key] = value;
  }
  return where as FindOptionsWhere<T>;
}

export function buildSearchWheres<T>(
  searchableFields: string[],
  term: string | undefined,
): FindOptionsWhere<T>[] {
  if (!term) return [];
  const trimmed = term.trim();
  if (!trimmed || searchableFields.length === 0) return [];
  const pattern = `%${trimmed}%`;
  return searchableFields.map(
    (field) => ({ [field]: ILike(pattern) }) as FindOptionsWhere<T>,
  );
}

export function buildOrder<T>(
  columns: Set<string>,
  orderBy: string | undefined,
): FindOptionsOrder<T> {
  if (!orderBy) return {} as FindOptionsOrder<T>;
  const out: Record<string, 'ASC' | 'DESC'> = {};
  for (const raw of orderBy.split(',')) {
    const term = raw.trim();
    if (!term) continue;
    const descOrder = term.startsWith('-');
    const fieldName = descOrder ? term.slice(1) : term;
    if (!columns.has(fieldName)) continue;
    out[fieldName] = descOrder ? 'DESC' : 'ASC';
  }
  return out as FindOptionsOrder<T>;
}

export interface PaginationMeta {
  current_page: number;
  page_size: number;
  total_records: number;
  total_pages: number;
}

export function buildPagination(
  page: number,
  page_size: number,
  total: number,
): PaginationMeta {
  return {
    current_page: page,
    page_size,
    total_records: total,
    total_pages: Math.max(1, Math.ceil(total / page_size)),
  };
}
