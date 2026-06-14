import type { RuntimeConfig } from './runtime-config';

function readServerEnv(): RuntimeConfig {
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

export function runtimeConfigScript(): string {
  const config = readServerEnv();
  return `window.__RUNTIME_CONFIG__=${JSON.stringify(config)};`;
}
