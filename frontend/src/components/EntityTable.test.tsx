import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseEntityReturn } from '../hooks/useEntity';
import {
  createMockEntityConfig,
  renderWithProviders,
} from '../testing/entity-test-utils';
import type { EntityConfig } from '../types';
import { EntityTable, type EntityTableProps } from './EntityTable';

vi.mock('../entities', () => ({
  getEntityMetaBySlug: vi.fn(() => undefined),
}));
vi.mock('../entities/formatters', () => ({
  formatCellValue: vi.fn((v: unknown) => (v == null ? '\u2014' : String(v))),
}));

function createMockStore(
  overrides: Partial<UseEntityReturn> = {},
): UseEntityReturn {
  return {
    items: [],
    pagination: null,
    loading: false,
    error: '',
    search: '',
    setSearch: vi.fn(),
    filters: {},
    setFilter: vi.fn(),
    clearFilters: vi.fn(),
    activeFilterCount: 0,
    orderBy: null,
    orderDir: 'asc',
    toggleSort: vi.fn(),
    page: 1,
    setPage: vi.fn(),
    pageSize: 10,
    setPageSize: vi.fn(),
    selectedIds: new Set<string | number>(),
    toggleSelect: vi.fn(),
    toggleSelectAll: vi.fn(),
    bulkRemove: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
}

describe('EntityTable', () => {
  let entity: EntityConfig;
  let store: UseEntityReturn;

  beforeEach(() => {
    entity = createMockEntityConfig();
    store = createMockStore();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderTable(overrides: Partial<EntityTableProps> = {}) {
    return renderWithProviders(
      <EntityTable entity={entity} store={store} {...overrides} />,
    );
  }

  it('renders column headers', () => {
    entity = createMockEntityConfig({ bulkOperations: false });
    renderTable();
    const table = screen.getByRole('table');
    const headers = within(table).getAllByRole('columnheader');
    expect(
      headers.map((h) => h.textContent?.replace(/\s*[↑↓↕]\s*/, '')),
    ).toEqual(['ID', 'Name', 'Status', 'Created At']);
  });

  it('hides hidden columns', () => {
    entity = createMockEntityConfig({
      columns: [
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Name', filterable: true },
        { key: 'secret', label: 'Secret', hidden: true },
        { key: 'status', label: 'Status', filterable: true },
      ],
    });
    renderTable();
    const table = screen.getByRole('table');
    const headers = within(table).getAllByRole('columnheader');
    const headerTexts = headers.map((h) =>
      h.textContent?.replace(/\s*[↑↓↕]\s*/, ''),
    );
    expect(headerTexts).not.toContain('Secret');
    expect(headerTexts).toContain('ID');
    expect(headerTexts).toContain('Name');
    expect(headerTexts).toContain('Status');
  });

  it('renders data rows', () => {
    entity = createMockEntityConfig({ bulkOperations: false });
    store = createMockStore({
      items: [
        { id: 1, name: 'Alpha', status: 'active', created_at: '2026-01-01' },
        { id: 2, name: 'Beta', status: 'inactive', created_at: '2026-02-01' },
      ],
    });
    renderTable({ onEdit: vi.fn() });
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    // 1 header row + 2 data rows
    expect(rows).toHaveLength(3);
    const firstDataRow = rows[1];
    const cells = within(firstDataRow).getAllByRole('cell');
    // formatCellValue is mocked to return String(v)
    expect(cells[0].textContent).toBe('1');
    expect(cells[1].textContent).toBe('Alpha');
    expect(cells[2].textContent).toBe('active');
    expect(cells[3].textContent).toBe('2026-01-01');
  });

  it('shows skeleton rows when loading', () => {
    store = createMockStore({ loading: true });
    renderTable();
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    // 1 header + 5 skeleton rows
    expect(rows).toHaveLength(6);
    rows.slice(1).forEach((row) => {
      expect(row.className).toContain('skeleton-row');
    });
  });

  it('shows empty state with no data', () => {
    store = createMockStore({ items: [] });
    renderTable();
    expect(screen.getByText('No test entity found')).toBeInTheDocument();
  });

  it('shows filtered empty state', () => {
    store = createMockStore({ items: [], activeFilterCount: 2 });
    renderTable();
    expect(
      screen.getByText('No results match your filters'),
    ).toBeInTheDocument();
  });

  it('search input calls setSearch', async () => {
    const user = userEvent.setup();
    renderTable();
    const searchInput = screen.getByRole('searchbox', {
      name: /search test entity/i,
    });
    await user.type(searchInput, 'hello');
    expect(store.setSearch).toHaveBeenCalled();
  });

  it('sortable header click calls toggleSort', async () => {
    const user = userEvent.setup();
    renderTable();
    // Name column is sortable by default (sortable is not false)
    const nameHeader = screen.getByRole('columnheader', { name: /name/i });
    await user.click(nameHeader);
    expect(store.toggleSort).toHaveBeenCalledWith('name');
  });

  it('aria-sort reflects sort state', () => {
    store = createMockStore({ orderBy: 'name', orderDir: 'asc' });
    renderTable();
    const nameHeader = screen.getByRole('columnheader', {
      name: /name.*ascending/i,
    });
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');

    cleanup();

    store = createMockStore({ orderBy: 'name', orderDir: 'desc' });
    renderTable();
    const nameHeaderDesc = screen.getByRole('columnheader', {
      name: /name.*descending/i,
    });
    expect(nameHeaderDesc).toHaveAttribute('aria-sort', 'descending');
  });

  it('filter toggle shows filter panel', async () => {
    const user = userEvent.setup();
    renderTable();
    expect(
      screen.queryByRole('group', { name: 'Filters' }),
    ).not.toBeInTheDocument();
    const filterButton = screen.getByRole('button', { name: /filters/i });
    await user.click(filterButton);
    expect(screen.getByRole('group', { name: 'Filters' })).toBeInTheDocument();
  });

  it('filter input calls setFilter', async () => {
    const user = userEvent.setup();
    renderTable();
    // Open filter panel
    await user.click(screen.getByRole('button', { name: /filters/i }));
    const nameFilter = screen.getByRole('textbox', { name: /filter by name/i });
    await user.type(nameFilter, 'test');
    expect(store.setFilter).toHaveBeenCalledWith('name', expect.any(String));
  });

  it('clear filters button calls clearFilters', async () => {
    const user = userEvent.setup();
    store = createMockStore({ activeFilterCount: 1, filters: { name: 'foo' } });
    renderTable();
    // Open filter panel
    await user.click(screen.getByRole('button', { name: /filters/i }));
    const clearBtn = screen.getByRole('button', { name: /clear all filters/i });
    await user.click(clearBtn);
    expect(store.clearFilters).toHaveBeenCalledTimes(1);
  });

  it('error state shows error and retry', async () => {
    const user = userEvent.setup();
    store = createMockStore({ error: 'Something went wrong' });
    renderTable();
    const errorEl = screen
      .getByText('Something went wrong')
      .closest('[role="alert"]')!;
    expect(errorEl).toBeInTheDocument();
    const retryBtn = within(errorEl as HTMLElement).getByRole('button', {
      name: /retry/i,
    });
    await user.click(retryBtn);
    expect(store.refresh).toHaveBeenCalledTimes(1);
  });

  it('edit button calls onEdit', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const row = {
      id: 1,
      name: 'Alpha',
      status: 'active',
      created_at: '2026-01-01',
    };
    store = createMockStore({ items: [row] });
    renderTable({ onEdit });
    const editBtn = screen.getByRole('button', { name: /edit record 1/i });
    await user.click(editBtn);
    expect(onEdit).toHaveBeenCalledWith(row);
  });

  it('delete button calls onDelete', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const row = {
      id: 42,
      name: 'Beta',
      status: 'inactive',
      created_at: '2026-02-01',
    };
    store = createMockStore({ items: [row] });
    renderTable({ onDelete });
    const deleteBtn = screen.getByRole('button', { name: /delete record 42/i });
    await user.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledWith(42);
  });

  it('no actions column when no handlers', () => {
    entity = createMockEntityConfig({ bulkOperations: false });
    store = createMockStore({
      items: [{ id: 1, name: 'A', status: 'active', created_at: '2026-01-01' }],
    });
    renderTable({ onEdit: undefined, onDelete: undefined });
    const table = screen.getByRole('table');
    const headers = within(table).getAllByRole('columnheader');
    // 4 visible columns, no actions column, no checkbox column
    expect(headers).toHaveLength(4);
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('pagination prev/next', async () => {
    const user = userEvent.setup();
    store = createMockStore({
      items: [{ id: 1, name: 'A', status: 'active', created_at: '2026-01-01' }],
      page: 2,
      pagination: {
        current_page: 2,
        page_size: 10,
        total_pages: 3,
        total_records: 25,
      },
    });
    renderTable();
    const prevBtn = screen.getByRole('button', { name: /previous page/i });
    const nextBtn = screen.getByRole('button', { name: /next page/i });
    await user.click(prevBtn);
    expect(store.setPage).toHaveBeenCalledWith(1);
    await user.click(nextBtn);
    expect(store.setPage).toHaveBeenCalledWith(3);
  });

  it('prev disabled on page 1', () => {
    store = createMockStore({
      items: [{ id: 1, name: 'A', status: 'active', created_at: '2026-01-01' }],
      page: 1,
      pagination: {
        current_page: 1,
        page_size: 10,
        total_pages: 3,
        total_records: 25,
      },
    });
    renderTable();
    const prevBtn = screen.getByRole('button', { name: /previous page/i });
    expect(prevBtn).toBeDisabled();
  });

  it('next disabled on last page', () => {
    store = createMockStore({
      items: [{ id: 1, name: 'A', status: 'active', created_at: '2026-01-01' }],
      page: 3,
      pagination: {
        current_page: 3,
        page_size: 10,
        total_pages: 3,
        total_records: 25,
      },
    });
    renderTable();
    const nextBtn = screen.getByRole('button', { name: /next page/i });
    expect(nextBtn).toBeDisabled();
  });

  it('page size select calls setPageSize', async () => {
    const user = userEvent.setup();
    store = createMockStore({
      items: [{ id: 1, name: 'A', status: 'active', created_at: '2026-01-01' }],
      page: 1,
      pageSize: 10,
      pagination: {
        current_page: 1,
        page_size: 10,
        total_pages: 3,
        total_records: 25,
      },
    });
    renderTable();
    const select = screen.getByRole('combobox', { name: /rows per page/i });
    await user.selectOptions(select, '25');
    expect(store.setPageSize).toHaveBeenCalledWith(25);
  });

  it('pagination not shown when no data', () => {
    store = createMockStore({ items: [], pagination: null });
    renderTable();
    expect(
      screen.queryByRole('button', { name: /previous page/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /next page/i }),
    ).not.toBeInTheDocument();
  });

  it('table has aria-label', () => {
    renderTable();
    const table = screen.getByRole('table');
    expect(table).toHaveAttribute('aria-label', 'Test Entity');
  });

  describe('page jump buttons', () => {
    it('renders page number buttons', () => {
      store = createMockStore({
        items: [
          { id: 1, name: 'A', status: 'active', created_at: '2026-01-01' },
        ],
        page: 1,
        pagination: {
          current_page: 1,
          page_size: 10,
          total_pages: 5,
          total_records: 50,
        },
      });
      entity = createMockEntityConfig({ bulkOperations: false });
      renderTable();
      for (let i = 1; i <= 5; i++) {
        expect(
          screen.getByRole('button', { name: `Page ${i}` }),
        ).toBeInTheDocument();
      }
    });

    it('clicking page number calls setPage', async () => {
      const user = userEvent.setup();
      store = createMockStore({
        items: [
          { id: 1, name: 'A', status: 'active', created_at: '2026-01-01' },
        ],
        page: 1,
        pagination: {
          current_page: 1,
          page_size: 10,
          total_pages: 5,
          total_records: 50,
        },
      });
      entity = createMockEntityConfig({ bulkOperations: false });
      renderTable();
      await user.click(screen.getByRole('button', { name: 'Page 3' }));
      expect(store.setPage).toHaveBeenCalledWith(3);
    });

    it('current page has aria-current', () => {
      store = createMockStore({
        items: [
          { id: 1, name: 'A', status: 'active', created_at: '2026-01-01' },
        ],
        page: 2,
        pagination: {
          current_page: 2,
          page_size: 10,
          total_pages: 5,
          total_records: 50,
        },
      });
      entity = createMockEntityConfig({ bulkOperations: false });
      renderTable();
      const page2Btn = screen.getByRole('button', { name: 'Page 2' });
      expect(page2Btn).toHaveAttribute('aria-current', 'page');
    });

    it('shows ellipsis for many pages', () => {
      store = createMockStore({
        items: [
          { id: 1, name: 'A', status: 'active', created_at: '2026-01-01' },
        ],
        page: 5,
        pagination: {
          current_page: 5,
          page_size: 10,
          total_pages: 20,
          total_records: 200,
        },
      });
      entity = createMockEntityConfig({ bulkOperations: false });
      renderTable();
      const ellipses = screen.getAllByText('...');
      expect(ellipses.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('bulk operations', () => {
    const rows = [
      { id: 1, name: 'Alpha', status: 'active', created_at: '2026-01-01' },
      { id: 2, name: 'Beta', status: 'inactive', created_at: '2026-02-01' },
    ];

    it('shows checkboxes when bulkDelete is enabled', () => {
      store = createMockStore({ items: rows });
      entity = createMockEntityConfig({ bulkOperations: true });
      renderTable({ onDelete: vi.fn() });
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBeGreaterThanOrEqual(3);
    });

    it('does not show checkboxes when bulkOperations is false', () => {
      store = createMockStore({ items: rows });
      entity = createMockEntityConfig({ bulkOperations: false });
      renderTable({ onDelete: vi.fn() });
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('header checkbox calls toggleSelectAll', async () => {
      const user = userEvent.setup();
      store = createMockStore({ items: rows });
      entity = createMockEntityConfig({ bulkOperations: true });
      renderTable({ onDelete: vi.fn() });
      const headerCheckbox = screen.getByRole('checkbox', {
        name: /select all/i,
      });
      await user.click(headerCheckbox);
      expect(store.toggleSelectAll).toHaveBeenCalledTimes(1);
    });

    it('row checkbox calls toggleSelect', async () => {
      const user = userEvent.setup();
      store = createMockStore({ items: rows });
      entity = createMockEntityConfig({ bulkOperations: true });
      renderTable({ onDelete: vi.fn() });
      const rowCheckboxes = screen.getAllByRole('checkbox', {
        name: /select record/i,
      });
      await user.click(rowCheckboxes[0]);
      expect(store.toggleSelect).toHaveBeenCalledWith(1);
    });

    it('shows bulk delete button when items selected', () => {
      store = createMockStore({
        items: rows,
        selectedIds: new Set([1, 2]),
      });
      entity = createMockEntityConfig({ bulkOperations: true });
      renderTable({ onBulkDelete: vi.fn() });
      expect(
        screen.getByRole('button', { name: /delete 2 selected/i }),
      ).toBeInTheDocument();
    });

    it('hides bulk delete button when nothing selected', () => {
      store = createMockStore({ items: rows, selectedIds: new Set() });
      entity = createMockEntityConfig({ bulkOperations: true });
      renderTable({ onBulkDelete: vi.fn() });
      expect(
        screen.queryByRole('button', { name: /delete.*selected/i }),
      ).not.toBeInTheDocument();
    });

    it('bulk delete button calls onBulkDelete', async () => {
      const user = userEvent.setup();
      const onBulkDelete = vi.fn();
      store = createMockStore({
        items: rows,
        selectedIds: new Set([1]),
      });
      entity = createMockEntityConfig({ bulkOperations: true });
      renderTable({ onBulkDelete });
      await user.click(
        screen.getByRole('button', { name: /delete 1 selected/i }),
      );
      expect(onBulkDelete).toHaveBeenCalledTimes(1);
    });

    it('header checkbox shows indeterminate when some selected', () => {
      store = createMockStore({
        items: rows,
        selectedIds: new Set([1]),
      });
      entity = createMockEntityConfig({ bulkOperations: true });
      renderTable({ onDelete: vi.fn() });
      const headerCheckbox = screen.getByRole('checkbox', {
        name: /select all/i,
      }) as HTMLInputElement;
      expect(headerCheckbox.indeterminate).toBe(true);
    });
  });
});
