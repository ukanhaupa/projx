import { getRuntimeConfig } from './runtime-config';
import type { UserInfo } from './types';

const REFRESH_STORAGE_KEY = 'projx.refresh_token';
const SESSION_FLAG_COOKIE = 'projx.session';

function setSessionFlag(present: boolean) {
  if (typeof document === 'undefined') return;
  if (present) {
    document.cookie = `${SESSION_FLAG_COOKIE}=1; path=/; SameSite=Strict`;
  } else {
    document.cookie = `${SESSION_FLAG_COOKIE}=; path=/; Max-Age=0; SameSite=Strict`;
  }
}

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

let tokens: StoredTokens | null = null;
let refreshPromise: Promise<void> | null = null;

function tokenUrl(): string {
  const { oidcUrl, oidcRealm } = getRuntimeConfig();
  if (!oidcUrl || !oidcRealm) {
    throw new Error(
      'NEXT_PUBLIC_OIDC_URL and NEXT_PUBLIC_OIDC_REALM are required',
    );
  }
  return `${oidcUrl}/realms/${oidcRealm}/protocol/openid-connect/token`;
}

function clientId(): string {
  const { oidcClientId } = getRuntimeConfig();
  if (!oidcClientId) {
    throw new Error('NEXT_PUBLIC_OIDC_CLIENT_ID is required');
  }
  return oidcClientId;
}

function decodePayload(accessToken: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(accessToken.split('.')[1]));
  } catch {
    return null;
  }
}

function parseExp(accessToken: string): number {
  const payload = decodePayload(accessToken);
  return ((payload?.exp as number | undefined) ?? 0) * 1000;
}

function save(raw: { access_token: string; refresh_token: string }) {
  tokens = {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_at: parseExp(raw.access_token),
  };
  sessionStorage.setItem(REFRESH_STORAGE_KEY, raw.refresh_token);
  setSessionFlag(true);
}

export async function login(username: string, password: string) {
  const { oidcUrl } = getRuntimeConfig();
  let res: Response;
  try {
    res = await fetch(tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: clientId(),
        username,
        password,
      }),
    });
  } catch {
    throw new Error(`Unable to reach authentication server at ${oidcUrl}`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error_description || 'Invalid credentials');
  }
  save(await res.json());
}

async function doRefresh(): Promise<void> {
  const refreshToken = tokens?.refresh_token;
  if (!refreshToken) return;
  try {
    const res = await fetch(tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId(),
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) throw new Error();
    save(await res.json());
  } catch {
    logout();
  }
}

export async function ensureFreshToken(): Promise<boolean> {
  if (!tokens) return false;
  if (tokens.expires_at - Date.now() < 10_000) {
    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => {
        refreshPromise = null;
      });
    }
    await refreshPromise;
  }
  return !!tokens;
}

export function getToken(): string | undefined {
  return tokens?.access_token;
}

export function isAuthenticated(): boolean {
  return !!tokens;
}

export function getRoles(): string[] {
  if (!tokens) return [];
  const payload = decodePayload(tokens.access_token);
  if (!payload) return [];
  const realm: string[] =
    (payload.realm_access as { roles?: string[] } | undefined)?.roles ?? [];
  const client: string[] = Object.values(
    (payload.resource_access ?? {}) as Record<string, { roles?: string[] }>,
  ).flatMap((r) => r.roles ?? []);
  return [...realm, ...client];
}

export function hasAnyRole(required: string[] = []): boolean {
  if (!required.length) return true;
  const userRoles = getRoles();
  return required.some((r) => userRoles.includes(r));
}

export function getUserInfo(): UserInfo {
  if (!tokens) return { name: 'User' };
  const payload = decodePayload(tokens.access_token);
  if (!payload) return { name: 'User' };
  return {
    name:
      (payload.preferred_username as string | undefined) ??
      (payload.name as string | undefined) ??
      (payload.sub as string | undefined) ??
      'User',
    email: payload.email as string | undefined,
  };
}

export function logout() {
  tokens = null;
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(REFRESH_STORAGE_KEY);
  }
  setSessionFlag(false);
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

export async function initAuth(): Promise<boolean> {
  const stored = sessionStorage.getItem(REFRESH_STORAGE_KEY);
  if (!stored) return false;
  tokens = {
    access_token: '',
    refresh_token: stored,
    expires_at: 0,
  };
  await doRefresh();
  return !!tokens;
}
