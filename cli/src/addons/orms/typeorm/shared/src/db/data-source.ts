import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from '../config.js';
import { entities } from '../entities/index.js';

export const dataSource = new DataSource({
  type: 'postgres',
  url: config.DATABASE_URL,
  entities,
  synchronize: false,
  logging: false,
});

export async function checkDatabase(): Promise<void> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  await dataSource.query('SELECT 1');
}

export async function closeDatabase(): Promise<void> {
  if (dataSource.isInitialized) await dataSource.destroy();
}
