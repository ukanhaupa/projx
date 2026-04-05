import { type APIRequestContext, expect } from '@playwright/test';
import { test as authTest } from './auth';
import { ConfirmDialogPage } from '../pages/confirm-dialog.page';
import { EntityFormPage } from '../pages/entity-form.page';
import { EntityListPage } from '../pages/entity-list.page';

const API_URL = process.env.VITE_API_URL || 'http://localhost:7860';

export interface MetaField {
  key: string;
  label: string;
  type: string;
  filterable: boolean;
  is_auto: boolean;
  required?: boolean;
}

export interface MetaEntity {
  name: string;
  api_prefix: string;
  readonly: boolean;
  soft_delete: boolean;
  bulk_operations: boolean;
  searchable_fields: string[];
  fields: MetaField[];
}

export async function fetchEntities(): Promise<MetaEntity[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/_meta`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.entities ?? [];
  } catch {
    return [];
  }
}

export async function createEntityViaApi(
  request: APIRequestContext,
  apiPrefix: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await request.post(`${API_URL}/api/v1${apiPrefix}`, {
    data,
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

export async function deleteEntityViaApi(
  request: APIRequestContext,
  apiPrefix: string,
  id: string | number,
): Promise<void> {
  await request.delete(`${API_URL}/api/v1${apiPrefix}/${id}`);
}

export type EntityFixtures = {
  entityListPage: EntityListPage;
  entityFormPage: EntityFormPage;
  confirmDialog: ConfirmDialogPage;
  meta: MetaEntity[];
};

export const test = authTest.extend<EntityFixtures>({
  entityListPage: async ({ page }, use) => {
    await use(new EntityListPage(page, ''));
  },

  entityFormPage: async ({ page }, use) => {
    await use(new EntityFormPage(page));
  },

  confirmDialog: async ({ page }, use) => {
    await use(new ConfirmDialogPage(page));
  },

  meta: async (_, use) => {
    const entities = await fetchEntities();
    await use(entities);
  },
});

export { expect };
