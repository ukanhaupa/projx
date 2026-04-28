import { render, type RenderResult } from '@testing-library/react';
import { type ReactElement } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ConfirmProvider } from '../../src/components/ConfirmDialog';
import { ToastProvider } from '../../src/components/Toast';
import { ThemeProvider } from '../../src/theme';
import type { EntityConfig, MetaEntity } from '../../src/types';

export function renderWithProviders(ui: ReactElement): RenderResult {
  return render(
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>{ui}</ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>,
  );
}

export function createMockEntityConfig(
  overrides: Partial<EntityConfig> = {},
): EntityConfig {
  const defaults: EntityConfig = {
    name: 'Test Entity',
    slug: 'test-entities',
    apiPrefix: '/test-entities',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'Name', filterable: true },
      { key: 'status', label: 'Status', filterable: true },
      { key: 'created_at', label: 'Created At' },
    ],
    fields: [
      {
        key: 'name',
        label: 'Name',
        type: 'text',
        required: true,
        max_length: 255,
      },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        options: ['active', 'inactive'],
      },
    ],
    bulkOperations: true,
  };
  return { ...defaults, ...overrides };
}

export function createMockReadonlyConfig(
  overrides: Partial<EntityConfig> = {},
): EntityConfig {
  return createMockEntityConfig({
    name: 'Audit Log',
    slug: 'audit-logs',
    apiPrefix: '/audit-logs',
    fields: undefined,
    ...overrides,
  });
}

export function createMockMetaEntity(
  overrides: Partial<MetaEntity> = {},
): MetaEntity {
  return {
    name: 'TestEntity',
    table_name: 'test_entities',
    api_prefix: '/test-entities',
    tags: ['test-entities'],
    readonly: false,
    soft_delete: false,
    bulk_operations: true,
    fields: [
      {
        key: 'id',
        label: 'Id',
        type: 'int',
        nullable: false,
        is_auto: true,
        is_primary_key: true,
        filterable: true,
        has_foreign_key: false,
        field_type: 'text',
      },
      {
        key: 'name',
        label: 'Name',
        type: 'str',
        nullable: false,
        is_auto: false,
        is_primary_key: false,
        filterable: true,
        has_foreign_key: false,
        field_type: 'text',
        max_length: 255,
      },
      {
        key: 'created_at',
        label: 'Created At',
        type: 'datetime',
        nullable: false,
        is_auto: true,
        is_primary_key: false,
        filterable: true,
        has_foreign_key: false,
        field_type: 'datetime',
      },
    ],
    ...overrides,
  };
}

export function createMockListResponse(
  items: Record<string, unknown>[],
  page = 1,
  pageSize = 10,
) {
  return {
    data: items,
    pagination: {
      current_page: page,
      page_size: pageSize,
      total_pages: Math.ceil(items.length / pageSize) || 1,
      total_records: items.length,
    },
  };
}

export function createMockRows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
    status: i % 2 === 0 ? 'active' : 'inactive',
    created_at: '2026-01-01T00:00:00Z',
  }));
}
