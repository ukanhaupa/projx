import { type SQL, and, asc, desc, eq, ilike, or } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

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

function column(table: PgTable, key: string): unknown {
  return (table as unknown as Record<string, unknown>)[key];
}

export function buildWhere(table: PgTable, filters: Record<string, string>): SQL | undefined {
  const clauses: SQL[] = [];
  for (const [key, value] of Object.entries(filters)) {
    const col = column(table, key);
    if (!col) continue;
    clauses.push(eq(col as Parameters<typeof eq>[0], value));
  }
  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return and(...clauses);
}

export function buildSearchWhere(
  table: PgTable,
  searchableFields: string[],
  term: string | undefined,
): SQL | undefined {
  if (!term) return undefined;
  const trimmed = term.trim();
  if (!trimmed) return undefined;
  const pattern = `%${trimmed}%`;
  const clauses: SQL[] = [];
  for (const field of searchableFields) {
    const col = column(table, field);
    if (!col) continue;
    clauses.push(ilike(col as Parameters<typeof ilike>[0], pattern));
  }
  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return or(...clauses);
}

export function buildOrderBy(table: PgTable, orderBy: string | undefined): SQL[] {
  if (!orderBy) return [];
  const out: SQL[] = [];
  for (const raw of orderBy.split(',')) {
    const term = raw.trim();
    if (!term) continue;
    const descOrder = term.startsWith('-');
    const fieldName = descOrder ? term.slice(1) : term;
    const col = column(table, fieldName);
    if (!col) continue;
    out.push((descOrder ? desc : asc)(col as Parameters<typeof asc>[0]));
  }
  return out;
}

export function combineWhere(a?: SQL, b?: SQL): SQL | undefined {
  if (a && b) return and(a, b);
  return a ?? b;
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
