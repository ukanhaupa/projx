import { DataTypes, Model, type Sequelize } from 'sequelize';
import { sequelize } from '../db/client.js';
import { decryptString, encryptString } from './crypto.js';

export class ServiceConfig extends Model {
  declare id: string;
  declare purpose: string;
  declare config: string;
  declare is_active: boolean;
  declare created_at: Date;
  declare updated_at: Date;
}

ServiceConfig.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    purpose: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    config: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    modelName: 'ServiceConfig',
    tableName: 'service_configs',
    underscored: true,
  },
);

interface CacheEntry {
  data: Record<string, unknown>;
  expiresAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export async function getServiceConfig<T extends Record<string, unknown>>(
  _client: Sequelize,
  purpose: string,
): Promise<T | null> {
  const cached = cache.get(purpose);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T;
  }

  const row = await ServiceConfig.findOne({
    where: { purpose, is_active: true },
  });
  if (!row) return null;

  const data = JSON.parse(decryptString(row.config)) as T;
  cache.set(purpose, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export async function setServiceConfig(
  _client: Sequelize,
  purpose: string,
  config: Record<string, unknown>,
): Promise<void> {
  const encrypted = encryptString(JSON.stringify(config));
  const [row, created] = await ServiceConfig.findOrCreate({
    where: { purpose },
    defaults: { purpose, config: encrypted, is_active: true },
  });
  if (!created) {
    row.set({ config: encrypted, is_active: true });
    await row.save();
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
