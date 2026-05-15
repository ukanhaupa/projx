import type { Page, Request, Response, TestInfo } from '@playwright/test';

const allowedErrors = new WeakMap<TestInfo, RegExp[]>();

interface TrackedError {
  kind: 'pageerror' | 'response' | 'requestfailed';
  message: string;
  url?: string;
}

function appOrigins(testInfo: TestInfo): Set<string> {
  const origins = new Set<string>();
  const baseURL = testInfo.project.use.baseURL;
  for (const value of [
    baseURL,
    process.env.VITE_API_URL,
    process.env.BASE_URL,
  ]) {
    if (typeof value !== 'string' || !value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      continue;
    }
  }
  return origins;
}

function isAppUrl(url: string, testInfo: TestInfo): boolean {
  try {
    const parsed = new URL(url);
    const origins = appOrigins(testInfo);
    return origins.size === 0 || origins.has(parsed.origin);
  } catch {
    return false;
  }
}

function formatTrackedError(error: TrackedError): string {
  return [error.kind, error.url, error.message].filter(Boolean).join(' ');
}

function isAllowed(error: TrackedError, testInfo: TestInfo): boolean {
  const message = formatTrackedError(error);
  return (allowedErrors.get(testInfo) ?? []).some((pattern) =>
    pattern.test(message),
  );
}

export function allowPageErrors(
  testInfo: TestInfo,
  pattern: RegExp = /.*/,
): void {
  const existing = allowedErrors.get(testInfo) ?? [];
  allowedErrors.set(testInfo, [...existing, pattern]);
}

export function attachPageErrorTracking(
  page: Page,
  testInfo: TestInfo,
): () => void {
  const errors: TrackedError[] = [];

  const onPageError = (error: Error) => {
    errors.push({ kind: 'pageerror', message: error.message });
  };
  const onResponse = (response: Response) => {
    if (response.status() < 400 || !isAppUrl(response.url(), testInfo)) return;
    errors.push({
      kind: 'response',
      url: response.url(),
      message: `HTTP ${response.status()}`,
    });
  };
  const onRequestFailed = (request: Request) => {
    if (!isAppUrl(request.url(), testInfo)) return;
    errors.push({
      kind: 'requestfailed',
      url: request.url(),
      message: request.failure()?.errorText ?? 'request failed',
    });
  };

  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  return () => {
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);
    const unexpected = errors.filter((error) => !isAllowed(error, testInfo));
    if (unexpected.length > 0) {
      throw new Error(
        [
          'Unexpected page errors:',
          ...unexpected.map((error) => `  ${formatTrackedError(error)}`),
        ].join('\n'),
      );
    }
  };
}
