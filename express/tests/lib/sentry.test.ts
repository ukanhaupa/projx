import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  httpIntegration: vi.fn(() => ({})),
  onUncaughtExceptionIntegration: vi.fn(() => ({})),
  onUnhandledRejectionIntegration: vi.fn(() => ({})),
  getCurrentScope: vi.fn(() => ({ setTag: vi.fn(), clear: vi.fn() })),
  captureException: vi.fn(),
}));

import * as Sentry from '@sentry/node';
import {
  SENTRY_PURPOSE,
  __sentryInternals,
  initSentry,
  normalizeSentryConfig,
} from '../../src/lib/sentry.js';

beforeEach(() => {
  __sentryInternals.reset();
  vi.clearAllMocks();
});

describe('normalizeSentryConfig', () => {
  it('exposes the service_configs purpose', () => {
    expect(SENTRY_PURPOSE).toBe('sentry');
  });

  it('returns disabled defaults when no row exists', () => {
    expect(normalizeSentryConfig(null)).toEqual({
      dsn: '',
      environment: 'production',
      release: '',
    });
  });

  it('falls back per-field on missing or invalid values', () => {
    expect(
      normalizeSentryConfig({ dsn: 42, environment: '', release: undefined }),
    ).toEqual({ dsn: '', environment: 'production', release: '' });
  });

  it('passes through configured values', () => {
    expect(
      normalizeSentryConfig({
        dsn: 'https://key@sentry.example/1',
        environment: 'staging',
        release: '1.2.3',
      }),
    ).toEqual({
      dsn: 'https://key@sentry.example/1',
      environment: 'staging',
      release: '1.2.3',
    });
  });
});

describe('initSentry', () => {
  it('no-ops when dsn is empty', () => {
    expect(initSentry(normalizeSentryConfig(null))).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initializes once with dsn, environment, and release', () => {
    const enabled = initSentry({
      dsn: 'https://key@sentry.example/1',
      environment: 'staging',
      release: '1.2.3',
    });
    expect(enabled).toBe(true);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@sentry.example/1',
        environment: 'staging',
        release: '1.2.3',
      }),
    );
  });

  it('omits an empty release', () => {
    initSentry({
      dsn: 'https://key@sentry.example/1',
      environment: 'production',
      release: '',
    });
    const initArgs = vi.mocked(Sentry.init).mock.calls[0][0];
    expect(initArgs?.release).toBeUndefined();
  });

  it('is idempotent', () => {
    const runtime = {
      dsn: 'https://key@sentry.example/1',
      environment: 'production',
      release: '',
    };
    expect(initSentry(runtime)).toBe(true);
    expect(initSentry(runtime)).toBe(true);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });
});
