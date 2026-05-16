import fp from 'fastify-plugin';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { isPublicPath, isAuthnOnlyPath } from './public-paths.js';

const SAFE_PERMISSION_RE = /^[a-z0-9_*:. ]+$/;

const METHOD_ACTION_MAP: Record<string, string> = {
  GET: 'read',
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

// ── Permission Resolvers ────────────────────────────────────────────

export interface PermissionResolver {
  extractRawPermissions(payload: Record<string, unknown>): string[];
}

export class DefaultPermissionResolver implements PermissionResolver {
  extractRawPermissions(payload: Record<string, unknown>): string[] {
    const perms = payload.permissions;
    if (!perms) return [];
    if (typeof perms === 'object' && !Array.isArray(perms)) return [];
    if (!Array.isArray(perms)) return perms ? [String(perms)] : [];
    return perms.map(String);
  }
}

export class OidcPermissionResolver implements PermissionResolver {
  extractRawPermissions(payload: Record<string, unknown>): string[] {
    const perms = payload.permissions;
    const list: string[] = [];

    if (Array.isArray(perms)) {
      list.push(...perms.map(String));
    } else if (typeof perms === 'string') {
      list.push(perms);
    }

    const resourceAccess = payload.resource_access;
    if (resourceAccess && typeof resourceAccess === 'object') {
      for (const info of Object.values(
        resourceAccess as Record<string, unknown>,
      )) {
        if (!info || typeof info !== 'object') continue;
        const roles = (info as Record<string, unknown>).roles;
        if (Array.isArray(roles)) list.push(...roles.map(String));
        else if (roles) list.push(String(roles));
      }
    }

    const realmAccess = payload.realm_access;
    if (realmAccess && typeof realmAccess === 'object') {
      const roles = (realmAccess as Record<string, unknown>).roles;
      if (Array.isArray(roles)) list.push(...roles.map(String));
      else if (roles) list.push(String(roles));
    }

    return list;
  }
}

// ── Permission Matching ─────────────────────────────────────────────

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

function buildPermissionCandidates(action: string, scope: string): Set<string> {
  return new Set([`${action}.${scope}`, `${action}.*`, `*.${scope}`, '*.*']);
}

function buildRequiredPermission(
  path: string,
  method: string,
): { resource: string; action: string; scope: string } | null {
  if (!path.startsWith('/api/v1/')) return null;
  const parts = path.replace(/\/$/, '').split('/').filter(Boolean);
  if (parts.length < 3) return null;

  const resource = normalizeResource(parts[2]);
  const action = METHOD_ACTION_MAP[method];
  if (!action) return null;

  let scope: string;
  if (method === 'GET') {
    scope = parts.length >= 4 ? 'one' : 'all';
  } else {
    scope = 'one';
  }

  return { resource, action, scope };
}

function extractPermissions(
  payload: Record<string, unknown>,
  resolver: PermissionResolver,
): { permissions: string[]; permissionsMap: Record<string, string[]> } {
  const raw = resolver.extractRawPermissions(payload);
  const permissions = raw.map(normalizePermission).filter(Boolean);

  let mapSource =
    (payload.permissions_map as Record<string, unknown>) ??
    (payload.permissions_by_resource as Record<string, unknown>) ??
    null;
  if (
    !mapSource &&
    typeof payload.permissions === 'object' &&
    !Array.isArray(payload.permissions)
  ) {
    mapSource = payload.permissions as Record<string, unknown>;
  }

  const permissionsMap: Record<string, string[]> = {};
  if (mapSource && typeof mapSource === 'object') {
    for (const [resource, methods] of Object.entries(mapSource)) {
      const key = normalizeResource(resource);
      if (Array.isArray(methods)) {
        permissionsMap[key] = methods.map((m) =>
          String(m).trim().toLowerCase(),
        );
      }
    }
  }

  return { permissions, permissionsMap };
}

function hasPermission(
  resource: string,
  candidates: Set<string>,
  permissions: string[],
  permissionsMap: Record<string, string[]>,
): boolean {
  const nr = normalizeResource(resource);

  const specific = permissionsMap[nr] ?? [];
  const wildcard = permissionsMap['*'] ?? [];
  if (
    specific.includes('*') ||
    wildcard.includes('*') ||
    specific.some((m) => candidates.has(m)) ||
    wildcard.some((m) => candidates.has(m))
  ) {
    return true;
  }

  const expected = [...candidates].map((c) => `${nr}:${c}`);
  return permissions.some((userPerm) => {
    if (!SAFE_PERMISSION_RE.test(userPerm)) return false;
    return expected.some((exp) => fnmatch(exp, userPerm));
  });
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

// ── Scope Filters ───────────────────────────────────────────────────

export async function computeScopeFilters(
  _user: Record<string, unknown> | undefined,
  _tableName: string,
  _columnNames: Set<string>,
): Promise<Record<string, unknown> | null> {
  return null;
}

// ── Plugin ──────────────────────────────────────────────────────────

function createResolver(): PermissionResolver {
  const provider = process.env.JWT_PROVIDER ?? 'shared_secret';
  if (provider === 'oidc') return new OidcPermissionResolver();
  return new DefaultPermissionResolver();
}

export default fp(async (fastify) => {
  const resolver = createResolver();

  fastify.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const url = request.url.split('?')[0];

      if (request.routeOptions.config?.public || isPublicPath(url)) return;
      if (isAuthnOnlyPath(url)) return;

      const required = buildRequiredPermission(url, request.method);
      if (!required) {
        if (url.startsWith('/api/v1/')) {
          return reply.status(405).send({ detail: 'Method not allowed' });
        }
        return;
      }

      const user = request.authUser;
      if (!user) {
        return reply.status(401).send({ detail: 'Authentication required' });
      }

      const payload = (user as Record<string, unknown>) ?? {};
      const { permissions, permissionsMap } = extractPermissions(
        payload,
        resolver,
      );
      const candidates = buildPermissionCandidates(
        required.action,
        required.scope,
      );

      if (
        !hasPermission(
          required.resource,
          candidates,
          permissions,
          permissionsMap,
        )
      ) {
        return reply.status(403).send({
          detail: `Insufficient permissions: ${required.resource}:${required.action}.${required.scope} required`,
        });
      }
    },
  );
});
