import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from '@playwright/test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

type Kind = 'fastapi' | 'fastify' | 'express' | 'vitejs' | 'nextjs';

const KNOWN_KINDS: Record<string, Kind> = {
  fastapi: 'fastapi',
  fastify: 'fastify',
  express: 'express',
  vitejs: 'vitejs',
  nextjs: 'nextjs',
};

function resolveSibling(priority: Kind[]): { dir: string; kind: Kind } | null {
  let names: string[];
  try {
    names = readdirSync('..', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return null;
  }
  const resolved: Array<{ dir: string; kind: Kind }> = [];
  for (const name of names) {
    let kind: Kind | undefined;
    try {
      const raw = readFileSync(join('..', name, '.projx-component'), 'utf-8');
      const match = raw.match(/"component"\s*:\s*"([^"]+)"/);
      kind = KNOWN_KINDS[match ? match[1] : raw.trim()];
    } catch {
      kind = KNOWN_KINDS[name];
    }
    if (kind) resolved.push({ dir: name, kind });
  }
  for (const want of priority) {
    const hit = resolved.find((entry) => entry.kind === want);
    if (hit) return hit;
  }
  return null;
}

const frontend = resolveSibling(['vitejs', 'nextjs']);
const backend = resolveSibling(['fastapi', 'fastify', 'express']);

const frontendDevUrl =
  frontend?.kind === 'nextjs'
    ? 'http://localhost:3000'
    : 'http://localhost:5173';

try {
  const envFile = readFileSync(
    join('..', frontend?.dir ?? 'frontend', '.env'),
    'utf-8',
  );
  for (const line of envFile.split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
} catch {
  process.env.BASE_URL ||= frontendDevUrl;
}

const isProdBuild = process.env.E2E_PROD_BUILD === '1';
const isDocker = process.env.E2E_DOCKER === '1';

const BACKEND_HEALTH: Record<Kind, string> = {
  fastapi: 'http://localhost:8000/api/health',
  fastify: 'http://localhost:3000/api/health',
  express: 'http://localhost:3000/api/health',
  vitejs: '',
  nextjs: '',
};

function backendCommand(dir: string, kind: Kind): string {
  if (kind === 'fastapi') return `cd ../${dir} && uv run main.py`;
  return `cd ../${dir} && pnpm dev`;
}

function frontendCommand(dir: string, kind: Kind): string {
  if (kind === 'nextjs') {
    return isProdBuild
      ? `cd ../${dir} && pnpm build && pnpm start`
      : `cd ../${dir} && pnpm dev`;
  }
  return isProdBuild
    ? `cd ../${dir} && pnpm exec vite build --outDir dist-e2e && pnpm exec vite preview --outDir dist-e2e --port 4173 --strictPort`
    : `cd ../${dir} && pnpm dev`;
}

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

  const servers: NonNullable<PlaywrightTestConfig['webServer']> = [];

  if (backend) {
    servers.push({
      command: backendCommand(backend.dir, backend.kind),
      url: BACKEND_HEALTH[backend.kind],
      reuseExistingServer: true,
      timeout: 30000,
    });
  }

  if (frontend) {
    const prodUrl =
      frontend.kind === 'nextjs'
        ? 'http://localhost:3000'
        : 'http://localhost:4173';
    servers.push({
      command: frontendCommand(frontend.dir, frontend.kind),
      url: isProdBuild ? prodUrl : frontendDevUrl,
      reuseExistingServer: true,
      timeout: isProdBuild ? 240000 : 90000,
    });
  }

  return servers;
}

export default defineConfig({
  testDir: './frontend',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: process.env.BASE_URL || frontendDevUrl,
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
