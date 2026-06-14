import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const init = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  init: (opts: unknown) => init(opts),
}));

const getRuntimeConfig = vi.fn();
vi.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: () => getRuntimeConfig(),
}));

import { initSentry } from '@/lib/sentry';

const baseConfig = {
  apiUrl: '',
  oidcUrl: '',
  oidcRealm: '',
  oidcClientId: '',
  sentryDsn: '',
  sentryEnvironment: 'production',
  sentryRelease: '',
};

describe('initSentry', () => {
  beforeEach(() => {
    init.mockClear();
    getRuntimeConfig.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a no-op when DSN is empty', () => {
    getRuntimeConfig.mockReturnValue(baseConfig);
    expect(initSentry()).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it('initializes Sentry when DSN is present', () => {
    getRuntimeConfig.mockReturnValue({
      ...baseConfig,
      sentryDsn: 'https://dsn@example/1',
      sentryEnvironment: 'staging',
      sentryRelease: 'v1',
    });
    expect(initSentry()).toBe(true);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://dsn@example/1',
        environment: 'staging',
        release: 'v1',
      }),
    );
  });

  it('drops noisy network errors in beforeSend', () => {
    getRuntimeConfig.mockReturnValue({
      ...baseConfig,
      sentryDsn: 'https://dsn@example/1',
    });
    initSentry();
    const beforeSend = init.mock.calls[0][0].beforeSend;
    const event = { id: 'e' };
    expect(
      beforeSend(event, { originalException: { name: 'AbortError' } }),
    ).toBeNull();
    expect(
      beforeSend(event, {
        originalException: { message: 'Failed to fetch' },
      }),
    ).toBeNull();
    expect(
      beforeSend(event, { originalException: { message: 'NetworkError x' } }),
    ).toBeNull();
    expect(
      beforeSend(event, { originalException: { message: 'real bug' } }),
    ).toBe(event);
    expect(beforeSend(event, undefined)).toBe(event);
  });
});
