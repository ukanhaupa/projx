import * as Sentry from '@sentry/react';

const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined) ?? '';

export function initSentry(): boolean {
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment:
      (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ??
      'production',
    release:
      (import.meta.env.VITE_SENTRY_RELEASE as string | undefined) || undefined,
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
