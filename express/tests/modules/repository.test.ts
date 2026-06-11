import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseRepository } from '../../src/modules/_base/repository.js';
import { NotFoundError } from '../../src/errors.js';

function createMockPrisma(modelName: string) {
  const delegate = {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockImplementation(async (args: { data: unknown }) => ({
      id: 'new-id',
      ...(args.data as Record<string, unknown>),
    })),
    update: vi
      .fn()
      .mockImplementation(
        async (args: { data: unknown; where: { id: string } }) => ({
          id: args.where.id,
          ...(args.data as Record<string, unknown>),
        }),
      ),
    delete: vi.fn().mockResolvedValue({}),
    createMany: vi.fn().mockResolvedValue({ count: 2 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
  };

  const key = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  return { [key]: delegate, _delegate: delegate } as unknown as {
    _delegate: typeof delegate;
  } & Record<string, typeof delegate>;
}

const defaultOptions = {
  columnNames: ['id', 'name', 'created_at', 'updated_at'],
  searchableFields: ['name'],
  softDelete: false,
};

describe('BaseRepository constructor', () => {
  it('throws when the Prisma model does not exist', () => {
    const prisma = {} as never;
    expect(
      () => new BaseRepository(prisma, 'NonExistent', defaultOptions),
    ).toThrow('Prisma model "NonExistent" not found');
  });

  it('constructs successfully for a valid Prisma model', () => {
    const prisma = createMockPrisma('Widget');
    const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
    expect(repo).toBeInstanceOf(BaseRepository);
  });
});

describe('BaseRepository.findMany', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let repo: BaseRepository;

  beforeEach(() => {
    prisma = createMockPrisma('Widget');
    prisma._delegate.findMany.mockResolvedValue([
      { id: '1', name: 'Widget A' },
    ]);
    prisma._delegate.count.mockResolvedValue(1);
    repo = new BaseRepository(prisma, 'Widget', defaultOptions);
  });

  it('returns data and total counts together', async () => {
    const result = await repo.findMany({ page: 1, page_size: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('passes include relations when provided', async () => {
    await repo.findMany({ page: 1, page_size: 10 }, { category: true });
    expect(prisma._delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { category: true } }),
    );
  });

  it('does not pass include when the relations object is empty', async () => {
    await repo.findMany({ page: 1, page_size: 10 }, {});
    const callArgs = prisma._delegate.findMany.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(callArgs.include).toBeUndefined();
  });

  it('threads search into the where clause via AND', async () => {
    await repo.findMany({ page: 1, page_size: 10, search: 'test' });
    const callArgs = prisma._delegate.findMany.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const where = callArgs.where as Record<string, unknown>;
    expect(where.AND).toBeDefined();
  });

  it('threads filter params into the where clause', async () => {
    await repo.findMany({ page: 1, page_size: 10, name: 'test' });
    const callArgs = prisma._delegate.findMany.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const where = callArgs.where as Record<string, unknown>;
    expect(where.name).toBe('test');
  });

  it('threads order_by into the find arguments', async () => {
    await repo.findMany({ page: 1, page_size: 10, order_by: '-name' });
    const callArgs = prisma._delegate.findMany.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(callArgs.orderBy).toEqual([{ name: 'desc' }]);
  });

  it('strips hidden fields from every record', async () => {
    prisma._delegate.findMany.mockResolvedValue([
      { id: '1', name: 'Widget A', password_hash: 'should-be-hidden' },
    ]);
    const hideRepo = new BaseRepository(prisma, 'Widget', {
      ...defaultOptions,
      hiddenFields: new Set(['password_hash']),
    });
    const result = await hideRepo.findMany({ page: 1, page_size: 10 });
    expect(result.data[0]).not.toHaveProperty('password_hash');
  });
});

describe('BaseRepository.findById', () => {
  it('returns the record when found', async () => {
    const prisma = createMockPrisma('Widget');
    prisma._delegate.findUnique.mockResolvedValue({
      id: 'abc',
      name: 'Widget A',
    });
    const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
    await expect(repo.findById('abc')).resolves.toEqual({
      id: 'abc',
      name: 'Widget A',
    });
  });

  it('throws NotFoundError when the record is missing', async () => {
    const prisma = createMockPrisma('Widget');
    const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
    await expect(repo.findById('missing-id')).rejects.toThrow(NotFoundError);
  });

  it('passes include relations when provided', async () => {
    const prisma = createMockPrisma('Widget');
    prisma._delegate.findUnique.mockResolvedValue({
      id: 'abc',
      name: 'Widget A',
    });
    const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
    await repo.findById('abc', { category: true });
    expect(prisma._delegate.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ include: { category: true } }),
    );
  });

  it('does not pass include when the relations object is empty', async () => {
    const prisma = createMockPrisma('Widget');
    prisma._delegate.findUnique.mockResolvedValue({
      id: 'abc',
      name: 'Widget A',
    });
    const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
    await repo.findById('abc', {});
    const callArgs = prisma._delegate.findUnique.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(callArgs.include).toBeUndefined();
  });

  it('strips hidden fields from the returned record', async () => {
    const prisma = createMockPrisma('Widget');
    prisma._delegate.findUnique.mockResolvedValue({
      id: 'abc',
      name: 'Widget A',
      password_hash: 'should-be-hidden',
    });
    const repo = new BaseRepository(prisma, 'Widget', {
      ...defaultOptions,
      hiddenFields: new Set(['password_hash']),
    });
    const record = (await repo.findById('abc')) as Record<string, unknown>;
    expect(record).not.toHaveProperty('password_hash');
  });
});

describe('BaseRepository.create', () => {
  it('creates a record and returns it', async () => {
    const prisma = createMockPrisma('Widget');
    const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
    await expect(repo.create({ name: 'New Widget' })).resolves.toEqual({
      id: 'new-id',
      name: 'New Widget',
    });
  });
});

describe('BaseRepository.update', () => {
  it('updates an existing record', async () => {
    const prisma = createMockPrisma('Widget');
    prisma._delegate.findUnique.mockResolvedValue({ id: 'abc', name: 'Old' });
    const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
    await expect(repo.update('abc', { name: 'Updated' })).resolves.toEqual({
      id: 'abc',
      name: 'Updated',
    });
  });

  it('throws NotFoundError when the record does not exist', async () => {
    const prisma = createMockPrisma('Widget');
    const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
    await expect(repo.update('missing', { name: 'x' })).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('BaseRepository.delete', () => {
  it('hard-deletes when softDelete is false', async () => {
    const prisma = createMockPrisma('Widget');
    prisma._delegate.findUnique.mockResolvedValue({ id: 'abc' });
    const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
    await repo.delete('abc');
    expect(prisma._delegate.delete).toHaveBeenCalledWith({
      where: { id: 'abc' },
    });
  });

  it('soft-deletes when softDelete is true', async () => {
    const prisma = createMockPrisma('Widget');
    prisma._delegate.findUnique.mockResolvedValue({ id: 'abc' });
    const repo = new BaseRepository(prisma, 'Widget', {
      ...defaultOptions,
      columnNames: [...defaultOptions.columnNames, 'deleted_at'],
      softDelete: true,
    });
    await repo.delete('abc');
    expect(prisma._delegate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'abc' },
        data: { deleted_at: expect.any(Date) },
      }),
    );
  });

  it('throws NotFoundError when the record does not exist', async () => {
    const prisma = createMockPrisma('Widget');
    const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
    await expect(repo.delete('missing')).rejects.toThrow(NotFoundError);
  });
});

describe('BaseRepository.bulkCreate', () => {
  it('forwards items to createMany and returns the count', async () => {
    const prisma = createMockPrisma('Widget');
    const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
    const result = await repo.bulkCreate([{ name: 'A' }, { name: 'B' }]);
    expect(result).toEqual({ count: 2 });
    expect(prisma._delegate.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ name: 'A' }, { name: 'B' }] }),
    );
  });
});

