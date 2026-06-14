import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRuntimeConfig } from '@/lib/runtime-config';

describe('getRuntimeConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete window.__RUNTIME_CONFIG__;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    delete window.__RUNTIME_CONFIG__;
  });

  it('falls back to defaults when nothing is configured', () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const config = getRuntimeConfig();
    expect(config.apiUrl).toBe('http://localhost:8000');
    expect(config.sentryEnvironment).toBe('production');
  });

  it('reads NEXT_PUBLIC_* env when no injected config', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://env.example';
    expect(getRuntimeConfig().apiUrl).toBe('http://env.example');
  });

  it('prefers injected window config over env', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://env.example';
    window.__RUNTIME_CONFIG__ = { apiUrl: 'http://injected.example' };
    expect(getRuntimeConfig().apiUrl).toBe('http://injected.example');
  });

  it('falls back to env when injected value is empty', () => {
    process.env.NEXT_PUBLIC_OIDC_REALM = 'realm-from-env';
    window.__RUNTIME_CONFIG__ = { oidcRealm: '' };
    expect(getRuntimeConfig().oidcRealm).toBe('realm-from-env');
  });
});
