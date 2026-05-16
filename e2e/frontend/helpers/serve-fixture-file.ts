import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const fixturesDir = fileURLToPath(
  new URL('../fixtures/files', import.meta.url),
);

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
};

async function readFixtureBytes(name: string): Promise<Buffer> {
  const directPath = join(fixturesDir, name);
  if (existsSync(directPath)) return readFile(directPath);

  const encodedPath = `${directPath}.base64`;
  if (existsSync(encodedPath)) {
    return Buffer.from(
      (await readFile(encodedPath, 'utf-8')).replace(/\s+/g, ''),
      'base64',
    );
  }

  throw new Error(`Fixture file not found: ${name}`);
}

export async function serveFixtureFile(
  page: Page,
  url: string | RegExp,
  fixtureName: string,
): Promise<void> {
  const extension = fixtureName.split('.').pop() ?? '';
  const body = await readFixtureBytes(fixtureName);
  await page.route(url, (route) =>
    route.fulfill({
      status: 200,
      contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream',
      body,
    }),
  );
}
