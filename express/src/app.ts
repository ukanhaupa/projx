import crypto from 'node:crypto';
import compression from 'compression';
import cors from 'cors';
import express, { type RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { allowedOrigins, config } from './config.js';
import { ApiError, errorHandler, notFoundHandler } from './errors.js';
import { sentryErrorHandler, sentryRequestHandler } from './lib/sentry.js';
import { authenticate, requireAuth } from './middlewares/authenticate.js';
import { prisma as defaultPrisma, type PrismaLike } from './prisma.js';
import { EntityRegistry, registerEntityRoutes } from './modules/_base/index.js';
import './modules/audit-logs/index.js';
// projx-anchor: imports

const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const value =
    typeof incoming === 'string' && incoming.trim()
      ? incoming
      : crypto.randomUUID();
  res.locals.requestId = value;
  res.setHeader('x-request-id', value);
  next();
};

function corsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  const origins = allowedOrigins();
  if (!origin || origins.includes('*') || origins.includes(origin)) {
    callback(null, true);
    return;
  }
  callback(new ApiError(403, 'Origin not allowed', 'origin_not_allowed'));
}

export interface BuildAppOptions {
  prisma?: PrismaLike;
}

let _ready = false;

export function setReadiness(value: boolean): void {
  _ready = value;
}

export function isReady(): boolean {
  return _ready;
}

export function buildApp(options: BuildAppOptions = {}): express.Express {
  const app = express();
  const prisma = options.prisma ?? defaultPrisma;

  app.disable('x-powered-by');
  app.locals.prisma = prisma;
  app.use(requestId);
  app.use(sentryRequestHandler);
  app.use(
    pinoHttp({
      level: config.LOG_LEVEL,
      enabled: config.LOG_HTTP,
      quietReqLogger: !config.LOG_HTTP,
    }),
  );
  app.use(
    helmet({
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    }),
  );
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: config.RATE_LIMIT_MAX,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => {
        const sub = (req as { authUser?: { sub?: string } }).authUser?.sub;
        return sub ?? (req.ip ? ipKeyGenerator(req.ip) : 'unknown');
      },
    }),
  );
  app.set('trust proxy', 1);
  app.use(authenticate);
  app.use(requireAuth);
  // projx-anchor: plugins

  app.get('/api/health/live', (_req, res) => {
    res.json({ status: 'healthy' });
  });

  const readiness: RequestHandler = async (req, res) => {
    const checks: Record<string, string> = {
      app: _ready ? 'ok' : 'draining',
    };
    if (!_ready) {
      res.status(503).json({ status: 'unhealthy', checks });
      return;
    }
    try {
      await defaultPrisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch (e) {
      req.log.error({ err: e }, 'readiness database check failed');
      checks.database = 'error';
      res.status(503).json({ status: 'unhealthy', checks });
      return;
    }
    res.json({ status: 'healthy', checks });
  };

  app.get('/api/health/ready', readiness);
  app.get('/api/health', readiness);

  const skipped = EntityRegistry.getSkipped();
  if (skipped.length > 0 && config.EMIT_SKIP_WARNINGS) {
    process.emitWarning(JSON.stringify(skipped), {
      code: 'PROJX_ENTITY_SKIPPED',
    });
  }

  for (const entity of EntityRegistry.getAll()) {
    app.use(`/api/v1${entity.apiPrefix}`, registerEntityRoutes(entity, prisma));
  }

  app.use(notFoundHandler);
  app.use(sentryErrorHandler);
  app.use(errorHandler);

  return app;
}
