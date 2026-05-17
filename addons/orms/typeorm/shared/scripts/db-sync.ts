import 'reflect-metadata';
import { dataSource } from '../src/db/data-source.js';

async function main(): Promise<void> {
  await dataSource.initialize();
  await dataSource.synchronize();
  console.log('TypeORM schema synced.');
  await dataSource.destroy();
}

main().catch((err: unknown) => {
  console.error('db-sync failed:', err);
  process.exit(1);
});
