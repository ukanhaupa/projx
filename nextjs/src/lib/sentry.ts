import * as Sentry from '@sentry/nextjs';
import { getRuntimeConfig } from './runtime-config';

export function initSentry(): boolean {
  const { sentryDsn, sentryEnvironment, sentryRelease } = getRuntimeConfig();
  if (!sentryDsn) return false;
  Sentry.init({
    dsn: sentryDsn,
    environment: sentryEnvironment,
    release: sentryRelease || undefined,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event, hint) {
      const err = hint?.originalException as
        | { name?: string; message?: string }
        | undefined;
      if (err?.name === 'AbortError') return null;
      if (err?.message?.includes('Failed to fetch')) return null;
      if (err?.message?.includes('NetworkError')) return null;
      return event;
    },
  });
  return true;
}

export { Sentry };
