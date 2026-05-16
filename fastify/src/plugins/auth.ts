import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { config } from '../config.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { isPublicPath } from './public-paths.js';

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
  role?: string;
  permissions?: string[];
  permissions_map?: Record<string, string[]>;
  [key: string]: unknown;
}

function buildJwtOptions(): Parameters<typeof jwt>[1] {
  const opts: Parameters<typeof jwt>[1] = { secret: config.JWT_SECRET };
  const verify: Record<string, unknown> = {};

  if (config.JWT_ALGORITHMS) {
    verify.algorithms = config.JWT_ALGORITHMS.split(',').map((a) => a.trim());
  }
  if (config.JWT_ISSUER) verify.issuer = config.JWT_ISSUER;
  if (config.JWT_AUDIENCE) verify.audience = config.JWT_AUDIENCE;
  if (!config.JWT_REQUIRE_EXP) verify.ignoreExpiration = true;
  if (!config.JWT_VERIFY_NBF) verify.ignoreNotBefore = true;

  if (Object.keys(verify).length) opts.verify = verify;
  return opts;
}

export default fp(async (fastify) => {
  await fastify.register(jwt, buildJwtOptions());

  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const decoded = await request.jwtVerify<AuthUser>();
        request.authUser = decoded;
      } catch (err) {
        const code = err instanceof Error ? err.message : 'unknown';
        request.log.debug(`JWT verification failed (${code})`);
        reply.status(401).send({ detail: 'Invalid or expired token' });
      }
    },
  );

  fastify.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0];
    if (request.routeOptions.config?.public || isPublicPath(url)) return;
    await fastify.authenticate(request, reply);
    if (request.authUser) {
      request.log.debug(
        `Authenticated request: ${request.method} ${url} by ${request.authUser.email ?? request.authUser.sub}`,
      );
    } else {
      request.log.debug(`Unauthenticated request: ${request.method} ${url}`);
    }
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
  interface FastifyRequest {
    authUser?: AuthUser;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}
