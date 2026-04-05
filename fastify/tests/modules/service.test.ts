import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseService } from '../../src/modules/_base/service.js';
import type { BaseRepository } from '../../src/modules/_base/repository.js';

function createMockRepository(): BaseRepository {
  return {
    findMany: vi.fn().mockResolvedValue({ data: [{ id: '1' }], total: 1 }),
    findById: vi.fn().mockResolvedValue({ id: '1', name: 'Test' }),
    create: vi.fn().mockResolvedValue({ id: 'new', name: 'Created' }),
    update: vi.fn().mockResolvedValue({ id: '1', name: 'Updated' }),
    delete: vi.fn().mockResolvedValue(undefined),
    bulkCreate: vi.fn().mockResolvedValue({ count: 3 }),
    bulkDelete: vi.fn().mockResolvedValue(undefined),
  } as unknown as BaseRepository;
}

describe('BaseService', () => {
  let service: BaseService;
  let mockRepo: BaseRepository;

  beforeEach(() => {
    mockRepo = createMockRepository();
    service = new BaseService(mockRepo);
  });

  describe('list', () => {
    it('delegates to repository.findMany', async () => {
      const query = { page: 1, page_size: 10 };
      const result = await service.list(query);
      expect(mockRepo.findMany).toHaveBeenCalledWith(query, undefined);
      expect(result).toEqual({ data: [{ id: '1' }], total: 1 });
    });

    it('passes include relations', async () => {
      const query = { page: 1, page_size: 10 };
      const include = { category: true };
      await service.list(query, include);
      expect(mockRepo.findMany).toHaveBeenCalledWith(query, include);
    });
  });

  describe('get', () => {
    it('delegates to repository.findById', async () => {
      const result = await service.get('1');
      expect(mockRepo.findById).toHaveBeenCalledWith('1', undefined);
      expect(result).toEqual({ id: '1', name: 'Test' });
    });

    it('passes include relations', async () => {
      const include = { tags: true };
      await service.get('1', include);
      expect(mockRepo.findById).toHaveBeenCalledWith('1', include);
    });
  });

  describe('create', () => {
    it('delegates to repository.create', async () => {
      const data = { name: 'New Item' };
      const result = await service.create(data);
      expect(mockRepo.create).toHaveBeenCalledWith(data);
      expect(result).toEqual({ id: 'new', name: 'Created' });
    });
  });

  describe('update', () => {
    it('delegates to repository.update', async () => {
      const data = { name: 'Updated' };
      const result = await service.update('1', data);
      expect(mockRepo.update).toHaveBeenCalledWith('1', data);
      expect(result).toEqual({ id: '1', name: 'Updated' });
    });
  });

  describe('delete', () => {
    it('delegates to repository.delete', async () => {
      await service.delete('1');
      expect(mockRepo.delete).toHaveBeenCalledWith('1');
    });
  });

  describe('bulkCreate', () => {
    it('delegates to repository.bulkCreate', async () => {
      const items = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
      const result = await service.bulkCreate(items);
      expect(mockRepo.bulkCreate).toHaveBeenCalledWith(items);
      expect(result).toEqual({ count: 3 });
    });
  });

  describe('bulkDelete', () => {
    it('delegates to repository.bulkDelete', async () => {
      const ids = ['id1', 'id2'];
      await service.bulkDelete(ids);
      expect(mockRepo.bulkDelete).toHaveBeenCalledWith(ids);
    });
  });
});
