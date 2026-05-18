import 'reflect-metadata';
import {
  Column,
  CreateDateColumn,
  DataSource,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { decryptString, encryptString } from './crypto.js';

@Entity({ name: 'service_configs' })
export class ServiceConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  purpose!: string;

  @Column({ type: 'text' })
  config!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updated_at!: Date;
}

interface CacheEntry {
  data: Record<string, unknown>;
  expiresAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export async function getServiceConfig<T extends Record<string, unknown>>(
  ds: DataSource,
  purpose: string,
): Promise<T | null> {
  const cached = cache.get(purpose);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T;
  }

  const repo = ds.getRepository(ServiceConfig);
  const row = await repo.findOne({ where: { purpose, is_active: true } });
  if (!row) return null;

  const data = JSON.parse(decryptString(row.config)) as T;
  cache.set(purpose, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export async function setServiceConfig(
  ds: DataSource,
  purpose: string,
  config: Record<string, unknown>,
): Promise<void> {
  const encrypted = encryptString(JSON.stringify(config));
  const repo = ds.getRepository(ServiceConfig);
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
