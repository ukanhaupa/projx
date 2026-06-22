import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../../src/db/client.js';
import {
  refreshTokens,
  users,
  verificationTokens,
} from '../../../src/db/schema.js';
import { authenticate } from '../../../src/middlewares/authenticate.js';
import { errorHandler, notFoundHandler } from '../../../src/errors.js';
import { authRouter } from '../../../src/modules/auth/routes.js';

function buildAuthApp(): express.Express {
  const app = express();
  app.use((req, res, next) => {
    const incoming = req.headers['x-request-id'];
    const value =
      typeof incoming === 'string' && incoming.trim()
        ? incoming
        : crypto.randomUUID();
    res.locals.requestId = value;
    res.setHeader('x-request-id', value);
    next();
  });
  app.use(express.json());
  app.use(authenticate);
  app.use('/auth', authRouter(db));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('auth signup -> login -> me flow (express+drizzle)', () => {
  let app: express.Express;
  const email = `test-${Date.now()}@example.com`;
  const raceEmail = `race-${Date.now()}@example.com`;
  const password = 'P@ssw0rd!2025'; // pragma: allowlist secret

  beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';
    }
    process.env.AUTH_PUBLIC_RATE_LIMIT_MAX = '1000';
    app = buildAuthApp();
    await db.delete(refreshTokens);
    await db.delete(verificationTokens);
    await db.delete(users).where(eq(users.email, email));
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.email, email));
    await db.delete(users).where(eq(users.email, raceEmail));
  });

  it('POST /auth/signup creates a user', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ email, name: 'Test User', password });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();
  });

  it('POST /auth/login returns tokens', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();
    expect(res.body.user.email).toBe(email);
  });

  it('POST /auth/login rejects wrong password with request_id', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email, password: 'wrong-password' }); // pragma: allowlist secret
    expect(res.status).toBe(401);
    expect(res.body.detail).toBe('Invalid credentials');
    expect(res.body.request_id).toBeTruthy();
  });

  it('GET /auth/me returns current user', async () => {
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email, password });
    const { access_token } = loginRes.body;

    const res = await request(app)
      .get('/auth/me')
      .set('authorization', `Bearer ${access_token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email);
  });

  it('POST /auth/refresh rotates the refresh token', async () => {
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email, password });
    const oldRefresh = loginRes.body.refresh_token;

    const res = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: oldRefresh });
    expect(res.status).toBe(200);
    expect(res.body.refresh_token).toBeTruthy();
    expect(res.body.refresh_token).not.toBe(oldRefresh);
  });

  it('POST /auth/refresh detects replay of revoked token', async () => {
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email, password });
    const refresh_token = loginRes.body.refresh_token;

    const first = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token });
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token });
    expect(replay.status).toBe(401);
    expect(replay.body.detail).toBe('token_replay_detected');
  });

  it('POST /auth/refresh lets exactly one concurrent rotation win', async () => {
    const signupRes = await request(app)
      .post('/auth/signup')
      .send({ email: raceEmail, name: 'Race User', password });
    const refreshToken = signupRes.body.refresh_token as string;

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app)
          .post('/auth/refresh')
          .send({ refresh_token: refreshToken }),
      ),
    );

    const winners = attempts.filter((r) => r.status === 200);
    const losers = attempts.filter((r) => r.status === 401);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(attempts.length - 1);
    for (const loser of losers) {
      expect(loser.body.detail).toBe('token_replay_detected');
    }
  });
});
