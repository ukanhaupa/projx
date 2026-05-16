import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { createMockEntityConfig } from '../testing/entity-test-utils';
import { useEntityUrlState } from '../../src/hooks/useEntityUrlState';

function wrapper(initialEntries: string[] = ['/']) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    );
  };
}

describe('useEntityUrlState', () => {
  const config = createMockEntityConfig();

  it('reads defaults when URL has no params', () => {
    const { result } = renderHook(() => useEntityUrlState(config), {
      wrapper: wrapper(),
    });
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(10);
    expect(result.current.search).toBe('');
    expect(result.current.orderBy).toBeNull();
    expect(result.current.orderDir).toBe('asc');
    expect(result.current.filters).toEqual({});
  });

  it('reads state from URL params', () => {
    const { result } = renderHook(() => useEntityUrlState(config), {
      wrapper: wrapper([
        '/?page=2&page_size=25&order_by=name&order_dir=desc&search=foo&status=active',
      ]),
    });
    expect(result.current.page).toBe(2);
    expect(result.current.pageSize).toBe(25);
    expect(result.current.search).toBe('foo');
    expect(result.current.orderBy).toBe('name');
    expect(result.current.orderDir).toBe('desc');
    expect(result.current.filters).toEqual({ status: 'active' });
  });

  it('setPage updates URL', () => {
    const { result } = renderHook(() => useEntityUrlState(config), {
      wrapper: wrapper(),
    });
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
  });

  it('setPageSize updates URL and resets page', () => {
    const { result } = renderHook(() => useEntityUrlState(config), {
      wrapper: wrapper(['/?page=3']),
    });
    act(() => result.current.setPageSize(50));
    expect(result.current.pageSize).toBe(50);
    expect(result.current.page).toBe(1);
  });

  it('setSearch updates URL and resets page', () => {
    const { result } = renderHook(() => useEntityUrlState(config), {
      wrapper: wrapper(['/?page=2']),
    });
    act(() => result.current.setSearch('test'));
    expect(result.current.search).toBe('test');
    expect(result.current.page).toBe(1);
  });

  it('toggleSort updates URL', () => {
    const { result } = renderHook(() => useEntityUrlState(config), {
      wrapper: wrapper(),
    });
    act(() => result.current.toggleSort('name'));
    expect(result.current.orderBy).toBe('name');
    expect(result.current.orderDir).toBe('asc');

    act(() => result.current.toggleSort('name'));
    expect(result.current.orderDir).toBe('desc');
  });

  it('setFilter updates URL and resets page', () => {
    const { result } = renderHook(() => useEntityUrlState(config), {
      wrapper: wrapper(['/?page=3']),
    });
    act(() => result.current.setFilter('status', 'active'));
    expect(result.current.filters).toEqual({ status: 'active' });
    expect(result.current.page).toBe(1);
  });

  it('clearFilters removes filter params and resets page', () => {
    const { result } = renderHook(() => useEntityUrlState(config), {
      wrapper: wrapper(['/?status=active&name=foo&page=2']),
    });
    act(() => result.current.clearFilters());
    expect(result.current.filters).toEqual({});
    expect(result.current.page).toBe(1);
  });

  it('uses config defaults when no URL params', () => {
    const customConfig = createMockEntityConfig({
      defaultSort: 'name',
      defaultSortDir: 'desc',
      defaultPageSize: 25,
    });
    const { result } = renderHook(() => useEntityUrlState(customConfig), {
      wrapper: wrapper(),
    });
    expect(result.current.orderBy).toBe('name');
    expect(result.current.orderDir).toBe('desc');
    expect(result.current.pageSize).toBe(25);
  });
});
