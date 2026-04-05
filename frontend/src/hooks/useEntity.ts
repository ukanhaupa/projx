import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ListParams, type PaginatedResponse } from '../api';
import type { EntityConfig } from '../types';
import { useEntityUrlState } from './useEntityUrlState';

interface PaginationState {
  current_page: number;
  page_size: number;
  total_pages: number;
  total_records: number;
}

export interface UseEntityReturn {
  items: Record<string, unknown>[];
  pagination: PaginationState | null;
  loading: boolean;
  error: string;

  search: string;
  setSearch: (value: string) => void;
  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;
  clearFilters: () => void;
  activeFilterCount: number;

  orderBy: string | null;
  orderDir: 'asc' | 'desc';
  toggleSort: (key: string) => void;

  page: number;
  setPage: (page: number) => void;
  pageSize: number;
  setPageSize: (size: number) => void;

  selectedIds: Set<string | number>;
  toggleSelect: (id: string | number) => void;
  toggleSelectAll: () => void;
  bulkRemove: () => Promise<void>;

  create: (data: Record<string, unknown>) => Promise<Record<string, unknown>>;
  update: (
    id: string | number,
    data: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  remove: (id: string | number) => Promise<void>;

  refresh: () => void;
}

export function useEntity(config: EntityConfig): UseEntityReturn {
  const urlState = useEntityUrlState(config);

  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [pagination, setPagination] = useState<PaginationState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(
    new Set(),
  );

  const [searchInput, setSearchInput] = useState(urlState.search);
  const [debouncedSearch, setDebouncedSearch] = useState(urlState.search);

  const fetchGen = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    orderBy,
    orderDir,
    toggleSort: urlToggleSort,
    filters,
    setFilter,
    clearFilters,
    activeFilterCount,
  } = urlState;

  const handleSearch = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setDebouncedSearch(value);
        urlState.setSearch(value);
      }, 400);
    },
    [urlState],
  );

  const fetchData = useCallback(async () => {
    const gen = ++fetchGen.current;
    setLoading(true);
    setError('');
    try {
      const params: ListParams = { page, page_size: pageSize };
      if (debouncedSearch) params.search = debouncedSearch;
      if (orderBy)
        params.order_by = [orderDir === 'desc' ? `-${orderBy}` : orderBy];
      if (config.expandFields?.length)
        params.expand = config.expandFields.join(',');
      Object.entries(filters).forEach(([k, v]) => {
        if (v) params[k] = v;
      });
      const result: PaginatedResponse = await api.list(
        config.apiPrefix,
        params,
      );
      if (gen === fetchGen.current) {
        setItems(result.data);
        setPagination(result.pagination);
        setSelectedIds(new Set());
      }
    } catch (e: unknown) {
      if (gen === fetchGen.current)
        setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      if (gen === fetchGen.current) setLoading(false);
    }
  }, [
    config.apiPrefix,
    config.expandFields,
    page,
    pageSize,
    debouncedSearch,
    orderBy,
    orderDir,
    filters,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  const create = useCallback(
    async (data: Record<string, unknown>) => {
      const result = await api.create(config.apiPrefix, data);
      setRefreshKey((k) => k + 1);
      return result;
    },
    [config.apiPrefix],
  );

  const update = useCallback(
    async (id: string | number, data: Record<string, unknown>) => {
      const result = await api.update(config.apiPrefix, id, data);
      setRefreshKey((k) => k + 1);
      return result;
    },
    [config.apiPrefix],
  );

  const remove = useCallback(
    async (id: string | number) => {
      await api.delete(config.apiPrefix, id);
      setRefreshKey((k) => k + 1);
    },
    [config.apiPrefix],
  );

  const toggleSelect = useCallback((id: string | number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allIds = items.map((r) => r.id as string | number);
      if (prev.size === allIds.length && allIds.every((id) => prev.has(id))) {
        return new Set();
      }
      return new Set(allIds);
    });
  }, [items]);

  const bulkRemove = useCallback(async () => {
    if (selectedIds.size === 0) return;
    await api.bulkDelete(config.apiPrefix, [...selectedIds]);
    setSelectedIds(new Set());
    setRefreshKey((k) => k + 1);
  }, [config.apiPrefix, selectedIds]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return {
    items,
    pagination,
    loading,
    error,
    search: searchInput,
    setSearch: handleSearch,
    filters,
    setFilter,
    clearFilters,
    activeFilterCount,
    orderBy,
    orderDir,
    toggleSort: urlToggleSort,
    page,
    setPage,
    pageSize,
    setPageSize,
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    bulkRemove,
    create,
    update,
    remove,
    refresh,
  };
}
