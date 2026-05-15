import type { PrismaLike } from '../../prisma.js';
import { NotFoundError } from '../../errors.js';
import {
  buildOrderByClause,
  buildPagination,
  buildSearchClause,
  buildWhereClause,
  extractFilters,
  type QueryParams,
} from './query-engine.js';

type PrismaDelegate = {
  findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
  findUnique: (args: Record<string, unknown>) => Promise<unknown | null>;
  count: (args: Record<string, unknown>) => Promise<number>;
  create: (args: Record<string, unknown>) => Promise<unknown>;
  update: (args: Record<string, unknown>) => Promise<unknown>;
  delete: (args: Record<string, unknown>) => Promise<unknown>;
  createMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
  deleteMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
};

export class BaseRepository {
  protected modelName: string;
  protected delegate: PrismaDelegate;
  protected columnNames: Set<string>;
  protected searchableFields: string[];
  protected softDelete: boolean;
  protected hiddenFields: Set<string>;

  constructor(
    prisma: PrismaLike,
    modelName: string,
    options: {
      columnNames: string[];
      searchableFields?: string[];
      softDelete?: boolean;
      hiddenFields?: Set<string>;
    },
  ) {
    this.modelName = modelName;
    const prismaModel = modelName.charAt(0).toLowerCase() + modelName.slice(1);
    this.delegate = (prisma as unknown as Record<string, PrismaDelegate>)[prismaModel];
    if (!this.delegate) {
      throw new Error(`Prisma model "${modelName}" not found. Check your schema.prisma.`);
    }
    this.columnNames = new Set(options.columnNames);
    this.searchableFields = options.searchableFields ?? [];
    this.softDelete = options.softDelete ?? false;
    this.hiddenFields = options.hiddenFields ?? new Set();
  }

  protected stripHidden<T>(record: T): T {
    if (!this.hiddenFields.size || !record || typeof record !== 'object') return record;
    const obj = record as Record<string, unknown>;
    for (const field of this.hiddenFields) {
      delete obj[field];
    }
    return record;
  }

  protected softDeleteWhere(): Record<string, unknown> {
    return this.softDelete ? { deleted_at: null } : {};
  }

  async findMany(
    query: QueryParams,
    includeRelations?: Record<string, boolean>,
  ): Promise<{ data: unknown[]; total: number }> {
    const filters = extractFilters(query as unknown as Record<string, unknown>);
    const filterWhere = buildWhereClause(filters, this.columnNames);
    const searchWhere = buildSearchClause(query.search, this.searchableFields);
    const orderBy = buildOrderByClause(query.order_by, this.columnNames);
    const pagination = buildPagination(query.page, query.page_size);

    const where = {
      ...this.softDeleteWhere(),
      ...filterWhere,
      ...(searchWhere ? { AND: [searchWhere] } : {}),
    };

    const findArgs: Record<string, unknown> = {
      where,
      orderBy,
      ...pagination,
    };

    if (includeRelations && Object.keys(includeRelations).length > 0) {
      findArgs.include = includeRelations;
    }

    const [rawData, total] = await Promise.all([
      this.delegate.findMany(findArgs),
      this.delegate.count({ where }),
    ]);

    return { data: rawData.map((record) => this.stripHidden(record)), total };
  }

  async findById(id: string, includeRelations?: Record<string, boolean>): Promise<unknown> {
    const findArgs: Record<string, unknown> = {
      where: { id, ...this.softDeleteWhere() },
    };

    if (includeRelations && Object.keys(includeRelations).length > 0) {
      findArgs.include = includeRelations;
    }

    const record = await this.delegate.findUnique(findArgs);
    if (!record) throw new NotFoundError(this.modelName, id);
    return this.stripHidden(record);
  }

  async create(data: Record<string, unknown>): Promise<unknown> {
    const record = await this.delegate.create({ data });
    return this.stripHidden(record);
  }

  async update(id: string, data: Record<string, unknown>): Promise<unknown> {
    await this.findById(id);
    const record = await this.delegate.update({ where: { id }, data });
    return this.stripHidden(record);
  }

  async delete(id: string): Promise<void> {
    await this.findById(id);
    if (this.softDelete) {
      await this.delegate.update({
        where: { id },
        data: { deleted_at: new Date() },
      });
    } else {
      await this.delegate.delete({ where: { id } });
    }
  }

  async bulkCreate(items: Record<string, unknown>[]): Promise<{ count: number }> {
    return this.delegate.createMany({ data: items as unknown as Record<string, unknown> });
  }

  async bulkDelete(ids: string[]): Promise<void> {
    if (this.softDelete) {
      for (const id of ids) {
        try {
          await this.delegate.update({
            where: { id, ...this.softDeleteWhere() },
            data: { deleted_at: new Date() },
          });
        } catch {
          // Match deleteMany semantics by ignoring ids that are already gone.
        }
      }
    } else {
      await this.delegate.deleteMany({
        where: { id: { in: ids } },
      });
    }
  }
}
