import * as Sentry from '@sentry/node';
import type { FastifyError, FastifyInstance, FastifyRequest } from 'fastify';
import { BusinessRuleError, NotFoundError } from '../errors.js';

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

const DROP_ERROR_NAMES = new Set([
  'BusinessRuleError',
  'NotFoundError',
  'ValidationError',
  'FastifyError',
]);

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
      const err = hint?.originalException as Error | undefined;
      if (err instanceof BusinessRuleError) return null;
      if (err instanceof NotFoundError) return null;
      const status =
        err && typeof err === 'object' && 'statusCode' in err
          ? Number((err as { statusCode?: unknown }).statusCode)
          : NaN;
      if (Number.isFinite(status) && status >= 400 && status < 500) return null;
      if (err?.name && DROP_ERROR_NAMES.has(err.name)) return null;
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

export function registerSentryFastifyHooks(app: FastifyInstance): void {
  if (!initialized) return;

  app.addHook('onRequest', async (request: FastifyRequest) => {
    Sentry.getCurrentScope().setTag('request_id', request.id);
  });

  app.addHook('onResponse', async () => {
    Sentry.getCurrentScope().clear();
  });

  app.addHook(
    'onError',
    async (request: FastifyRequest, _reply, err: FastifyError) => {
      if (err instanceof BusinessRuleError) return;
      if (err instanceof NotFoundError) return;
      const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
      if (status >= 400 && status < 500) return;
      Sentry.withScope((scope) => {
        scope.setTag('request_id', request.id);
        scope.setTag('route', request.routeOptions?.url ?? request.url);
        Sentry.captureException(err);
      });
    },
  );
}

export const __sentryInternals = {
  reset(): void {
    initialized = false;
  },
};

export const SentryNode = Sentry;
