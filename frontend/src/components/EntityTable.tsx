import { useEffect, useRef, useState } from 'react';
import { getEntityMetaBySlug } from '../entities';
import { formatCellValue } from '../entities/formatters';
import type { UseEntityReturn } from '../hooks/useEntity';
import type { Column, EntityConfig } from '../types';

export interface EntityTableProps {
  entity: EntityConfig;
  store: UseEntityReturn;
  onEdit?: (row: Record<string, unknown>) => void;
  onDelete?: (id: string | number) => void;
  onBulkDelete?: () => void;
}

const PAGE_SIZES = [10, 25, 50];
const SKELETON_ROW_COUNT = 5;
const MAX_PAGE_BUTTONS = 7;

function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= MAX_PAGE_BUTTONS) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | '...')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('...');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('...');
  pages.push(total);
  return pages;
}

export function EntityTable({
  entity,
  store,
  onEdit,
  onDelete,
  onBulkDelete,
}: EntityTableProps) {
  const [showFilters, setShowFilters] = useState(false);
  const meta = getEntityMetaBySlug(entity.slug);
  const metaFields = meta?.fields;
  const selectAllRef = useRef<HTMLInputElement>(null);

  const visibleColumns = entity.columns.filter((c) => !c.hidden);
  const filterableCols = visibleColumns.filter((c) => c.filterable);
  const hasActions = !!(onEdit || onDelete);
  const hasBulk = !!entity.bulkOperations;
  const colSpan =
    visibleColumns.length + (hasActions ? 1 : 0) + (hasBulk ? 1 : 0);

  const allSelected =
    store.items.length > 0 &&
    store.items.every((r) => store.selectedIds.has(r.id as string | number));
  const someSelected = store.selectedIds.size > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  const sortAriaLabel = (col: Column): string => {
    if (col.sortable === false) return col.label;
    if (store.orderBy !== col.key) return `${col.label}, sortable, not sorted`;
    return `${col.label}, sorted ${store.orderDir === 'asc' ? 'ascending' : 'descending'}`;
  };

  const sortAriaSort = (
    col: Column,
  ): 'ascending' | 'descending' | 'none' | undefined => {
    if (col.sortable === false) return undefined;
    if (store.orderBy !== col.key) return 'none';
    return store.orderDir === 'asc' ? 'ascending' : 'descending';
  };

  const sortIcon = (col: Column) => {
    if (col.sortable === false) return '';
    if (store.orderBy !== col.key) return ' \u2195';
    return store.orderDir === 'asc' ? ' \u2191' : ' \u2193';
  };

  const renderCell = (col: Column, row: Record<string, unknown>) => {
    const value = row[col.key];
    if (col.render) return col.render(value, row);
    const mf = metaFields?.find((f) => f.key === col.key);
    return formatCellValue(value, mf);
  };

  const pag = store.pagination;
  const startRecord = pag ? (pag.current_page - 1) * pag.page_size + 1 : 0;
  const endRecord = pag
    ? Math.min(pag.current_page * pag.page_size, pag.total_records)
    : 0;

  return (
    <div
      className='entity-table'
      role='region'
      aria-label={`${entity.name} data table`}
    >
      <div className='table-toolbar'>
        <input
          type='search'
          className='search-input'
          placeholder={`Search ${entity.name.toLowerCase()}...`}
          value={store.search}
          onChange={(e) => store.setSearch(e.target.value)}
          aria-label={`Search ${entity.name}`}
          data-search-input
        />
        {filterableCols.length > 0 && (
          <button
            className={`filter-toggle ${store.activeFilterCount ? 'active' : ''}`}
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
            aria-controls='filter-panel'
          >
            Filters
            {store.activeFilterCount > 0 && (
              <span aria-label={`${store.activeFilterCount} active filters`}>
                {' '}
                ({store.activeFilterCount})
              </span>
            )}
          </button>
        )}
      </div>

      {showFilters && (
        <div
          className='filter-panel'
          id='filter-panel'
          role='group'
          aria-label='Filters'
        >
          {filterableCols.map((col) => (
            <label key={col.key} className='filter-field'>
              <span>{col.label}</span>
              <input
                type='text'
                placeholder={`Filter by ${col.label.toLowerCase()}...`}
                value={store.filters[col.key] || ''}
                onChange={(e) => store.setFilter(col.key, e.target.value)}
                aria-label={`Filter by ${col.label}`}
              />
            </label>
          ))}
          {store.activeFilterCount > 0 && (
            <button className='clear-filters' onClick={store.clearFilters}>
              Clear all filters
            </button>
          )}
        </div>
      )}

      {hasBulk && store.selectedIds.size > 0 && onBulkDelete && (
        <div className='bulk-actions'>
          <button
            className='danger'
            onClick={onBulkDelete}
            aria-label={`Delete ${store.selectedIds.size} selected`}
          >
            Delete {store.selectedIds.size} selected
          </button>
        </div>
      )}

      {store.error && (
        <div className='error' role='alert'>
          {store.error}
          <button
            style={{
              marginLeft: 8,
              fontSize: 'inherit',
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              color: 'inherit',
              textDecoration: 'underline',
            }}
            onClick={store.refresh}
          >
            Retry
          </button>
        </div>
      )}

      <div className='table-scroll'>
        <table aria-label={entity.name}>
          <thead>
            <tr>
              {hasBulk && (
                <th scope='col' className='checkbox-col'>
                  <input
                    ref={selectAllRef}
                    type='checkbox'
                    checked={allSelected}
                    onChange={store.toggleSelectAll}
                    aria-label='Select all rows'
                  />
                </th>
              )}
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  onClick={
                    col.sortable !== false
                      ? () => store.toggleSort(col.key)
                      : undefined
                  }
                  aria-sort={sortAriaSort(col)}
                  aria-label={sortAriaLabel(col)}
                  scope='col'
                  tabIndex={col.sortable !== false ? 0 : undefined}
                  onKeyDown={
                    col.sortable !== false
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            store.toggleSort(col.key);
                          }
                        }
                      : undefined
                  }
                >
                  {col.label}
                  {sortIcon(col)}
                </th>
              ))}
              {hasActions && (
                <th scope='col'>
                  <span className='sr-only'>Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {store.loading ? (
              Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
                <tr key={`skeleton-${i}`} className='skeleton-row'>
                  {hasBulk && (
                    <td>
                      <div
                        className='skeleton-cell'
                        style={{ width: '16px' }}
                      />
                    </td>
                  )}
                  {visibleColumns.map((col) => (
                    <td key={col.key}>
                      <div className='skeleton-cell' />
                    </td>
                  ))}
                  {hasActions && (
                    <td>
                      <div
                        className='skeleton-cell'
                        style={{ width: '60px' }}
                      />
                    </td>
                  )}
                </tr>
              ))
            ) : !store.items.length ? (
              <tr>
                <td colSpan={colSpan} className='empty-state'>
                  {store.activeFilterCount > 0 || store.search
                    ? 'No results match your filters'
                    : `No ${entity.name.toLowerCase()} found`}
                </td>
              </tr>
            ) : (
              store.items.map((row) => (
                <tr key={String(row.id)}>
                  {hasBulk && (
                    <td className='checkbox-col'>
                      <input
                        type='checkbox'
                        checked={store.selectedIds.has(
                          row.id as string | number,
                        )}
                        onChange={() =>
                          store.toggleSelect(row.id as string | number)
                        }
                        aria-label={`Select record ${row.id}`}
                      />
                    </td>
                  )}
                  {visibleColumns.map((col) => (
                    <td key={col.key}>{renderCell(col, row)}</td>
                  ))}
                  {hasActions && (
                    <td className='actions'>
                      {onEdit && (
                        <button
                          onClick={() => onEdit(row)}
                          aria-label={`Edit record ${row.id}`}
                        >
                          Edit
                        </button>
                      )}
                      {onDelete && (
                        <button
                          className='danger'
                          onClick={() => onDelete(row.id as string | number)}
                          aria-label={`Delete record ${row.id}`}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pag && pag.total_records > 0 && (
        <div className='pagination' aria-label='Pagination'>
          <span className='pagination-info'>
            Showing {startRecord}-{endRecord} of {pag.total_records}
          </span>

          <div className='pagination-controls'>
            <label>
              <span className='sr-only'>Rows per page</span>
              <select
                className='page-size-select'
                value={store.pageSize}
                onChange={(e) => store.setPageSize(Number(e.target.value))}
                aria-label='Rows per page'
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>

            <button
              disabled={store.page <= 1}
              onClick={() => store.setPage(store.page - 1)}
              aria-label='Previous page'
            >
              Prev
            </button>
            {getPageNumbers(pag.current_page, pag.total_pages).map((p, i) =>
              p === '...' ? (
                <span key={`ellipsis-${i}`} className='pagination-ellipsis'>
                  ...
                </span>
              ) : (
                <button
                  key={p}
                  className={`pagination-page-btn${p === pag.current_page ? ' active' : ''}`}
                  onClick={() => store.setPage(p)}
                  aria-label={`Page ${p}`}
                  aria-current={p === pag.current_page ? 'page' : undefined}
                >
                  {p}
                </button>
              ),
            )}
            <button
              disabled={store.page >= pag.total_pages}
              onClick={() => store.setPage(store.page + 1)}
              aria-label='Next page'
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
