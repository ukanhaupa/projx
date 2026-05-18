import { and, eq } from 'drizzle-orm';
import { pgTable, text, boolean, uuid, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { decryptString, encryptString } from './crypto.js';

export const serviceConfigs = pgTable('service_configs', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  purpose: text('purpose').notNull().unique(),
  config: text('config').notNull(),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

interface CacheEntry {
  data: Record<string, unknown>;
  expiresAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export async function getServiceConfig<T extends Record<string, unknown>>(
  _client: typeof db,
  purpose: string,
): Promise<T | null> {
  const cached = cache.get(purpose);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T;
  }

  const rows = await db
    .select()
    .from(serviceConfigs)
    .where(and(eq(serviceConfigs.purpose, purpose), eq(serviceConfigs.is_active, true)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const data = JSON.parse(decryptString(row.config)) as T;
  cache.set(purpose, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export async function setServiceConfig(
  _client: typeof db,
  purpose: string,
  config: Record<string, unknown>,
): Promise<void> {
  const encrypted = encryptString(JSON.stringify(config));
  await db
    .insert(serviceConfigs)
    .values({ purpose, config: encrypted, is_active: true })
    .onConflictDoUpdate({
      target: serviceConfigs.purpose,
      set: { config: encrypted, is_active: true, updated_at: new Date() },
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
