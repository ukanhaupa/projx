import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../errors.js';

interface EntityConfig {
  tableName: string;
  apiPrefix: string;
}

const SAFE_PERMISSION_RE = /^[a-z0-9_*:. ]+$/;

function normalizeResource(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, '_');
}

function normalizePermission(value: string): string {
  const p = value.trim().toLowerCase();
  if (!p) return '';
  if (p.includes(':')) {
    const [resource, actionScope] = p.split(':', 2);
    return `${normalizeResource(resource)}:${actionScope.trim()}`;
  }
  return p;
}

function fnmatch(value: string, pattern: string): boolean {
  if (pattern === value) return true;
  if (pattern === '*') return true;
  const re = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$',
  );
  return re.test(value);
}

function matchesPermission(
  required: string,
  permissions: readonly string[],
): boolean {
  const target = normalizePermission(required);
  for (const userPerm of permissions) {
    if (!userPerm || !SAFE_PERMISSION_RE.test(userPerm)) continue;
    const normalized = normalizePermission(userPerm);
    if (normalized === '*' || normalized === '*:*.*') return true;
    if (fnmatch(target, normalized)) return true;
  }
  return false;
}

export function requirePermission(permission: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.authUser;
    if (!user) {
      next(new ApiError(401, 'Authentication required', 'unauthorized'));
      return;
    }
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    if (!matchesPermission(permission, perms)) {
      next(
        new ApiError(
          403,
          `Insufficient permissions: ${permission} required`,
          'forbidden',
        ),
      );
      return;
    }
    next();
  };
}

export function computeScopeFilters(
  _req: Request,
  _entityConfig: EntityConfig,
): Record<string, unknown> | null {
  return null;
}
