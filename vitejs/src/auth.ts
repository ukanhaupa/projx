const OIDC_URL = import.meta.env.VITE_OIDC_URL;
const OIDC_REALM = import.meta.env.VITE_OIDC_REALM;
const OIDC_CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID;

if (!OIDC_URL || !OIDC_REALM || !OIDC_CLIENT_ID) {
  throw new Error(
    'VITE_OIDC_URL, VITE_OIDC_REALM, and VITE_OIDC_CLIENT_ID are required',
  );
}

const TOKEN_URL = `${OIDC_URL}/realms/${OIDC_REALM}/protocol/openid-connect/token`;
const REFRESH_STORAGE_KEY = 'projx.refresh_token';

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

let tokens: StoredTokens | null = null;
let refreshPromise: Promise<void> | null = null;

function parseExp(accessToken: string): number {
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1]));
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

function save(raw: { access_token: string; refresh_token: string }) {
  tokens = {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_at: parseExp(raw.access_token),
  };
  sessionStorage.setItem(REFRESH_STORAGE_KEY, raw.refresh_token);
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
  const refreshToken = tokens?.refresh_token;
  if (!refreshToken) return;
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: OIDC_CLIENT_ID,
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
  sessionStorage.removeItem(REFRESH_STORAGE_KEY);
  window.location.href = '/';
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
