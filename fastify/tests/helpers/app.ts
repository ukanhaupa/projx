import Fastify, { type FastifyInstance } from 'fastify';
import prismaPlugin from '../../src/plugins/prisma.js';
import errorHandler from '../../src/plugins/error-handler.js';
import authPlugin from '../../src/plugins/auth.js';
import { EntityRegistry, registerEntityRoutes } from '../../src/modules/_base/index.js';

import '../../src/modules/audit-logs/index.js';

export async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(prismaPlugin);
  await app.register(errorHandler);
  await app.register(authPlugin);

  await app.register(
    async (instance) => {
      const entities = EntityRegistry.getAll();

      for (const entityConfig of entities) {
        await instance.register(
          async (entityInstance) => {
            registerEntityRoutes(entityInstance, entityConfig);
          },
          { prefix: entityConfig.apiPrefix },
        );
      }

      instance.get('/_meta', { onRequest: [instance.authenticate] }, async () => {
        return EntityRegistry.getMeta();
      });
    },
    { prefix: '/api/v1' },
  );

  app.get('/api/health', async (_request, reply) => {
    const checks: Record<string, string> = { app: 'ok' };
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch (e) {
      checks.database = `error: ${e instanceof Error ? e.message : String(e)}`;
      return reply.status(503).send({ status: 'unhealthy', checks });
    }
    return reply.send({ status: 'healthy', checks });
  });

  await app.ready();
  return app;
}
