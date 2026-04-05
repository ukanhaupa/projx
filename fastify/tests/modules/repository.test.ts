import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseRepository } from '../../src/modules/_base/repository.js';
import { NotFoundError } from '../../src/errors.js';

function createMockPrisma(modelName: string, overrides: Record<string, unknown> = {}) {
  const delegate = {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockImplementation(async (args: { data: unknown }) => ({
      id: 'new-id',
      ...(args.data as Record<string, unknown>),
    })),
    update: vi.fn().mockImplementation(async (args: { data: unknown; where: { id: string } }) => ({
      id: args.where.id,
      ...(args.data as Record<string, unknown>),
    })),
    delete: vi.fn().mockResolvedValue({}),
    createMany: vi.fn().mockResolvedValue({ count: 2 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    ...overrides,
  };

  const key = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  return { [key]: delegate } as never;
}

describe('BaseRepository', () => {
  const defaultOptions = {
    columnNames: ['id', 'name', 'created_at', 'updated_at'],
    searchableFields: ['name'],
    softDelete: false,
  };

  describe('constructor', () => {
    it('throws when prisma model is not found', () => {
      const prisma = {} as never;
      expect(() => new BaseRepository(prisma, 'NonExistent', defaultOptions)).toThrow(
        'Prisma model "NonExistent" not found',
      );
    });

    it('creates repository for valid model', () => {
      const prisma = createMockPrisma('Widget');
      const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
      expect(repo).toBeInstanceOf(BaseRepository);
    });
  });

  describe('findMany', () => {
    let repo: BaseRepository;
    let prisma: ReturnType<typeof createMockPrisma>;

    beforeEach(() => {
      prisma = createMockPrisma('Widget');
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        findMany: ReturnType<typeof vi.fn>;
        count: ReturnType<typeof vi.fn>;
      };
      delegate.findMany.mockResolvedValue([{ id: '1', name: 'Widget A' }]);
      delegate.count.mockResolvedValue(1);
      repo = new BaseRepository(prisma, 'Widget', defaultOptions);
    });

    it('returns data and total', async () => {
      const result = await repo.findMany({ page: 1, page_size: 10 });
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('passes include relations when provided', async () => {
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        findMany: ReturnType<typeof vi.fn>;
      };
      await repo.findMany({ page: 1, page_size: 10 }, { category: true });
      expect(delegate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ include: { category: true } }),
      );
    });

    it('does not pass include when empty object', async () => {
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        findMany: ReturnType<typeof vi.fn>;
      };
      await repo.findMany({ page: 1, page_size: 10 }, {});
      const callArgs = delegate.findMany.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.include).toBeUndefined();
    });

    it('applies search clause', async () => {
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        findMany: ReturnType<typeof vi.fn>;
        count: ReturnType<typeof vi.fn>;
      };
      await repo.findMany({ page: 1, page_size: 10, search: 'test' });
      const callArgs = delegate.findMany.mock.calls[0][0] as Record<string, unknown>;
      const where = callArgs.where as Record<string, unknown>;
      expect(where.AND).toBeDefined();
    });

    it('applies filter params', async () => {
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        findMany: ReturnType<typeof vi.fn>;
        count: ReturnType<typeof vi.fn>;
      };
      await repo.findMany({ page: 1, page_size: 10, name: 'test' });
      const callArgs = delegate.findMany.mock.calls[0][0] as Record<string, unknown>;
      const where = callArgs.where as Record<string, unknown>;
      expect(where.name).toBe('test');
    });

    it('applies order_by', async () => {
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        findMany: ReturnType<typeof vi.fn>;
      };
      await repo.findMany({ page: 1, page_size: 10, order_by: '-name' });
      const callArgs = delegate.findMany.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.orderBy).toEqual([{ name: 'desc' }]);
    });
  });

  describe('findById', () => {
    it('returns the record when found', async () => {
      const prisma = createMockPrisma('Widget');
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        findUnique: ReturnType<typeof vi.fn>;
      };
      delegate.findUnique.mockResolvedValue({ id: 'abc', name: 'Widget A' });

      const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
      const result = await repo.findById('abc');
      expect(result).toEqual({ id: 'abc', name: 'Widget A' });
    });

    it('throws NotFoundError when not found', async () => {
      const prisma = createMockPrisma('Widget');
      const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
      await expect(repo.findById('missing-id')).rejects.toThrow(NotFoundError);
    });

    it('passes include relations when provided', async () => {
      const prisma = createMockPrisma('Widget');
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        findUnique: ReturnType<typeof vi.fn>;
      };
      delegate.findUnique.mockResolvedValue({ id: 'abc', name: 'Widget A' });

      const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
      await repo.findById('abc', { category: true });
      expect(delegate.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ include: { category: true } }),
      );
    });

    it('does not pass include when empty object', async () => {
      const prisma = createMockPrisma('Widget');
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        findUnique: ReturnType<typeof vi.fn>;
      };
      delegate.findUnique.mockResolvedValue({ id: 'abc', name: 'Widget A' });

      const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
      await repo.findById('abc', {});
      const callArgs = delegate.findUnique.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.include).toBeUndefined();
    });
  });

  describe('create', () => {
    it('creates a record', async () => {
      const prisma = createMockPrisma('Widget');
      const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
      const result = await repo.create({ name: 'New Widget' });
      expect(result).toEqual({ id: 'new-id', name: 'New Widget' });
    });
  });

  describe('update', () => {
    it('updates an existing record', async () => {
      const prisma = createMockPrisma('Widget');
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        findUnique: ReturnType<typeof vi.fn>;
      };
      delegate.findUnique.mockResolvedValue({ id: 'abc', name: 'Old' });

      const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
      const result = await repo.update('abc', { name: 'Updated' });
      expect(result).toEqual({ id: 'abc', name: 'Updated' });
    });

    it('throws NotFoundError when record does not exist', async () => {
      const prisma = createMockPrisma('Widget');
      const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
      await expect(repo.update('missing', { name: 'test' })).rejects.toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    it('hard-deletes when softDelete is false', async () => {
      const prisma = createMockPrisma('Widget');
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        findUnique: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
      };
      delegate.findUnique.mockResolvedValue({ id: 'abc', name: 'Widget A' });

      const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
      await repo.delete('abc');
      expect(delegate.delete).toHaveBeenCalledWith({ where: { id: 'abc' } });
    });

    it('soft-deletes when softDelete is true', async () => {
      const prisma = createMockPrisma('Widget');
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        findUnique: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
      delegate.findUnique.mockResolvedValue({ id: 'abc', name: 'Widget A' });

      const repo = new BaseRepository(prisma, 'Widget', {
        ...defaultOptions,
        columnNames: [...defaultOptions.columnNames, 'deleted_at'],
        softDelete: true,
      });
      await repo.delete('abc');
      expect(delegate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'abc' },
          data: { deleted_at: expect.any(Date) },
        }),
      );
    });

    it('throws NotFoundError when record does not exist', async () => {
      const prisma = createMockPrisma('Widget');
      const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
      await expect(repo.delete('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('bulkCreate', () => {
    it('creates multiple records', async () => {
      const prisma = createMockPrisma('Widget');
      const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
      const result = await repo.bulkCreate([{ name: 'A' }, { name: 'B' }]);
      expect(result).toEqual({ count: 2 });
    });
  });

  describe('bulkDelete', () => {
    it('hard-deletes multiple records when softDelete is false', async () => {
      const prisma = createMockPrisma('Widget');
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        deleteMany: ReturnType<typeof vi.fn>;
      };

      const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
      await repo.bulkDelete(['id1', 'id2']);
      expect(delegate.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['id1', 'id2'] } },
      });
    });

    it('soft-deletes multiple records when softDelete is true', async () => {
      const prisma = createMockPrisma('Widget');
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        update: ReturnType<typeof vi.fn>;
      };

      const repo = new BaseRepository(prisma, 'Widget', {
        ...defaultOptions,
        columnNames: [...defaultOptions.columnNames, 'deleted_at'],
        softDelete: true,
      });
      await repo.bulkDelete(['id1', 'id2']);
      expect(delegate.update).toHaveBeenCalledTimes(2);
      expect(delegate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'id1', deleted_at: null },
          data: { deleted_at: expect.any(Date) },
        }),
      );
    });

    it('soft-delete skips records that do not exist', async () => {
      const prisma = createMockPrisma('Widget');
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        update: ReturnType<typeof vi.fn>;
      };
      delegate.update.mockRejectedValue(new Error('Record not found'));

      const repo = new BaseRepository(prisma, 'Widget', {
        ...defaultOptions,
        columnNames: [...defaultOptions.columnNames, 'deleted_at'],
        softDelete: true,
      });
      // Should not throw
      await repo.bulkDelete(['nonexistent']);
      expect(delegate.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('softDeleteWhere', () => {
    it('applies deleted_at filter when softDelete is enabled', async () => {
      const prisma = createMockPrisma('Widget');
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        findMany: ReturnType<typeof vi.fn>;
        count: ReturnType<typeof vi.fn>;
      };
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(0);

      const repo = new BaseRepository(prisma, 'Widget', {
        ...defaultOptions,
        columnNames: [...defaultOptions.columnNames, 'deleted_at'],
        softDelete: true,
      });
      await repo.findMany({ page: 1, page_size: 10 });
      const callArgs = delegate.findMany.mock.calls[0][0] as Record<string, unknown>;
      const where = callArgs.where as Record<string, unknown>;
      expect(where.deleted_at).toBeNull();
    });

    it('does not apply deleted_at filter when softDelete is disabled', async () => {
      const prisma = createMockPrisma('Widget');
      const delegate = (prisma as unknown as Record<string, unknown>).widget as {
        findMany: ReturnType<typeof vi.fn>;
        count: ReturnType<typeof vi.fn>;
      };
      delegate.findMany.mockResolvedValue([]);
      delegate.count.mockResolvedValue(0);

      const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
      await repo.findMany({ page: 1, page_size: 10 });
      const callArgs = delegate.findMany.mock.calls[0][0] as Record<string, unknown>;
      const where = callArgs.where as Record<string, unknown>;
      expect(where.deleted_at).toBeUndefined();
    });
  });
});
