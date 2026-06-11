import { z } from 'zod';

const envSchema = z.object({
  LOG_HTTP: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true'),
  EMIT_SKIP_WARNINGS: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('debug'),
  CORS_ALLOW_ORIGINS: z.string().default('http://localhost:5173'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(200),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  JWT_SECRET: z
    .string()
    .min(
      32,
      'JWT_SECRET is required and must be at least 32 characters. Generate one with: openssl rand -base64 48',
    ),
  JWT_PROVIDER: z
    .enum(['shared_secret', 'public_key', 'jwks', 'auto'])
    .default('auto'),
  JWT_PUBLIC_KEY: z.string().default(''),
  JWT_JWKS_URL: z.string().default(''),
  JWT_ALGORITHMS: z.string().default(''),
  JWT_ISSUER: z.string().default(''),
  JWT_AUDIENCE: z.string().default(''),
  CRED_ENCRYPTION_KEY: z.string().optional(),
});

export const config = envSchema.parse(process.env);

export function allowedOrigins(): string[] {
  return config.CORS_ALLOW_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
