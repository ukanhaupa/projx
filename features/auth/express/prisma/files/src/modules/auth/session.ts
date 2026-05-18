import type { Request } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { ApiError } from '../../errors.js';
import type { PrismaLike } from '../../prisma.js';

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  last_login: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';

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

function getSecret(): string {
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

export function signAccessToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, getSecret(), { expiresIn: ACCESS_TTL });
}

export function signRefreshToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, getSecret(), { expiresIn: REFRESH_TTL });
}

export function signWithExpiry(
  payload: Record<string, unknown>,
  expiresIn: jwt.SignOptions['expiresIn'],
): string {
  return jwt.sign(payload, getSecret(), { expiresIn });
}

export function verifyToken<T extends object = Record<string, unknown>>(
  token: string,
): T {
  return jwt.verify(token, getSecret()) as T;
}

export function signTokens(
  payload: Omit<AuthTokenPayload, 'token_type' | 'jti'>,
) {
  const accessJti = randomUUID();
  const refreshJti = randomUUID();
  const token = signAccessToken({
    ...payload,
    token_type: 'access',
    jti: accessJti,
  });
  const refresh_token = signRefreshToken({
    ...payload,
    token_type: 'refresh',
    jti: refreshJti,
  });
  return {
    token,
    refresh_token,
    access_jti: accessJti,
    refresh_jti: refreshJti,
  };
}

interface RefreshTokenDelegate {
  create(args: {
    data: {
      user_id: string;
      session_id: string;
      token_hash: string;
      expires_at: Date;
      ip_address: string | null;
      user_agent: string | null;
    };
  }): Promise<unknown>;
}

type SessionPrismaClient = PrismaLike & {
  refreshToken: RefreshTokenDelegate;
};

export async function issueAuthSession(
  prisma: PrismaLike,
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

  const client = prisma as SessionPrismaClient;
  await client.refreshToken.create({
    data: {
      user_id: user.id,
      session_id: sessionId,
      token_hash: hashRefreshToken(tokens.refresh_token),
      expires_at: expiresAt,
      ip_address: request.ip ?? null,
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
