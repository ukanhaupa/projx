import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export default fp(async (fastify) => {
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Fastify Template API',
        description: 'Auto-entity CRUD API built with Fastify + Prisma',
        version: '1.0.0',
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
              'Paste only the raw JWT token; Swagger adds the "Bearer " prefix automatically.',
          },
        },
      },
      security: [{ BearerAuth: [] }],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
});
