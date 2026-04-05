import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

config({ path: '.env.test' });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/server.ts',
        'src/app.ts',
        'src/config.ts',
        'src/plugins/swagger.ts',
        'src/plugins/prisma.ts',
        'src/modules/_base/index.ts',
        'src/modules/*/index.ts',
        'src/modules/*/schemas.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
    pool: 'forks',
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
