import { dataSource } from '../db/data-source.js';
import { ServiceConfig } from '../entities/service-config.js';
import { decryptString, encryptString } from './crypto.js';

interface CacheEntry {
  data: Record<string, unknown>;
  expiresAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export async function getServiceConfig<T extends Record<string, unknown>>(
  _client: unknown,
  purpose: string,
): Promise<T | null> {
  const cached = cache.get(purpose);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T;
  }

  const repo = dataSource.getRepository(ServiceConfig);
  const row = await repo.findOne({ where: { purpose, is_active: true } });
  if (!row) return null;

  const data = JSON.parse(decryptString(row.config)) as T;
  cache.set(purpose, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export async function setServiceConfig(
  _client: unknown,
  purpose: string,
  config: Record<string, unknown>,
): Promise<void> {
  const encrypted = encryptString(JSON.stringify(config));
  const repo = dataSource.getRepository(ServiceConfig);
  const existing = await repo.findOne({ where: { purpose } });
  if (existing) {
    await repo.update(
      { id: existing.id },
      { config: encrypted, is_active: true },
    );
  } else {
    await repo.save({ purpose, config: encrypted, is_active: true });
  }
  cache.delete(purpose);
}

export function invalidateServiceConfigCache(purpose?: string): void {
  if (!purpose) {
    cache.clear();
    return;
  }
  cache.delete(purpose);
}
