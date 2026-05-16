import { Op, type Order, type WhereOptions } from 'sequelize';

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
  const page_size = Math.min(100, Math.max(1, Number(params.get('page_size')) || 10));
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

export function buildWhere(
  attributes: Set<string>,
  filters: Record<string, string>,
): WhereOptions {
  const where: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (!attributes.has(key)) continue;
    where[key] = value;
  }
  return where as WhereOptions;
}

export function buildSearchWhere(
  searchableFields: string[],
  term: string | undefined,
): WhereOptions | undefined {
  if (!term) return undefined;
  const trimmed = term.trim();
  if (!trimmed || searchableFields.length === 0) return undefined;
  const pattern = `%${trimmed}%`;
  return {
    [Op.or]: searchableFields.map((field) => ({ [field]: { [Op.iLike]: pattern } })),
  } as WhereOptions;
}

export function combineWhere(a: WhereOptions, b?: WhereOptions): WhereOptions {
  if (!b) return a;
  return { [Op.and]: [a, b] } as WhereOptions;
}

export function buildOrder(
  attributes: Set<string>,
  orderBy: string | undefined,
): Order | undefined {
  if (!orderBy) return undefined;
  const out: [string, 'ASC' | 'DESC'][] = [];
  for (const raw of orderBy.split(',')) {
    const term = raw.trim();
    if (!term) continue;
    const descOrder = term.startsWith('-');
    const fieldName = descOrder ? term.slice(1) : term;
    if (!attributes.has(fieldName)) continue;
    out.push([fieldName, descOrder ? 'DESC' : 'ASC']);
  }
  return out.length > 0 ? (out as Order) : undefined;
}

export interface PaginationMeta {
  current_page: number;
  page_size: number;
  total_records: number;
  total_pages: number;
}

export function buildPagination(page: number, page_size: number, total: number): PaginationMeta {
  return {
    current_page: page,
    page_size,
    total_records: total,
    total_pages: Math.max(1, Math.ceil(total / page_size)),
  };
}
