import crypto from 'node:crypto';
import compression from 'compression';
import cors from 'cors';
import express, { type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { allowedOrigins, config } from './config.js';
import { ApiError, errorHandler, notFoundHandler } from './errors.js';
import { prisma as defaultPrisma, type PrismaLike } from './prisma.js';
import { EntityRegistry, registerEntityRoutes } from './modules/_base/index.js';
import './modules/audit-logs/index.js';

const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const value = typeof incoming === 'string' && incoming.trim() ? incoming : crypto.randomUUID();
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

export function buildApp(options: BuildAppOptions = {}): express.Express {
  const app = express();
  const prisma = options.prisma ?? defaultPrisma;

  app.disable('x-powered-by');
  app.locals.prisma = prisma;
  app.use(requestId);
  app.use(
    pinoHttp({
      level: config.LOG_LEVEL,
      enabled: config.NODE_ENV !== 'test',
      quietReqLogger: config.NODE_ENV === 'test',
    }),
  );
  app.use(helmet());
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
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'healthy', checks: { app: 'ok' } });
  });

  const skipped = EntityRegistry.getSkipped();
  if (skipped.length > 0 && config.NODE_ENV !== 'test') {
    process.emitWarning(JSON.stringify(skipped), {
      code: 'PROJX_ENTITY_SKIPPED',
    });
  }

  for (const entity of EntityRegistry.getAll()) {
    app.use(`/api/v1${entity.apiPrefix}`, registerEntityRoutes(entity, prisma));
  }

  app.get('/api/v1/_meta', (_req, res) => {
    res.json(EntityRegistry.getMeta());
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
