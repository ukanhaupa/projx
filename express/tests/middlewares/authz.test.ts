import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../../src/middlewares/authenticate.js';
import { errorHandler, notFoundHandler } from '../../src/errors.js';
import {
  computeScopeFilters,
  requirePermission,
} from '../../src/middlewares/authz.js';
import type { EntityConfig } from '../../src/modules/_base/entity-registry.js';

function buildApp(permission: string, user: AuthUser | undefined) {
  const app = express();
  app.use((req, _res, next) => {
    req.authUser = user;
    next();
  });
  app.get('/widgets', requirePermission(permission), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function user(permissions: string[]): AuthUser {
  return {
    sub: 'u1',
    email: 'a@b.co',
    role: 'admin',
    permissions,
  };
}

describe('requirePermission', () => {
  it('returns 401 when no authUser is attached', async () => {
    const res = await request(buildApp('widgets:read.all', undefined)).get(
      '/widgets',
    );
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('unauthorized');
  });

  it('allows when the exact permission is granted', async () => {
    const res = await request(
      buildApp('widgets:read.all', user(['widgets:read.all'])),
    ).get('/widgets');
    expect(res.status).toBe(200);
  });

  it('allows when a resource wildcard matches the action', async () => {
    const res = await request(
      buildApp('widgets:read.all', user(['widgets:read.*'])),
    ).get('/widgets');
    expect(res.status).toBe(200);
  });

  it('allows when the global wildcard is granted', async () => {
    const res = await request(buildApp('widgets:read.all', user(['*']))).get(
      '/widgets',
    );
    expect(res.status).toBe(200);
  });

  it('allows when the full-wildcard `*:*.*` is granted', async () => {
    const res = await request(
      buildApp('widgets:read.all', user(['*:*.*'])),
    ).get('/widgets');
    expect(res.status).toBe(200);
  });

  it('rejects when the user lacks the permission', async () => {
    const res = await request(
      buildApp('widgets:update.one', user(['widgets:read.all'])),
    ).get('/widgets');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  it('rejects permissions with disallowed characters', async () => {
    const res = await request(
      buildApp('widgets:read.all', user(['widgets:read.all<script>'])),
    ).get('/widgets');
    expect(res.status).toBe(403);
  });

  it('treats missing permissions array as empty', async () => {
    const noPerms = { sub: 'u', email: '', role: '', permissions: [] };
    const res = await request(buildApp('widgets:read.all', noPerms)).get(
      '/widgets',
    );
    expect(res.status).toBe(403);
  });
});

describe('computeScopeFilters', () => {
  it('returns null by default (no scoping applied)', () => {
    const req = { authUser: user(['*']) } as unknown as express.Request;
    const cfg = { tableName: 'widgets' } as unknown as EntityConfig;
    expect(computeScopeFilters(req, cfg)).toBeNull();
  });

  it('returns null when no user is present', () => {
    const req = {} as unknown as express.Request;
    const cfg = { tableName: 'widgets' } as unknown as EntityConfig;
    expect(computeScopeFilters(req, cfg)).toBeNull();
  });
});
