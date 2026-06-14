import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: vi.fn(() => ({
    apiUrl: 'http://api.test',
    oidcUrl: 'http://oidc.test',
    oidcRealm: 'master',
    oidcClientId: 'frontend',
    sentryDsn: '',
    sentryEnvironment: 'test',
    sentryRelease: '',
  })),
}));

function makeToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe('auth', () => {
  let authModule: typeof import('@/lib/auth');
  const originalLocation = window.location;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
    sessionStorage.clear();
    document.cookie = 'projx.session=; Max-Age=0; path=/';

    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: { href: '/', assign: vi.fn() },
    });

    authModule = await import('@/lib/auth');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    sessionStorage.clear();
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: originalLocation,
    });
  });

  describe('login', () => {
    it('stores tokens and sets the session flag on success', async () => {
      const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: token,
            refresh_token: 'refresh-123', // pragma: allowlist secret
          }),
      });

      await authModule.login('user', 'pass');

      expect(authModule.isAuthenticated()).toBe(true);
      expect(authModule.getToken()).toBe(token);
      expect(sessionStorage.getItem('projx.refresh_token')).toBe('refresh-123');
      expect(document.cookie).toContain('projx.session=1');
    });

    it('sends password grant to the token endpoint', async () => {
      const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
      const spy = (
        globalThis.fetch as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });

      await authModule.login('admin', 'secret');

      const call = spy.mock.calls[0];
      expect(call[0]).toBe(
        'http://oidc.test/realms/master/protocol/openid-connect/token',
      );
      expect(call[1].method).toBe('POST');
      const body = call[1].body as URLSearchParams;
      expect(body.get('grant_type')).toBe('password');
      expect(body.get('client_id')).toBe('frontend');
      expect(body.get('username')).toBe('admin');
      expect(body.get('password')).toBe('secret');
    });

    it('throws on failed login with error_description', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error_description: 'Account disabled' }),
      });
      await expect(authModule.login('user', 'pass')).rejects.toThrow(
        'Account disabled',
      );
    });

    it('throws default message when no error_description', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({}),
      });
      await expect(authModule.login('user', 'pass')).rejects.toThrow(
        'Invalid credentials',
      );
    });

    it('throws network error when fetch fails', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new TypeError('Network error'),
      );
      await expect(authModule.login('user', 'pass')).rejects.toThrow(
        'Unable to reach authentication server',
      );
    });

    it('throws default when login response json fails', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        json: () => Promise.reject(new Error('bad json')),
      });
      await expect(authModule.login('user', 'pass')).rejects.toThrow(
        'Invalid credentials',
      );
    });
  });

  describe('getToken and isAuthenticated', () => {
    it('returns undefined and false when not logged in', () => {
      expect(authModule.getToken()).toBeUndefined();
      expect(authModule.isAuthenticated()).toBe(false);
    });
  });

  describe('ensureFreshToken', () => {
    it('returns false when not authenticated', async () => {
      expect(await authModule.ensureFreshToken()).toBe(false);
    });

    it('returns true when token is still valid', async () => {
      const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');
      expect(await authModule.ensureFreshToken()).toBe(true);
    });

    it('refreshes when token expires within 10s', async () => {
      const almostExpired = makeToken({
        exp: Math.floor(Date.now() / 1000) + 5,
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: almostExpired, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');

      const newToken = makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: newToken, refresh_token: 'r2' }),
      });

      expect(await authModule.ensureFreshToken()).toBe(true);
      expect(authModule.getToken()).toBe(newToken);
    });

    it('deduplicates concurrent refresh calls with one in-flight lock', async () => {
      const almostExpired = makeToken({
        exp: Math.floor(Date.now() / 1000) + 5,
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: almostExpired, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');

      const newToken = makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: newToken, refresh_token: 'r2' }),
      });

      const [r1, r2] = await Promise.all([
        authModule.ensureFreshToken(),
        authModule.ensureFreshToken(),
      ]);

      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('doRefresh failure', () => {
    it('logs out on refresh failure and redirects to /login', async () => {
      const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 5 });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      });

      await authModule.ensureFreshToken();
      expect(authModule.isAuthenticated()).toBe(false);
      expect(window.location.href).toBe('/login');
    });

    it('logs out on refresh network error', async () => {
      const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 5 });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('network'),
      );

      await authModule.ensureFreshToken();
      expect(authModule.isAuthenticated()).toBe(false);
    });
  });

  describe('getRoles', () => {
    async function loginWith(payload: Record<string, unknown>) {
      const token = makeToken({
        exp: Math.floor(Date.now() / 1000) + 3600,
        ...payload,
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');
    }

    it('returns empty array when not authenticated', () => {
      expect(authModule.getRoles()).toEqual([]);
    });

    it('returns realm_access roles', async () => {
      await loginWith({ realm_access: { roles: ['admin', 'user'] } });
      expect(authModule.getRoles()).toEqual(['admin', 'user']);
    });

    it('combines realm and resource_access roles', async () => {
      await loginWith({
        realm_access: { roles: ['admin'] },
        resource_access: {
          'my-app': { roles: ['editor'] },
          'other-app': { roles: ['viewer'] },
        },
      });
      expect(authModule.getRoles()).toEqual(['admin', 'editor', 'viewer']);
    });

    it('handles missing realm and resource access', async () => {
      await loginWith({});
      expect(authModule.getRoles()).toEqual([]);
    });

    it('handles resource_access with missing roles array', async () => {
      await loginWith({ resource_access: { 'my-app': {} } });
      expect(authModule.getRoles()).toEqual([]);
    });

    it('returns empty array on malformed token', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: 'not.valid', refresh_token: 'r' }), // pragma: allowlist secret
      });
      await authModule.login('user', 'pass');
      expect(authModule.getRoles()).toEqual([]);
    });
  });

  describe('hasAnyRole', () => {
    it('returns true when required is empty', () => {
      expect(authModule.hasAnyRole([])).toBe(true);
      expect(authModule.hasAnyRole()).toBe(true);
    });

    it('returns false when user has no matching roles', async () => {
      const token = makeToken({
        exp: Math.floor(Date.now() / 1000) + 3600,
        realm_access: { roles: ['user'] },
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');
      expect(authModule.hasAnyRole(['admin'])).toBe(false);
    });

    it('returns true when user has a matching role', async () => {
      const token = makeToken({
        exp: Math.floor(Date.now() / 1000) + 3600,
        realm_access: { roles: ['admin', 'user'] },
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');
      expect(authModule.hasAnyRole(['admin'])).toBe(true);
    });
  });

  describe('getUserInfo', () => {
    async function loginWith(payload: Record<string, unknown>) {
      const token = makeToken({
        exp: Math.floor(Date.now() / 1000) + 3600,
        ...payload,
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');
    }

    it('returns default when not authenticated', () => {
      expect(authModule.getUserInfo()).toEqual({ name: 'User' });
    });

    it('returns preferred_username and email', async () => {
      await loginWith({
        preferred_username: 'johndoe',
        email: 'john@example.com',
      });
      const info = authModule.getUserInfo();
      expect(info.name).toBe('johndoe');
      expect(info.email).toBe('john@example.com');
    });

    it('falls back to name then sub then User', async () => {
      await loginWith({ name: 'John Doe' });
      expect(authModule.getUserInfo().name).toBe('John Doe');
      await loginWith({ sub: 'user-uuid-123' });
      expect(authModule.getUserInfo().name).toBe('user-uuid-123');
      await loginWith({});
      expect(authModule.getUserInfo().name).toBe('User');
    });

    it('returns default on malformed token', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: 'bad', refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');
      expect(authModule.getUserInfo()).toEqual({ name: 'User' });
    });
  });

  describe('logout', () => {
    it('clears tokens, session flag and redirects to /login', async () => {
      const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');
      expect(authModule.isAuthenticated()).toBe(true);

      authModule.logout();

      expect(authModule.isAuthenticated()).toBe(false);
      expect(authModule.getToken()).toBeUndefined();
      expect(sessionStorage.getItem('projx.refresh_token')).toBeNull();
      expect(window.location.href).toBe('/login');
    });
  });

  describe('initAuth', () => {
    it('returns false when no refresh token is stored', async () => {
      expect(await authModule.initAuth()).toBe(false);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('mints a fresh access token from the stored refresh token', async () => {
      sessionStorage.setItem('projx.refresh_token', 'stored-refresh');
      const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r2' }),
      });

      expect(await authModule.initAuth()).toBe(true);
      expect(authModule.getToken()).toBe(token);

      const body = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0][1].body as URLSearchParams;
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('stored-refresh');
    });

    it('returns false and logs out when the refresh is rejected', async () => {
      sessionStorage.setItem('projx.refresh_token', 'stored-refresh');
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({}),
      });

      expect(await authModule.initAuth()).toBe(false);
      expect(authModule.isAuthenticated()).toBe(false);
      expect(sessionStorage.getItem('projx.refresh_token')).toBeNull();
    });
  });
});
