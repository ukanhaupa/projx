import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const ConfigSchema = Type.Object({
  HOST: Type.String({ default: '0.0.0.0' }),
  PORT: Type.Number({ default: 3000 }),
  LOG_LEVEL: Type.String({ default: 'debug' }),
  DATABASE_URL: Type.String(),
  JWT_SECRET: Type.String({ default: 'dev-secret-change-in-production' }),
  JWT_PROVIDER: Type.Union(
    [
      Type.Literal('shared_secret'),
      Type.Literal('public_key'),
      Type.Literal('jwks'),
      Type.Literal('auto'),
    ],
    { default: 'shared_secret' },
  ),
  JWT_PUBLIC_KEY: Type.String({ default: '' }),
  JWT_JWKS_URL: Type.String({ default: '' }),
  JWT_ALGORITHMS: Type.String({ default: '' }),
  JWT_ISSUER: Type.String({ default: '' }),
  JWT_AUDIENCE: Type.String({ default: '' }),
  JWT_REQUIRE_EXP: Type.Boolean({ default: true }),
  JWT_VERIFY_NBF: Type.Boolean({ default: true }),
  CORS_ALLOW_ORIGINS: Type.String({ default: 'http://localhost:5173' }),
  CRED_ENCRYPTION_KEY: Type.String({ default: '' }),
  RATE_LIMIT_MAX: Type.Number({ default: 200 }),
  RATE_LIMIT_WINDOW: Type.String({ default: '1 minute' }),
});

export type Config = Static<typeof ConfigSchema>;

function loadConfig(): Config {
  const raw = {
    HOST: process.env.HOST ?? '0.0.0.0',
    PORT: Number(process.env.PORT ?? 3000),
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'debug',
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
    JWT_PROVIDER: process.env.JWT_PROVIDER ?? 'shared_secret',
    JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY ?? '',
    JWT_JWKS_URL: process.env.JWT_JWKS_URL ?? '',
    JWT_ALGORITHMS: process.env.JWT_ALGORITHMS ?? '',
    JWT_ISSUER: process.env.JWT_ISSUER ?? '',
    JWT_AUDIENCE: process.env.JWT_AUDIENCE ?? '',
    JWT_REQUIRE_EXP: process.env.JWT_REQUIRE_EXP !== 'false',
    JWT_VERIFY_NBF: process.env.JWT_VERIFY_NBF !== 'false',
    CORS_ALLOW_ORIGINS: process.env.CORS_ALLOW_ORIGINS ?? 'http://localhost:5173',
    CRED_ENCRYPTION_KEY: process.env.CRED_ENCRYPTION_KEY ?? '',
    RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX ?? 200),
    RATE_LIMIT_WINDOW: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
  };

  if (!Value.Check(ConfigSchema, raw)) {
    const errors = [...Value.Errors(ConfigSchema, raw)];
    const messages = errors.map((e) => `${e.path}: ${e.message}`).join(', ');
    throw new Error(`Invalid configuration: ${messages}`);
  }

  if (!raw.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  return raw;
}

export const config = loadConfig();
