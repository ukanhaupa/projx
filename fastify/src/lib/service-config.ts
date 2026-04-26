import type { PrismaClient } from '@prisma/client';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { decryptString, encryptString } from './crypto.js';

type ServiceConfigClient = PrismaClient | ExtendedPrismaClient;

interface CacheEntry {
  data: Record<string, unknown>;
  expiresAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export async function getServiceConfig<T extends Record<string, unknown>>(
  prisma: ServiceConfigClient,
  purpose: string,
): Promise<T | null> {
  const cached = cache.get(purpose);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T;
  }

  const row = await prisma.serviceConfig.findFirst({
    where: { purpose, is_active: true },
  });
  if (!row) return null;

  const data = JSON.parse(decryptString(row.config)) as T;
  cache.set(purpose, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export async function setServiceConfig(
  prisma: ServiceConfigClient,
  purpose: string,
  config: Record<string, unknown>,
): Promise<void> {
  const encrypted = encryptString(JSON.stringify(config));
  await prisma.serviceConfig.upsert({
    where: { purpose },
    create: { purpose, config: encrypted, is_active: true },
    update: { config: encrypted, is_active: true },
  });
  cache.delete(purpose);
}

export function invalidateServiceConfigCache(purpose?: string): void {
  if (!purpose) {
    cache.clear();
    return;
  }
  cache.delete(purpose);
}
