import { Sequelize } from 'sequelize';
import { config } from '../config.js';

export const sequelize = new Sequelize(config.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  define: {
    underscored: true,
    timestamps: true,
  },
});

export async function checkDatabase(): Promise<void> {
  await sequelize.authenticate();
}

export async function closeDatabase(): Promise<void> {
  await sequelize.close();
}
