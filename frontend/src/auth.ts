const OIDC_URL = import.meta.env.VITE_OIDC_URL || 'http://localhost:8080';
const OIDC_REALM = import.meta.env.VITE_OIDC_REALM || 'master';
const OIDC_CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID || 'frontend';

const TOKEN_URL = `${OIDC_URL}/realms/${OIDC_REALM}/protocol/openid-connect/token`;

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

let tokens: StoredTokens | null = null;
let refreshTimer: number | null = null;
let refreshPromise: Promise<void> | null = null;

function parseExp(accessToken: string): number {
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1]));
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (!tokens) return;
  const msUntilExpiry = tokens.expires_at - Date.now();
  const delay = Math.max(msUntilExpiry - 30_000, 1_000);
  refreshTimer = window.setTimeout(() => {
    doRefresh();
  }, delay);
}

function save(raw: { access_token: string; refresh_token: string }) {
  tokens = {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_at: parseExp(raw.access_token),
  };
  localStorage.setItem('auth', JSON.stringify(tokens));
  scheduleRefresh();
}

export async function login(username: string, password: string) {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: OIDC_CLIENT_ID,
        username,
        password,
      }),
    });
  } catch {
    throw new Error(`Unable to reach authentication server at ${OIDC_URL}`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error_description || 'Invalid credentials');
  }
  save(await res.json());
}

async function doRefresh(): Promise<void> {
  if (!tokens) return;
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: OIDC_CLIENT_ID,
        refresh_token: tokens.refresh_token,
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
  try {
    const payload = JSON.parse(atob(tokens.access_token.split('.')[1]));
    const realm: string[] = payload.realm_access?.roles ?? [];
    const client: string[] = Object.values(
      (payload.resource_access ?? {}) as Record<string, { roles?: string[] }>,
    ).flatMap((r) => r.roles ?? []);
    return [...realm, ...client];
  } catch {
    return [];
  }
}

export function hasAnyRole(required: string[] = []): boolean {
  if (!required.length) return true;
  const userRoles = getRoles();
  return required.some((r) => userRoles.includes(r));
}

export function getUserInfo() {
  if (!tokens) return { name: 'User' };
  try {
    const payload = JSON.parse(atob(tokens.access_token.split('.')[1]));
    return {
      name: payload.preferred_username ?? payload.name ?? payload.sub ?? 'User',
      email: payload.email,
    };
  } catch {
    return { name: 'User' };
  }
}

export function logout() {
  tokens = null;
  localStorage.removeItem('auth');
  if (refreshTimer) clearTimeout(refreshTimer);
  window.location.href = '/';
}

export function initAuth(): boolean {
  const stored = localStorage.getItem('auth');
  if (!stored) return false;
  try {
    const parsed: StoredTokens = JSON.parse(stored);
    if (!parsed.access_token || !parsed.refresh_token) return false;
    tokens = parsed;
    if (tokens.expires_at - Date.now() < 10_000) {
      doRefresh();
    } else {
      scheduleRefresh();
    }
    return true;
  } catch {
    return false;
  }
}
