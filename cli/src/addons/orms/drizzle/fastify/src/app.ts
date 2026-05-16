import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import errorHandler from './plugins/error-handler.js';
import authPlugin from './plugins/auth.js';
import authzPlugin from './plugins/authz.js';
import requestIdPlugin from './plugins/request-id.js';
import swaggerPlugin from './plugins/swagger.js';
import { checkDatabase, closeDatabase, db } from './db/client.js';
import { listEntities } from './modules/_base/index.js';
// projx-anchor: entity-imports

export interface BuildAppOptions {
  logger?: boolean | object;
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? { level: config.LOG_LEVEL },
    genReqId: (req) =>
      (req.headers['x-request-id'] as string) || crypto.randomUUID(),
  });

  app.decorate('db', db);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ALLOW_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
  });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    keyGenerator: (request: FastifyRequest) =>
      request.authUser?.sub ?? request.ip,
  });

  await app.register(swaggerPlugin);
  await app.register(errorHandler);
  await app.register(requestIdPlugin);
  await app.register(authPlugin);
  await app.register(authzPlugin);

  app.get(
    '/api/health',
    {
      config: { public: true },
      schema: {
        tags: ['health'],
      },
    },
    async (_request, reply) => {
      const checks: Record<string, string> = { app: 'ok' };
      try {
        await checkDatabase();
        checks.database = 'ok';
      } catch (e) {
        checks.database = `error: ${e instanceof Error ? e.message : String(e)}`;
        return reply.status(503).send({ status: 'unhealthy', checks });
      }
      return reply.send({ status: 'healthy', checks });
    },
  );

  app.get(
    '/api/v1/_meta',
    {
      config: { public: true },
      schema: { tags: ['meta'] },
    },
    async () => ({ entities: listEntities(), orm: 'drizzle' }),
  );

  // projx-anchor: entity-registrations

  app.addHook('onClose', async () => {
    await closeDatabase();
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: typeof db;
  }
}
