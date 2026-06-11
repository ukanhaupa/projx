import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import {
  SENTRY_PURPOSE,
  initSentry,
  normalizeSentryConfig,
  registerSentryFastifyHooks,
} from './lib/sentry.js';
import { getServiceConfig } from './lib/service-config.js';
import prismaPlugin from './plugins/prisma.js';
import errorHandler from './plugins/error-handler.js';
import authPlugin from './plugins/auth.js';
import authzPlugin from './plugins/authz.js';
import requestIdPlugin from './plugins/request-id.js';
import swaggerPlugin from './plugins/swagger.js';
import { EntityRegistry, registerEntityRoutes } from './modules/_base/index.js';

import './modules/audit-logs/index.js';
// projx-anchor: imports

export interface BuildAppOptions {
  logger?: boolean | object;
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? {
      level: config.LOG_LEVEL,
      transport: config.LOG_PRETTY
        ? {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
          }
        : undefined,
    },
    genReqId: (req) =>
      (req.headers['x-request-id'] as string) || crypto.randomUUID(),
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [`'none'`],
        scriptSrc: [`'none'`],
        styleSrc: [`'none'`],
        imgSrc: [`'self'`],
        frameAncestors: [`'none'`],
        baseUri: [`'none'`],
      },
    },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  });
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

  if (config.EXPOSE_API_DOCS) {
    await app.register(swaggerPlugin);
  }
  await app.register(prismaPlugin);

  const sentryRuntime = normalizeSentryConfig(
    await getServiceConfig(app.prisma, SENTRY_PURPOSE),
  );
  if (initSentry(sentryRuntime)) {
    registerSentryFastifyHooks(app);
  }

  await app.register(errorHandler);
  await app.register(requestIdPlugin);
  await app.register(authPlugin);
  await app.register(authzPlugin);
  // projx-anchor: plugins

  app.get(
    '/api/health/live',
    {
      config: { public: true },
      schema: { tags: ['health'] },
      logLevel: 'debug',
    },
    async (_request, reply) => reply.send({ status: 'healthy' }),
  );

  const readiness = async (request: FastifyRequest, reply: FastifyReply) => {
    const checks: Record<string, string> = { app: 'ok' };
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch (e) {
      request.log.error({ err: e }, 'readiness database check failed');
      checks.database = 'error';
      return reply.status(503).send({ status: 'unhealthy', checks });
    }
    return reply.send({ status: 'healthy', checks });
  };

  app.get(
    '/api/health/ready',
    {
      config: { public: true },
      schema: { tags: ['health'] },
      logLevel: 'debug',
    },
    readiness,
  );

  app.get(
    '/api/health',
    {
      config: { public: true },
      schema: { tags: ['health'] },
      logLevel: 'debug',
    },
    readiness,
  );

  await app.register(
    async (instance) => {
      const entities = EntityRegistry.getAll();
      const skipped = EntityRegistry.getSkipped();

      if (skipped.length > 0) {
        app.log.warn(
          { entities: skipped },
          'EntityRegistry skipped auto-route registration',
        );
      }

      for (const entityConfig of entities) {
        const routeRegistrar =
          entityConfig.customRoutes ?? registerEntityRoutes;
        await instance.register(
          async (entityInstance) => {
            routeRegistrar(entityInstance, entityConfig);
          },
          { prefix: entityConfig.apiPrefix },
        );
        app.log.debug(
          `Mounted ${entityConfig.name} at /api/v1${entityConfig.apiPrefix}`,
        );
      }
    },
    { prefix: '/api/v1' },
  );

  return app;
}
