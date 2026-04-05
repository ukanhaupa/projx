import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { EntityConfig } from '../types';

const RESERVED_KEYS = new Set([
  'page',
  'page_size',
  'order_by',
  'order_dir',
  'search',
]);

export function useEntityUrlState(config: EntityConfig) {
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get('page')) || 1;
  const pageSize =
    Number(searchParams.get('page_size')) || config.defaultPageSize || 10;
  const search = searchParams.get('search') || '';
  const orderBy = searchParams.get('order_by') || config.defaultSort || null;
  const orderDir: 'asc' | 'desc' =
    (searchParams.get('order_dir') as 'asc' | 'desc') ||
    config.defaultSortDir ||
    'asc';

  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (!RESERVED_KEYS.has(key) && value) {
        f[key] = value;
      }
    });
    return f;
  }, [searchParams]);

  const activeFilterCount = Object.keys(filters).length;

  const update = useCallback(
    (updater: (params: URLSearchParams) => void) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        updater(next);
        next.forEach((v, k) => {
          if (!v) next.delete(k);
        });
        return next;
      });
    },
    [setSearchParams],
  );

  const setPage = useCallback(
    (p: number) => update((params) => params.set('page', String(p))),
    [update],
  );

  const setPageSize = useCallback(
    (size: number) =>
      update((params) => {
        params.set('page_size', String(size));
        params.set('page', '1');
      }),
    [update],
  );

  const setSearch = useCallback(
    (value: string) =>
      update((params) => {
        if (value) params.set('search', value);
        else params.delete('search');
        params.set('page', '1');
      }),
    [update],
  );

  const toggleSort = useCallback(
    (key: string) =>
      update((params) => {
        const currentOrderBy = params.get('order_by') || config.defaultSort;
        if (currentOrderBy === key) {
          const currentDir =
            params.get('order_dir') || config.defaultSortDir || 'asc';
          params.set('order_dir', currentDir === 'asc' ? 'desc' : 'asc');
        } else {
          params.set('order_by', key);
          params.set('order_dir', 'asc');
        }
      }),
    [update, config.defaultSort, config.defaultSortDir],
  );

  const setFilter = useCallback(
    (key: string, value: string) =>
      update((params) => {
        if (value) params.set(key, value);
        else params.delete(key);
        params.set('page', '1');
      }),
    [update],
  );

  const clearFilters = useCallback(
    () =>
      update((params) => {
        const keysToDelete: string[] = [];
        params.forEach((_, key) => {
          if (!RESERVED_KEYS.has(key)) keysToDelete.push(key);
        });
        keysToDelete.forEach((k) => params.delete(k));
        params.set('page', '1');
      }),
    [update],
  );

  return {
    page,
    pageSize,
    search,
    orderBy,
    orderDir,
    filters,
    activeFilterCount,
    setPage,
    setPageSize,
    setSearch,
    toggleSort,
    setFilter,
    clearFilters,
  };
}
