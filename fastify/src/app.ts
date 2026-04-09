import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config.js';
import prismaPlugin from './plugins/prisma.js';
import errorHandler from './plugins/error-handler.js';
import authPlugin from './plugins/auth.js';
import authzPlugin from './plugins/authz.js';
import requestIdPlugin from './plugins/request-id.js';
import swaggerPlugin from './plugins/swagger.js';
import { EntityRegistry, registerEntityRoutes } from './modules/_base/index.js';

import './modules/audit-logs/index.js';

export interface BuildAppOptions {
  logger?: boolean | object;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? {
      level: config.LOG_LEVEL,
      transport:
        process.env.NODE_ENV !== 'production'
          ? {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
            }
          : undefined,
    },
    genReqId: (req) => (req.headers['x-request-id'] as string) || crypto.randomUUID(),
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ALLOW_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
  });

  await app.register(swaggerPlugin);
  await app.register(prismaPlugin);
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
        await app.prisma.$queryRaw`SELECT 1`;
        checks.database = 'ok';
      } catch (e) {
        checks.database = `error: ${e instanceof Error ? e.message : String(e)}`;
        return reply.status(503).send({ status: 'unhealthy', checks });
      }
      return reply.send({ status: 'healthy', checks });
    },
  );

  await app.register(
    async (instance) => {
      const entities = EntityRegistry.getAll();

      for (const entityConfig of entities) {
        const routeRegistrar = entityConfig.customRoutes ?? registerEntityRoutes;
        await instance.register(
          async (entityInstance) => {
            routeRegistrar(entityInstance, entityConfig);
          },
          { prefix: entityConfig.apiPrefix },
        );
        app.log.debug(`Mounted ${entityConfig.name} at /api/v1${entityConfig.apiPrefix}`);
      }

      instance.get(
        '/_meta',
        {
          schema: {
            tags: ['meta'],
            response: {
              200: {
                type: 'object',
                properties: {
                  entities: { type: 'array' },
                },
              },
            },
          },
        },
        async () => {
          return EntityRegistry.getMeta();
        },
      );
    },
    { prefix: '/api/v1' },
  );

  return app;
}
