import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import type { EntityOverride } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    raw: vi.fn(),
  },
}));

vi.mock('../../src/entities/overrides', () => ({
  entityOverrides: {} as Record<string, EntityOverride>,
}));

describe('entity loader', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('override deep merge', () => {
    it('merges columnOverrides into existing columns', async () => {
      const { entityOverrides } = await import('../../src/entities/overrides');
      (entityOverrides as Record<string, EntityOverride>)['test-entities'] = {
        columnOverrides: {
          name: { label: 'Full Name' },
        },
      };

      const { api } = await import('../../src/api');
      (api.raw as ReturnType<typeof vi.fn>).mockResolvedValue({
        entities: [
          {
            name: 'TestEntity',
            table_name: 'test_entities',
            api_prefix: '/test-entities',
            tags: [],
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
            ],
          },
        ],
      });

      const { loadEntities, resetEntityCache } =
        await import('../../src/entities/index');
      resetEntityCache();
      const entities = await loadEntities();

      const nameCol = entities[0].columns.find((c) => c.key === 'name');
      expect(nameCol?.label).toBe('Full Name');
      expect(nameCol?.filterable).toBe(true);
    });

    it('hides columns via columnOverrides hidden flag', async () => {
      const { entityOverrides } = await import('../../src/entities/overrides');
      (entityOverrides as Record<string, EntityOverride>)['test-entities'] = {
        columnOverrides: {
          id: { hidden: true },
        },
      };

      const { api } = await import('../../src/api');
      (api.raw as ReturnType<typeof vi.fn>).mockResolvedValue({
        entities: [
          {
            name: 'TestEntity',
            table_name: 'test_entities',
            api_prefix: '/test-entities',
            tags: [],
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
              },
            ],
          },
        ],
      });

      const { loadEntities, resetEntityCache } =
        await import('../../src/entities/index');
      resetEntityCache();
      const entities = await loadEntities();

      expect(entities[0].columns.find((c) => c.key === 'id')).toBeUndefined();
    });
  });

  describe('caching and getters', () => {
    it('returns cached entities on second call', async () => {
      const { api } = await import('../../src/api');
      (api.raw as ReturnType<typeof vi.fn>).mockResolvedValue({
        entities: [
          {
            name: 'TestEntity',
            table_name: 'test_entities',
            api_prefix: '/test-entities',
            tags: [],
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
            ],
          },
        ],
      });

      const { loadEntities, getEntities, resetEntityCache } =
        await import('../../src/entities/index');
      resetEntityCache();
      (api.raw as ReturnType<typeof vi.fn>).mockClear();
      await loadEntities();
      const first = getEntities();
      await loadEntities(); // Should return cached
      const second = getEntities();
      expect(first).toBe(second);
      expect(api.raw).toHaveBeenCalledTimes(1);
    });

    it('getEntities returns empty array before loading', async () => {
      const { getEntities, resetEntityCache } =
        await import('../../src/entities/index');
      resetEntityCache();
      expect(getEntities()).toEqual([]);
    });

    it('getEntityMeta returns meta entities', async () => {
      const { api } = await import('../../src/api');
      (api.raw as ReturnType<typeof vi.fn>).mockResolvedValue({
        entities: [
          {
            name: 'TestEntity',
            table_name: 'test_entities',
            api_prefix: '/test-entities',
            tags: [],
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
            ],
          },
        ],
      });

      const { loadEntities, getEntityMeta, resetEntityCache } =
        await import('../../src/entities/index');
      resetEntityCache();
      await loadEntities();
      const meta = getEntityMeta();
      expect(meta).toHaveLength(1);
      expect(meta[0].name).toBe('TestEntity');
    });

    it('getEntityMetaBySlug finds entity by api_prefix', async () => {
      const { api } = await import('../../src/api');
      (api.raw as ReturnType<typeof vi.fn>).mockResolvedValue({
        entities: [
          {
            name: 'TestEntity',
            table_name: 'test_entities',
            api_prefix: '/test-entities',
            tags: [],
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
            ],
          },
        ],
      });

      const { loadEntities, getEntityMetaBySlug, resetEntityCache } =
        await import('../../src/entities/index');
      resetEntityCache();
      await loadEntities();

      const found = getEntityMetaBySlug('test-entities');
      expect(found).toBeDefined();
      expect(found?.name).toBe('TestEntity');

      const notFound = getEntityMetaBySlug('nonexistent');
      expect(notFound).toBeUndefined();
    });

    it('resetEntityCache clears all caches', async () => {
      const { api } = await import('../../src/api');
      (api.raw as ReturnType<typeof vi.fn>).mockResolvedValue({
        entities: [
          {
            name: 'TestEntity',
            table_name: 'test_entities',
            api_prefix: '/test-entities',
            tags: [],
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
            ],
          },
        ],
      });

      const { loadEntities, getEntities, getEntityMeta, resetEntityCache } =
        await import('../../src/entities/index');
      resetEntityCache();
      await loadEntities();
      expect(getEntities()).toHaveLength(1);

      resetEntityCache();
      expect(getEntities()).toEqual([]);
      expect(getEntityMeta()).toEqual([]);
    });

    it('deduplicates concurrent loadEntities calls', async () => {
      const { api } = await import('../../src/api');
      (api.raw as ReturnType<typeof vi.fn>).mockResolvedValue({
        entities: [
          {
            name: 'TestEntity',
            table_name: 'test_entities',
            api_prefix: '/test-entities',
            tags: [],
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
            ],
          },
        ],
      });

      const { loadEntities, resetEntityCache } =
        await import('../../src/entities/index');
      resetEntityCache();
      (api.raw as ReturnType<typeof vi.fn>).mockClear();

      const [r1, r2] = await Promise.all([loadEntities(), loadEntities()]);
      expect(r1).toBe(r2);
      expect(api.raw).toHaveBeenCalledTimes(1);
    });
  });

  describe('fieldOverrides merge', () => {
    it('merges fieldOverrides into entity fields', async () => {
      const { entityOverrides } = await import('../../src/entities/overrides');
      (entityOverrides as Record<string, EntityOverride>)['test-entities'] = {
        fieldOverrides: {
          name: { label: 'Full Name', required: false },
        },
      };

      const { api } = await import('../../src/api');
      (api.raw as ReturnType<typeof vi.fn>).mockResolvedValue({
        entities: [
          {
            name: 'TestEntity',
            table_name: 'test_entities',
            api_prefix: '/test-entities',
            tags: [],
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
            ],
          },
        ],
      });

      const { loadEntities, resetEntityCache } =
        await import('../../src/entities/index');
      resetEntityCache();
      const entities = await loadEntities();

      const nameField = entities[0].fields?.find((f) => f.key === 'name');
      expect(nameField?.label).toBe('Full Name');
      expect(nameField?.required).toBe(false);
    });

    it('hides fields via fieldOverrides hidden flag', async () => {
      const { entityOverrides } = await import('../../src/entities/overrides');
      (entityOverrides as Record<string, EntityOverride>)['test-entities'] = {
        fieldOverrides: {
          name: { hidden: true },
        },
      };

      const { api } = await import('../../src/api');
      (api.raw as ReturnType<typeof vi.fn>).mockResolvedValue({
        entities: [
          {
            name: 'TestEntity',
            table_name: 'test_entities',
            api_prefix: '/test-entities',
            tags: [],
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
              },
            ],
          },
        ],
      });

      const { loadEntities, resetEntityCache } =
        await import('../../src/entities/index');
      resetEntityCache();
      const entities = await loadEntities();
      expect(entities[0].fields?.find((f) => f.key === 'name')).toBeUndefined();
    });
  });

  describe('timeout and retry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('rejects when fetch exceeds timeout', async () => {
      const { api } = await import('../../src/api');
      (api.raw as ReturnType<typeof vi.fn>).mockImplementation(
        (_path: string, init?: { signal?: AbortSignal }) =>
          new Promise((_, reject) => {
            if (init?.signal) {
              init.signal.addEventListener('abort', () =>
                reject(new DOMException('Aborted', 'AbortError')),
              );
            }
          }),
      );

      const { loadEntities, resetEntityCache } =
        await import('../../src/entities/index');
      resetEntityCache();
      const promise = loadEntities();

      vi.advanceTimersByTime(11_000);

      await expect(promise).rejects.toThrow();
    });

    it('allows retry after timeout failure', async () => {
      const { api } = await import('../../src/api');
      (api.raw as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(
          (_path: string, init?: { signal?: AbortSignal }) =>
            new Promise((_, reject) => {
              if (init?.signal) {
                init.signal.addEventListener('abort', () =>
                  reject(new DOMException('Aborted', 'AbortError')),
                );
              }
            }),
        )
        .mockResolvedValueOnce({
          entities: [
            {
              name: 'TestEntity',
              table_name: 'test_entities',
              api_prefix: '/test-entities',
              tags: [],
              readonly: false,
              soft_delete: false,
              bulk_operations: false,
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
              ],
            },
          ],
        });

      const { loadEntities, resetEntityCache } =
        await import('../../src/entities/index');
      resetEntityCache();

      const firstAttempt = loadEntities();
      vi.advanceTimersByTime(11_000);
      await expect(firstAttempt).rejects.toThrow();

      vi.useRealTimers();
      const entities = await loadEntities();
      expect(entities).toHaveLength(1);
    });
  });
});
