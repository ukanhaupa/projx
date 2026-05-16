import 'reflect-metadata';
import crypto from 'node:crypto';
import compression from 'compression';
import cors from 'cors';
import express, { type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { allowedOrigins, config } from './config.js';
import { ApiError, errorHandler, notFoundHandler } from './errors.js';
import { checkDatabase, dataSource } from './db/data-source.js';
import { listEntities } from './modules/_base/index.js';
// projx-anchor: entity-imports

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

export function buildApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.locals.dataSource = dataSource;
  app.use(requestId);
  app.use(pinoHttp({ level: config.LOG_LEVEL }));
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

  app.get('/api/health', async (_req, res) => {
    const checks: Record<string, string> = { app: 'ok' };
    try {
      await checkDatabase();
      checks.database = 'ok';
    } catch (e) {
      checks.database = `error: ${e instanceof Error ? e.message : String(e)}`;
      res.status(503).json({ status: 'unhealthy', checks });
      return;
    }
    res.json({ status: 'healthy', checks });
  });

  app.get('/api/v1/_meta', (_req, res) => {
    res.json({ entities: listEntities(), orm: 'typeorm' });
  });

  // projx-anchor: entity-registrations

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
