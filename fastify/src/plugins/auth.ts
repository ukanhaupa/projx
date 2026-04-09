import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { config } from '../config.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
  permissions?: string[];
  [key: string]: unknown;
}

const DEV_SUPERUSER: AuthUser = {
  sub: 'dev-user',
  email: 'dev@localhost',
  name: 'Dev Superuser',
  permissions: ['*'],
};

export default fp(async (fastify) => {
  await fastify.register(jwt, {
    secret: config.JWT_SECRET,
  });

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.AUTH_ENABLED) {
      request.authUser = DEV_SUPERUSER;
      return;
    }
    try {
      const decoded = await request.jwtVerify<AuthUser>();
      request.authUser = decoded;
    } catch {
      reply.status(401).send({ detail: 'Unauthorized' });
    }
  });

  fastify.decorate('authorize', (requiredPermission: string) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.authUser;
      if (!user) {
        return reply.status(401).send({ detail: 'Unauthorized' });
      }
      const perms = user.permissions ?? [];
      if (perms.includes('*') || perms.includes(requiredPermission)) {
        return;
      }
      return reply.status(403).send({ detail: 'Forbidden' });
    };
  });

  fastify.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.config?.public) return;
    await fastify.authenticate(request, reply);
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authorize: (
      permission: string,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    authUser?: AuthUser;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}
