import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Helper to create a JWT-like token with a given payload
function makeToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe('auth', () => {
  let authModule: typeof import('../src/auth');

  const originalLocation = window.location;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
    localStorage.clear();

    // Mock window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: { href: '/', assign: vi.fn() },
    });

    authModule = await import('../src/auth');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: originalLocation,
    });
  });

  describe('login', () => {
    it('stores tokens on successful login', async () => {
      const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: token,
            refresh_token: 'refresh-123',
          }),
      });

      await authModule.login('user', 'pass');

      expect(authModule.isAuthenticated()).toBe(true);
      expect(authModule.getToken()).toBe(token);
      expect(sessionStorage.getItem('projx.refresh_token')).toBe('refresh-123');
    });

    it('sends correct form data to token endpoint', async () => {
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
      expect(call[1].method).toBe('POST');
      expect(call[1].headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      );
      const body = call[1].body as URLSearchParams;
      expect(body.get('grant_type')).toBe('password');
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

    it('returns token after login', async () => {
      const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });

      await authModule.login('u', 'p');
      expect(authModule.getToken()).toBe(token);
      expect(authModule.isAuthenticated()).toBe(true);
    });
  });

  describe('ensureFreshToken', () => {
    it('returns false when not authenticated', async () => {
      const result = await authModule.ensureFreshToken();
      expect(result).toBe(false);
    });

    it('returns true when token is still valid', async () => {
      const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');

      const result = await authModule.ensureFreshToken();
      expect(result).toBe(true);
    });

    it('refreshes when token expires within 10s', async () => {
      // Login with a token that expires in 5 seconds
      const almostExpiredToken = makeToken({
        exp: Math.floor(Date.now() / 1000) + 5,
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: almostExpiredToken,
            refresh_token: 'r',
          }),
      });
      await authModule.login('u', 'p');

      // Mock refresh response
      const newToken = makeToken({
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: newToken, refresh_token: 'r2' }),
      });

      const result = await authModule.ensureFreshToken();
      expect(result).toBe(true);
      expect(authModule.getToken()).toBe(newToken);
    });

    it('deduplicates concurrent refresh calls', async () => {
      const almostExpiredToken = makeToken({
        exp: Math.floor(Date.now() / 1000) + 5,
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: almostExpiredToken,
            refresh_token: 'r',
          }),
      });
      await authModule.login('u', 'p');

      const newToken = makeToken({
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: newToken, refresh_token: 'r2' }),
      });

      // Call concurrently
      const [r1, r2] = await Promise.all([
        authModule.ensureFreshToken(),
        authModule.ensureFreshToken(),
      ]);

      expect(r1).toBe(true);
      expect(r2).toBe(true);
      // fetch called: 1 login + 1 refresh (not 2 refreshes)
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('doRefresh', () => {
    it('logs out on refresh failure', async () => {
      const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 5 });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');

      // Refresh fails
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      });

      await authModule.ensureFreshToken();

      expect(authModule.isAuthenticated()).toBe(false);
      expect(window.location.href).toBe('/');
    });

    it('logs out on refresh network error', async () => {
      const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 5 });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');

      // Refresh throws
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('network'),
      );

      await authModule.ensureFreshToken();
      expect(authModule.isAuthenticated()).toBe(false);
    });
  });

  describe('getRoles', () => {
    it('returns empty array when not authenticated', () => {
      expect(authModule.getRoles()).toEqual([]);
    });

    it('returns realm_access roles', async () => {
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

      const roles = authModule.getRoles();
      expect(roles).toContain('admin');
      expect(roles).toContain('user');
    });

    it('returns combined realm and resource_access roles', async () => {
      const token = makeToken({
        exp: Math.floor(Date.now() / 1000) + 3600,
        realm_access: { roles: ['admin'] },
        resource_access: {
          'my-app': { roles: ['editor'] },
          'other-app': { roles: ['viewer'] },
        },
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');

      const roles = authModule.getRoles();
      expect(roles).toEqual(['admin', 'editor', 'viewer']);
    });

    it('handles missing realm_access and resource_access', async () => {
      const token = makeToken({
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');

      expect(authModule.getRoles()).toEqual([]);
    });

    it('handles resource_access with missing roles array', async () => {
      const token = makeToken({
        exp: Math.floor(Date.now() / 1000) + 3600,
        resource_access: { 'my-app': {} },
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');

      expect(authModule.getRoles()).toEqual([]);
    });

    it('returns empty array on malformed token', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'not.a.valid.token',
            refresh_token: 'r',
          }),
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

      expect(authModule.hasAnyRole(['admin', 'superadmin'])).toBe(false);
    });

    it('returns true when user has at least one matching role', async () => {
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
    it('returns default when not authenticated', () => {
      expect(authModule.getUserInfo()).toEqual({ name: 'User' });
    });

    it('returns preferred_username', async () => {
      const token = makeToken({
        exp: Math.floor(Date.now() / 1000) + 3600,
        preferred_username: 'johndoe',
        email: 'john@example.com',
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');

      const info = authModule.getUserInfo();
      expect(info.name).toBe('johndoe');
      expect(info.email).toBe('john@example.com');
    });

    it('falls back to name when no preferred_username', async () => {
      const token = makeToken({
        exp: Math.floor(Date.now() / 1000) + 3600,
        name: 'John Doe',
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');

      expect(authModule.getUserInfo().name).toBe('John Doe');
    });

    it('falls back to sub when no preferred_username or name', async () => {
      const token = makeToken({
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub: 'user-uuid-123',
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');

      expect(authModule.getUserInfo().name).toBe('user-uuid-123');
    });

    it('falls back to User when token has no user fields', async () => {
      const token = makeToken({
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');

      expect(authModule.getUserInfo().name).toBe('User');
    });

    it('returns default on malformed token', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: 'bad-token', refresh_token: 'r' }),
      });
      await authModule.login('u', 'p');
      expect(authModule.getUserInfo()).toEqual({ name: 'User' });
    });
  });

  describe('logout', () => {
    it('clears tokens and redirects to /', async () => {
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
      expect(window.location.href).toBe('/');
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
      expect(authModule.isAuthenticated()).toBe(true);
      expect(authModule.getToken()).toBe(token);
      expect(sessionStorage.getItem('projx.refresh_token')).toBe('r2');
    });

    it('sends the stored refresh token to the token endpoint', async () => {
      sessionStorage.setItem('projx.refresh_token', 'stored-refresh');
      const token = makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: token, refresh_token: 'r2' }),
      });

      await authModule.initAuth();

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
