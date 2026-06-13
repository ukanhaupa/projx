import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

const OUTPUT_DIR = join(process.cwd(), '.nyc_output');

export async function collectCoverage(page: Page): Promise<void> {
  try {
    const coverage = await page.evaluate(
      () =>
        (window as unknown as { __coverage__?: unknown }).__coverage__ ?? null,
    );
    if (!coverage) return;
    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(
      join(OUTPUT_DIR, `${randomUUID()}.json`),
      JSON.stringify(coverage),
    );
  } catch {
    /* best-effort — coverage collection never fails a test */
  }
}
