import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const ConfigSchema = Type.Object({
  HOST: Type.String({ default: '0.0.0.0' }),
  PORT: Type.Number({ default: 3000 }),
  LOG_LEVEL: Type.String({ default: 'info' }),
  DATABASE_URL: Type.String(),
  AUTH_ENABLED: Type.Boolean({ default: false }),
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
  CORS_ALLOW_ORIGINS: Type.String({ default: 'http://localhost:5173' }),
});

export type Config = Static<typeof ConfigSchema>;

function loadConfig(): Config {
  const raw = {
    HOST: process.env.HOST ?? '0.0.0.0',
    PORT: Number(process.env.PORT ?? 3000),
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    AUTH_ENABLED: process.env.AUTH_ENABLED === 'true',
    JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
    JWT_PROVIDER: process.env.JWT_PROVIDER ?? 'shared_secret',
    JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY ?? '',
    JWT_JWKS_URL: process.env.JWT_JWKS_URL ?? '',
    CORS_ALLOW_ORIGINS: process.env.CORS_ALLOW_ORIGINS ?? 'http://localhost:5173',
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
