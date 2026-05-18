import type { Request } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { ApiError } from '../../errors.js';
import { User } from '../../models/user.js';
import { RefreshToken } from '../../models/refresh-token.js';

export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
export const ACCESS_TTL_SECONDS = 15 * 60;

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
  const perms =
    ROLE_MODEL.permissions_by_role[
      role as keyof typeof ROLE_MODEL.permissions_by_role
    ];
  return perms ?? [];
}

function getJwtSecret(): string {
  const secret = config.JWT_SECRET;
  if (!secret) {
    throw new ApiError(
      500,
      'JWT_SECRET is not configured',
      'jwt_not_configured',
    );
  }
  return secret;
}

export function signJwt(
  payload: Record<string, unknown>,
  expiresInSeconds: number,
): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: expiresInSeconds });
}

export function verifyJwt<T>(token: string): T {
  return jwt.verify(token, getJwtSecret()) as T;
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
  payload: Omit<AuthTokenPayload, 'token_type' | 'jti'>,
): {
  token: string;
  refresh_token: string;
  access_jti: string;
  refresh_jti: string;
} {
  const accessJti = randomUUID();
  const refreshJti = randomUUID();
  const token = signJwt(
    { ...payload, token_type: 'access', jti: accessJti },
    ACCESS_TTL_SECONDS,
  );
  const refresh_token = signJwt(
    { ...payload, token_type: 'refresh', jti: refreshJti },
    REFRESH_TTL_SECONDS,
  );
  return { token, refresh_token, access_jti: accessJti, refresh_jti: refreshJti };
}

export async function issueAuthSession(
  user: User,
  request: Request,
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
  const tokens = signTokens(payload);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  await RefreshToken.create({
    user_id: user.id,
    session_id: sessionId,
    token_hash: hashRefreshToken(tokens.refresh_token),
    expires_at: expiresAt,
    ip_address: request.ip ?? null,
    user_agent: request.headers['user-agent'] ?? null,
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
