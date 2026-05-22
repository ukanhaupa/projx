import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { JWTPayload } from 'jose';
import { ApiError } from '../errors.js';
import { verifyToken } from '../lib/jwt-verifier.js';

export interface AuthUser {
  sub: string;
  email: string;
  role: string;
  permissions: string[];
  sid?: string;
  exp?: number;
  [key: string]: unknown;
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ', 2);
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  const trimmed = token?.trim();
  return trimmed ? trimmed : null;
}

function toAuthUser(payload: JWTPayload): AuthUser {
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new ApiError(401, 'Invalid token payload', 'invalid_token');
  }
  const permsRaw = (payload as Record<string, unknown>).permissions;
  const permissions = Array.isArray(permsRaw)
    ? permsRaw.map((p) => String(p))
    : [];
  return {
    ...(payload as Record<string, unknown>),
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : '',
    role: typeof payload.role === 'string' ? payload.role : '',
    permissions,
    sid:
      typeof (payload as Record<string, unknown>).sid === 'string'
        ? ((payload as Record<string, unknown>).sid as string)
        : undefined,
    exp: typeof payload.exp === 'number' ? payload.exp : undefined,
  };
}

export const authenticate: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = extractBearer(req.headers.authorization);
  if (!token) {
    next();
    return;
  }
  try {
    const payload = await verifyToken(token);
    req.authUser = toAuthUser(payload);
    next();
  } catch (err) {
    if (err instanceof ApiError) {
      next(err);
      return;
    }
    next(new ApiError(401, 'Invalid or expired token', 'invalid_token'));
  }
};

export const requireAuth: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (!req.authUser) {
    next(new ApiError(401, 'Authentication required', 'unauthorized'));
    return;
  }
  next();
};
