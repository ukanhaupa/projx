import type jwt from '@fastify/jwt';
import type { FastifyRequest } from 'fastify';
import { createRemoteJWKSet, exportSPKI, type JWTHeaderParameters } from 'jose';
import { config } from '../config.js';

type ResolvedProvider = 'shared_secret' | 'public_key' | 'jwks';

export function resolveProvider(): ResolvedProvider {
  if (config.JWT_PROVIDER === 'shared_secret') return 'shared_secret';
  if (config.JWT_PROVIDER === 'public_key') return 'public_key';
  if (config.JWT_PROVIDER === 'jwks') return 'jwks';
  if (config.JWT_JWKS_URL) return 'jwks';
  if (config.JWT_PUBLIC_KEY) return 'public_key';
  return 'shared_secret';
}

export function buildJwtOptions(): Parameters<typeof jwt>[1] {
  const provider = resolveProvider();
  const verify: Record<string, unknown> = {};
  if (config.JWT_ISSUER) verify.issuer = config.JWT_ISSUER;
  if (config.JWT_AUDIENCE) verify.audience = config.JWT_AUDIENCE;
  if (!config.JWT_REQUIRE_EXP) verify.ignoreExpiration = true;
  if (!config.JWT_VERIFY_NBF) verify.ignoreNotBefore = true;

  const parsedAlgorithms = config.JWT_ALGORITHMS
    ? config.JWT_ALGORITHMS.split(',')
        .map((a) => a.trim())
        .filter(Boolean)
    : null;

  if (provider === 'shared_secret') {
    verify.algorithms = parsedAlgorithms ?? ['HS256'];
    return { secret: config.JWT_SECRET, verify };
  }

  verify.algorithms = parsedAlgorithms ?? ['RS256'];

  if (provider === 'public_key') {
    return {
      secret: { private: config.JWT_SECRET, public: config.JWT_PUBLIC_KEY },
      sign: { algorithm: 'HS256' },
      verify,
    };
  }

  const jwksLookup = createRemoteJWKSet(new URL(config.JWT_JWKS_URL));
  return {
    secret: {
      private: config.JWT_SECRET,
      public: async (request: FastifyRequest, _tokenOrHeader: unknown) => {
        const auth = request.headers.authorization;
        if (!auth?.startsWith('Bearer ')) {
          throw new Error('Missing or malformed Authorization header');
        }
        const [headerB64] = auth.slice(7).split('.');
        const header = JSON.parse(
          Buffer.from(headerB64, 'base64url').toString(),
        ) as JWTHeaderParameters;
        const key = await jwksLookup(header);
        return exportSPKI(key as Parameters<typeof exportSPKI>[0]);
      },
    },
    sign: { algorithm: 'HS256' },
    verify,
  };
}
