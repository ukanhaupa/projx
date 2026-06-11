import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'test-secret-12345-67890-abcdef';

const stub = vi.hoisted(() => ({
  config: {
    JWT_SECRET: 'test-secret-12345-67890-abcdef' as string | undefined,
  },
}));

vi.mock('../../src/config.js', () => ({
  config: stub.config,
  allowedOrigins: () => [],
}));

const { authenticate, requireAuth } =
  await import('../../src/middlewares/authenticate.js');
const { errorHandler, notFoundHandler } = await import('../../src/errors.js');

function buildApp(includeProtected = false) {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.get('/me', (req, res) => {
    res.json({ user: req.authUser ?? null });
  });
  if (includeProtected) {
    app.get('/protected', requireAuth, (req, res) => {
      res.json({ user: req.authUser });
    });
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function signToken(
  payload: Record<string, unknown>,
  options: jwt.SignOptions = {},
): string {
  return jwt.sign(payload, SECRET, options);
}

describe('authenticate middleware', () => {
  beforeEach(() => {
    stub.config.JWT_SECRET = SECRET;
  });

  it('does nothing when Authorization header is missing', async () => {
    const res = await request(buildApp()).get('/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it('ignores non-bearer authorization schemes', async () => {
    const res = await request(buildApp())
      .get('/me')
      .set('Authorization', 'Basic abc');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it('ignores a bearer header with no token value', async () => {
    const res = await request(buildApp())
      .get('/me')
      .set('Authorization', 'Bearer ');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it('attaches authUser when a valid bearer token is supplied', async () => {
    const token = signToken({
      sub: 'user-1',
      email: 'a@b.co',
      role: 'admin',
      permissions: ['users:read.all', 'users:create.one'],
      sid: 'session-1',
    });

    const res = await request(buildApp())
      .get('/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      sub: 'user-1',
      email: 'a@b.co',
      role: 'admin',
      permissions: ['users:read.all', 'users:create.one'],
      sid: 'session-1',
    });
  });

  it('errors with 401 when the token is malformed', async () => {
    const res = await request(buildApp())
      .get('/me')
      .set('Authorization', 'Bearer not-a-jwt');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_token');
  });

  it('errors with 401 when the token is signed with a different secret', async () => {
    const token = jwt.sign({ sub: 'user-1' }, 'different-secret');

    const res = await request(buildApp())
      .get('/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_token');
  });

  it('errors with 401 when the token is expired', async () => {
    const token = signToken({ sub: 'user-1' }, { expiresIn: -1 });

    const res = await request(buildApp())
      .get('/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_token');
  });

  it('errors with 401 when the payload has no sub', async () => {
    const token = jwt.sign({ email: 'a@b.co' }, SECRET);

    const res = await request(buildApp())
      .get('/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_token');
  });

  it('defaults missing email, role, and permissions to safe values', async () => {
    const token = signToken({ sub: 'user-1' });

    const res = await request(buildApp())
      .get('/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual(
      expect.objectContaining({
        sub: 'user-1',
        email: '',
        role: '',
        permissions: [],
      }),
    );
  });

  it('coerces non-array permissions into an empty array', async () => {
    const token = signToken({ sub: 'user-1', permissions: 'not-an-array' });

    const res = await request(buildApp())
      .get('/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.permissions).toEqual([]);
  });
});

describe('requireAuth middleware', () => {
  beforeEach(() => {
    stub.config.JWT_SECRET = SECRET;
  });

  it('returns 401 when authUser is missing', async () => {
    const res = await request(buildApp(true)).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('unauthorized');
  });

  it('passes through when authUser is set', async () => {
    const token = signToken({
      sub: 'user-1',
      email: 'a@b.co',
      role: 'admin',
      permissions: [],
    });

    const res = await request(buildApp(true))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.sub).toBe('user-1');
  });
});

describe('authenticate without JWT_SECRET', () => {
  afterEach(() => {
    stub.config.JWT_SECRET = SECRET;
  });

  it('returns 500 when JWT_SECRET is unset and a token is presented', async () => {
    stub.config.JWT_SECRET = undefined;
    const token = jwt.sign({ sub: 'u' }, 'any');

    const res = await request(buildApp())
      .get('/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('jwt_not_configured');
  });
});