describe('BaseRepository.bulkDelete', () => {
  it('hard-deletes via deleteMany when softDelete is false', async () => {
    const prisma = createMockPrisma('Widget');
    const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
    await repo.bulkDelete(['id1', 'id2']);
    expect(prisma._delegate.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['id1', 'id2'] } },
    });
  });

  it('soft-deletes by issuing one update per id when softDelete is true', async () => {
    const prisma = createMockPrisma('Widget');
    const repo = new BaseRepository(prisma, 'Widget', {
      ...defaultOptions,
      columnNames: [...defaultOptions.columnNames, 'deleted_at'],
      softDelete: true,
    });
    await repo.bulkDelete(['id1', 'id2']);
    expect(prisma._delegate.update).toHaveBeenCalledTimes(2);
    expect(prisma._delegate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'id1', deleted_at: null },
        data: { deleted_at: expect.any(Date) },
      }),
    );
  });

  it('swallows soft-delete failures so missing ids do not abort the batch', async () => {
    const prisma = createMockPrisma('Widget');
    prisma._delegate.update.mockRejectedValue(
      Object.assign(new Error('Record not found'), { code: 'P2025' }),
    );
    const repo = new BaseRepository(prisma, 'Widget', {
      ...defaultOptions,
      columnNames: [...defaultOptions.columnNames, 'deleted_at'],
      softDelete: true,
    });
    await expect(repo.bulkDelete(['missing'])).resolves.toBeUndefined();
    expect(prisma._delegate.update).toHaveBeenCalledTimes(1);
  });
});

describe('BaseRepository softDeleteWhere', () => {
  it('adds deleted_at: null when softDelete is enabled', async () => {
    const prisma = createMockPrisma('Widget');
    const repo = new BaseRepository(prisma, 'Widget', {
      ...defaultOptions,
      columnNames: [...defaultOptions.columnNames, 'deleted_at'],
      softDelete: true,
    });
    await repo.findMany({ page: 1, page_size: 10 });
    const callArgs = prisma._delegate.findMany.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const where = callArgs.where as Record<string, unknown>;
    expect(where.deleted_at).toBeNull();
  });

  it('omits deleted_at filter when softDelete is disabled', async () => {
    const prisma = createMockPrisma('Widget');
    const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
    await repo.findMany({ page: 1, page_size: 10 });
    const callArgs = prisma._delegate.findMany.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const where = callArgs.where as Record<string, unknown>;
    expect(where.deleted_at).toBeUndefined();
  });
});

describe('BaseRepository.stripHidden', () => {
  it('leaves non-object records untouched', async () => {
    const prisma = createMockPrisma('Widget');
    prisma._delegate.findUnique.mockResolvedValue(null);
    const repo = new BaseRepository(prisma, 'Widget', {
      ...defaultOptions,
      hiddenFields: new Set(['password_hash']),
    });
    await expect(repo.findById('absent')).rejects.toThrow(NotFoundError);
  });

  it('returns records unchanged when no hidden fields are configured', async () => {
    const prisma = createMockPrisma('Widget');
    prisma._delegate.findUnique.mockResolvedValue({
      id: 'abc',
      name: 'unchanged',
    });
    const repo = new BaseRepository(prisma, 'Widget', defaultOptions);
    await expect(repo.findById('abc')).resolves.toEqual({
      id: 'abc',
      name: 'unchanged',
    });
  });
});
