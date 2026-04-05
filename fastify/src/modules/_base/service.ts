import type { BaseRepository } from './repository.js';
import type { QueryParams } from './query-engine.js';

export class BaseService {
  constructor(protected repository: BaseRepository) {}

  async list(query: QueryParams, includeRelations?: Record<string, boolean>) {
    return this.repository.findMany(query, includeRelations);
  }

  async get(id: string, includeRelations?: Record<string, boolean>) {
    return this.repository.findById(id, includeRelations);
  }

  async create(data: Record<string, unknown>) {
    return this.repository.create(data);
  }

  async update(id: string, data: Record<string, unknown>) {
    return this.repository.update(id, data);
  }

  async delete(id: string) {
    return this.repository.delete(id);
  }

  async bulkCreate(items: Record<string, unknown>[]) {
    return this.repository.bulkCreate(items);
  }

  async bulkDelete(ids: string[]) {
    return this.repository.bulkDelete(ids);
  }
}
