import * as Sentry from '@sentry/node';
import type { ErrorRequestHandler, RequestHandler } from 'express';

export const SENTRY_PURPOSE = 'sentry';

const DEFAULT_ENVIRONMENT = 'production';

export interface SentryRuntimeConfig {
  dsn: string;
  environment: string;
  release: string;
}

export function normalizeSentryConfig(
  raw: Record<string, unknown> | null,
): SentryRuntimeConfig {
  const dsn = typeof raw?.dsn === 'string' ? raw.dsn : '';
  const environment =
    typeof raw?.environment === 'string' && raw.environment
      ? raw.environment
      : DEFAULT_ENVIRONMENT;
  const release = typeof raw?.release === 'string' ? raw.release : '';
  return { dsn, environment, release };
}

let initialized = false;

export function initSentry(runtime: SentryRuntimeConfig): boolean {
  if (initialized) return true;
  if (!runtime.dsn) return false;

  Sentry.init({
    dsn: runtime.dsn,
    environment: runtime.environment,
    release: runtime.release || undefined,
    serverName: 'backend',
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    sendDefaultPii: false,
    integrations: [
      Sentry.httpIntegration(),
      Sentry.onUncaughtExceptionIntegration({
        exitEvenIfOtherHandlersAreRegistered: false,
      }),
      Sentry.onUnhandledRejectionIntegration({ mode: 'warn' }),
    ],
    beforeSend(event, hint) {
      const err = hint?.originalException as
        | { name?: string; statusCode?: number }
        | undefined;
      if (err?.name === 'NotFoundError' || err?.name === 'BusinessRuleError')
        return null;
      const status = err?.statusCode;
      if (typeof status === 'number' && status >= 400 && status < 500)
        return null;
      return event;
    },
    beforeSendTransaction(event) {
      const path = event.transaction;
      if (typeof path === 'string' && path.startsWith('/api/health'))
        return null;
      return event;
    },
  });

  initialized = true;
  return true;
}

export const sentryRequestHandler: RequestHandler = (req, _res, next) => {
  if (!initialized) {
    next();
    return;
  }
  Sentry.getCurrentScope().setTag(
    'request_id',
    (req as { id?: string }).id ?? '',
  );
  next();
};

export const sentryErrorHandler: ErrorRequestHandler = (
  err,
  _req,
  _res,
  next,
) => {
  if (!initialized) {
    next(err);
    return;
  }
  const status = (err as { statusCode?: number }).statusCode;
  if (typeof status !== 'number' || status >= 500) {
    Sentry.captureException(err);
  }
  next(err);
};

export const __sentryInternals = {
  reset(): void {
    initialized = false;
  },
};

export const SentryNode = Sentry;
