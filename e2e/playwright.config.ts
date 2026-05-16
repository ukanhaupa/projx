import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from '@playwright/test';
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
  process.env.BASE_URL ||= 'http://localhost:3000';
}

const isProdBuild = process.env.E2E_PROD_BUILD === '1';
const isDocker = process.env.E2E_DOCKER === '1';

function localWebServers(): NonNullable<PlaywrightTestConfig['webServer']> {
  if (isDocker) {
    return [
      {
        command: 'cd .. && docker compose -f docker-compose.yml up --build',
        url: process.env.BASE_URL || 'https://localhost',
        reuseExistingServer: true,
        timeout: 300000,
      },
    ];
  }

  const frontendCommand = isProdBuild
    ? 'cd ../frontend && pnpm exec vite build && pnpm exec vite preview --port 3000 --strictPort'
    : 'cd ../frontend && npm run dev';

  return [
    {
      command: 'cd ../fastapi && uv run main.py',
      url: 'http://localhost:7860/api/health',
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: frontendCommand,
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: isProdBuild ? 240000 : 90000,
    },
  ];
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
    ignoreHTTPSErrors: isDocker,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: process.env.CI ? undefined : localWebServers(),
});
