import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'fs';

try {
  const envFile = readFileSync('../frontend/.env', 'utf-8');
  for (const line of envFile.split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
} catch {
  /* .env is optional */
}

export default defineConfig({
  testDir: './frontend',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: process.env.CI
    ? undefined
    : [
        {
          command: 'cd ../fastapi && uv run main.py',
          url: 'http://localhost:7860/api/health',
          reuseExistingServer: true,
          timeout: 30000,
        },
        {
          command: 'cd ../frontend && npm run dev',
          url: 'http://localhost:3000',
          reuseExistingServer: true,
        },
      ],
});
