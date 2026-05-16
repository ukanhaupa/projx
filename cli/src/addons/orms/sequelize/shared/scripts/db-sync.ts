import { sequelize } from '../src/db/client.js';
import '../src/models/index.js';

async function main(): Promise<void> {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });
  console.log('Sequelize schema synced.');
  await sequelize.close();
}

main().catch((err: unknown) => {
  console.error('db-sync failed:', err);
  process.exit(1);
});
