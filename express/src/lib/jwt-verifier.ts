import {
  createRemoteJWKSet,
  importSPKI,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyOptions,
} from 'jose';
import { config } from '../config.js';
import { ApiError } from '../errors.js';

type ResolvedProvider = 'shared_secret' | 'public_key' | 'jwks';

export function resolveProvider(): ResolvedProvider {
  if (config.JWT_PROVIDER === 'shared_secret') return 'shared_secret';
  if (config.JWT_PROVIDER === 'public_key') return 'public_key';
  if (config.JWT_PROVIDER === 'jwks') return 'jwks';
  if (config.JWT_JWKS_URL) return 'jwks';
  if (config.JWT_PUBLIC_KEY) return 'public_key';
  return 'shared_secret';
}

let cachedJwks: {
  url: string;
  fn: ReturnType<typeof createRemoteJWKSet>;
} | null = null;

function getJwks(url: string): ReturnType<typeof createRemoteJWKSet> {
  if (cachedJwks && cachedJwks.url === url) return cachedJwks.fn;
  cachedJwks = { url, fn: createRemoteJWKSet(new URL(url)) };
  return cachedJwks.fn;
}

function buildVerifyOptions(provider: ResolvedProvider): JWTVerifyOptions {
  const opts: JWTVerifyOptions = {};
  if (config.JWT_ISSUER) opts.issuer = config.JWT_ISSUER;
  if (config.JWT_AUDIENCE) opts.audience = config.JWT_AUDIENCE;

  const parsed = config.JWT_ALGORITHMS
    ? config.JWT_ALGORITHMS.split(',')
        .map((a) => a.trim())
        .filter(Boolean)
    : null;
  if (parsed) {
    opts.algorithms = parsed;
  } else if (provider === 'shared_secret') {
    opts.algorithms = ['HS256'];
  } else {
    opts.algorithms = ['RS256'];
  }
  return opts;
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const provider = resolveProvider();
  const verifyOpts = buildVerifyOptions(provider);

  if (provider === 'shared_secret') {
    if (!config.JWT_SECRET) {
      throw new ApiError(
        500,
        'JWT_SECRET is not configured',
        'jwt_not_configured',
      );
    }
    const key = new TextEncoder().encode(config.JWT_SECRET);
    const { payload } = await jwtVerify(token, key, verifyOpts);
    return payload;
  }

  if (provider === 'public_key') {
    if (!config.JWT_PUBLIC_KEY) {
      throw new ApiError(
        500,
        'JWT_PUBLIC_KEY is not configured',
        'jwt_not_configured',
      );
    }
    const alg = verifyOpts.algorithms?.[0] ?? 'RS256';
    const key = await importSPKI(config.JWT_PUBLIC_KEY, alg);
    const { payload } = await jwtVerify(token, key, verifyOpts);
    return payload;
  }

  if (!config.JWT_JWKS_URL) {
    throw new ApiError(
      500,
      'JWT_JWKS_URL is not configured',
      'jwt_not_configured',
    );
  }
  const jwks = getJwks(config.JWT_JWKS_URL);
  const { payload } = await jwtVerify(token, jwks, verifyOpts);
  return payload;
}
