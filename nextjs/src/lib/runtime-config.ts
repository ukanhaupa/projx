export interface RuntimeConfig {
  apiUrl: string;
  oidcUrl: string;
  oidcRealm: string;
  oidcClientId: string;
  sentryDsn: string;
  sentryEnvironment: string;
  sentryRelease: string;
}

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: Partial<RuntimeConfig>;
  }
}

function fromEnv(): RuntimeConfig {
  return {
    apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000',
    oidcUrl: process.env.NEXT_PUBLIC_OIDC_URL ?? '',
    oidcRealm: process.env.NEXT_PUBLIC_OIDC_REALM ?? '',
    oidcClientId: process.env.NEXT_PUBLIC_OIDC_CLIENT_ID ?? '',
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? '',
    sentryEnvironment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'production',
    sentryRelease: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? '',
  };
}

export function getRuntimeConfig(): RuntimeConfig {
  const base = fromEnv();
  if (typeof window === 'undefined') return base;
  const injected = window.__RUNTIME_CONFIG__ ?? {};
  return {
    apiUrl: injected.apiUrl || base.apiUrl,
    oidcUrl: injected.oidcUrl || base.oidcUrl,
    oidcRealm: injected.oidcRealm || base.oidcRealm,
    oidcClientId: injected.oidcClientId || base.oidcClientId,
    sentryDsn: injected.sentryDsn || base.sentryDsn,
    sentryEnvironment: injected.sentryEnvironment || base.sentryEnvironment,
    sentryRelease: injected.sentryRelease || base.sentryRelease,
  };
}
