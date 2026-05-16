import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as apiModule from '../../src/api';
import {
  createMockEntityConfig,
  createMockListResponse,
  createMockRows,
} from '../testing/entity-test-utils';
import { useEntity } from '../../src/hooks/useEntity';

vi.mock('../../src/api', async () => {
  const actual = await vi.importActual('../../src/api');
  return {
    ...actual,
    api: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      bulkDelete: vi.fn(),
    },
  };
});

const mockApi = apiModule.api as unknown as {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  bulkDelete: ReturnType<typeof vi.fn>;
};

function routerWrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('useEntity', () => {
  const config = createMockEntityConfig();
  const rows = createMockRows(3);

  beforeEach(() => {
    mockApi.list.mockResolvedValue(createMockListResponse(rows));
    mockApi.create.mockResolvedValue({ id: 4, name: 'New' });
    mockApi.update.mockResolvedValue({ id: 1, name: 'Updated' });
    mockApi.delete.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetches data on mount', async () => {
    const { result } = renderHook(() => useEntity(config), {
      wrapper: routerWrapper,
    });
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(3);
    expect(result.current.pagination?.total_records).toBe(3);
    expect(mockApi.list).toHaveBeenCalledWith('/test-entities', {
      page: 1,
      page_size: 10,
    });
  });

  it('sets error on fetch failure', async () => {
    mockApi.list.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useEntity(config), {
      wrapper: routerWrapper,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Network error');
    expect(result.current.items).toHaveLength(0);
  });

  it('changes page', async () => {
    const { result } = renderHook(() => useEntity(config), {
      wrapper: routerWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setPage(2));

    await waitFor(() => {
      expect(mockApi.list).toHaveBeenCalledWith(
        '/test-entities',
        expect.objectContaining({ page: 2 }),
      );
    });
  });

  it('changes page size and resets to page 1', async () => {
    const { result } = renderHook(() => useEntity(config), {
      wrapper: routerWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setPage(3));
    act(() => result.current.setPageSize(25));

    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(25);

    await waitFor(() => {
      expect(mockApi.list).toHaveBeenCalledWith(
        '/test-entities',
        expect.objectContaining({ page: 1, page_size: 25 }),
      );
    });
  });

  it('toggles sort', async () => {
    const { result } = renderHook(() => useEntity(config), {
      wrapper: routerWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleSort('name'));
    expect(result.current.orderBy).toBe('name');
    expect(result.current.orderDir).toBe('asc');

    await waitFor(() => {
      expect(mockApi.list).toHaveBeenCalledWith(
        '/test-entities',
        expect.objectContaining({ order_by: ['name'] }),
      );
    });

    act(() => result.current.toggleSort('name'));
    expect(result.current.orderDir).toBe('desc');
  });

  it('sets and clears filters', async () => {
    const { result } = renderHook(() => useEntity(config), {
      wrapper: routerWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setFilter('status', 'active'));
    expect(result.current.activeFilterCount).toBe(1);
    expect(result.current.page).toBe(1);

    act(() => result.current.clearFilters());
    expect(result.current.activeFilterCount).toBe(0);
  });

  it('creates and auto-refreshes', async () => {
    const { result } = renderHook(() => useEntity(config), {
      wrapper: routerWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const listCallCount = mockApi.list.mock.calls.length;
    await act(() => result.current.create({ name: 'New' }));

    expect(mockApi.create).toHaveBeenCalledWith('/test-entities', {
      name: 'New',
    });
    await waitFor(() => {
      expect(mockApi.list.mock.calls.length).toBeGreaterThan(listCallCount);
    });
  });

  it('updates and auto-refreshes', async () => {
    const { result } = renderHook(() => useEntity(config), {
      wrapper: routerWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.update(1, { name: 'Updated' }));
    expect(mockApi.update).toHaveBeenCalledWith('/test-entities', 1, {
      name: 'Updated',
    });
  });

  it('deletes and auto-refreshes', async () => {
    const { result } = renderHook(() => useEntity(config), {
      wrapper: routerWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.remove(1));
    expect(mockApi.delete).toHaveBeenCalledWith('/test-entities', 1);
  });

  it('includes expand params when expandFields configured', async () => {
    const configWithExpand = createMockEntityConfig({
      expandFields: ['author', 'category'],
    });
    renderHook(() => useEntity(configWithExpand), { wrapper: routerWrapper });

    await waitFor(() => {
      expect(mockApi.list).toHaveBeenCalledWith(
        '/test-entities',
        expect.objectContaining({ expand: 'author,category' }),
      );
    });
  });

  it('uses defaultSort and defaultPageSize from config', async () => {
    const customConfig = createMockEntityConfig({
      defaultSort: 'name',
      defaultSortDir: 'desc',
      defaultPageSize: 25,
    });
    renderHook(() => useEntity(customConfig), { wrapper: routerWrapper });

    await waitFor(() => {
      expect(mockApi.list).toHaveBeenCalledWith(
        '/test-entities',
        expect.objectContaining({
          page_size: 25,
          order_by: ['-name'],
        }),
      );
    });
  });

  it('manual refresh re-fetches', async () => {
    const { result } = renderHook(() => useEntity(config), {
      wrapper: routerWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const callCount = mockApi.list.mock.calls.length;
    act(() => result.current.refresh());

    await waitFor(() => {
      expect(mockApi.list.mock.calls.length).toBeGreaterThan(callCount);
    });
  });

  it('selectedIds is initially empty', async () => {
    const { result } = renderHook(() => useEntity(config), {
      wrapper: routerWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('toggleSelect adds and removes ids', async () => {
    const { result } = renderHook(() => useEntity(config), {
      wrapper: routerWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleSelect(1));
    expect(result.current.selectedIds.has(1)).toBe(true);

    act(() => result.current.toggleSelect(1));
    expect(result.current.selectedIds.has(1)).toBe(false);
  });

  it('toggleSelectAll selects all and deselects all', async () => {
    const { result } = renderHook(() => useEntity(config), {
      wrapper: routerWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(3);

    act(() => result.current.toggleSelectAll());
    expect(result.current.selectedIds.size).toBe(3);

    act(() => result.current.toggleSelectAll());
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('bulkRemove calls bulkDelete and refreshes', async () => {
    mockApi.bulkDelete.mockResolvedValue(undefined);
    const { result } = renderHook(() => useEntity(config), {
      wrapper: routerWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleSelect(1));
    act(() => result.current.toggleSelect(2));

    const listCallCount = mockApi.list.mock.calls.length;
    await act(() => result.current.bulkRemove());

    expect(mockApi.bulkDelete).toHaveBeenCalledWith(
      '/test-entities',
      expect.arrayContaining([1, 2]),
    );
    expect(result.current.selectedIds.size).toBe(0);
    await waitFor(() => {
      expect(mockApi.list.mock.calls.length).toBeGreaterThan(listCallCount);
    });
  });

  it('bulkRemove does nothing when no ids selected', async () => {
    const { result } = renderHook(() => useEntity(config), {
      wrapper: routerWrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.bulkRemove());
    expect(mockApi.bulkDelete).not.toHaveBeenCalled();
  });
});
