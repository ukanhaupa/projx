import type { User } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';

export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export const ROLE_MODEL = {
  roles: ['admin', 'user'] as const,
  permissions_by_role: {
    admin: ['*'],
    user: ['*:read.*'],
  },
};

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function permissionsForRole(role: string): string[] {
  const perms = ROLE_MODEL.permissions_by_role[role as keyof typeof ROLE_MODEL.permissions_by_role];
  return perms ?? [];
}

export interface AuthTokenPayload {
  sub: string;
  role: string;
  sid: string;
  email: string;
  name?: string;
  permissions: string[];
  token_type: 'access' | 'refresh';
  jti: string;
}

export function signTokens(
  fastify: {
    jwt: {
      sign: (payload: Record<string, unknown>, options?: { expiresIn?: string }) => string;
    };
  },
  payload: Omit<AuthTokenPayload, 'token_type' | 'jti'>,
) {
  const accessJti = randomUUID();
  const refreshJti = randomUUID();
  const token = fastify.jwt.sign(
    { ...payload, token_type: 'access', jti: accessJti },
    { expiresIn: '15m' },
  );
  const refresh_token = fastify.jwt.sign(
    { ...payload, token_type: 'refresh', jti: refreshJti },
    { expiresIn: '7d' },
  );
  return { token, refresh_token, access_jti: accessJti, refresh_jti: refreshJti };
}

export async function issueAuthSession(
  fastify: FastifyInstance,
  user: User,
  request: FastifyRequest,
): Promise<{
  user: Record<string, unknown>;
  token: string;
  access_token: string;
  refresh_token: string;
}> {
  const sessionId = randomUUID();
  const payload = {
    sub: user.id,
    sid: sessionId,
    role: user.role,
    email: user.email,
    name: user.name,
    permissions: [...permissionsForRole(user.role)],
  };
  const tokens = signTokens(fastify, payload);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  await fastify.prisma.refreshToken.create({
    data: {
      user_id: user.id,
      session_id: sessionId,
      token_hash: hashRefreshToken(tokens.refresh_token),
      expires_at: expiresAt,
      ip_address: request.ip,
      user_agent: request.headers['user-agent'] ?? null,
    },
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      last_login: user.last_login,
      created_at: user.created_at,
      updated_at: user.updated_at,
    },
    token: tokens.token,
    access_token: tokens.token,
    refresh_token: tokens.refresh_token,
  };
}
