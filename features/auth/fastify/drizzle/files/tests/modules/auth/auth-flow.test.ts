import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../../src/db/client.js';
import {
  refreshTokens,
  users,
  verificationTokens,
} from '../../../src/db/schema.js';
import errorHandler from '../../../src/plugins/error-handler.js';
import authPlugin from '../../../src/plugins/auth.js';
import requestIdPlugin from '../../../src/plugins/request-id.js';
import { authRoutes } from '../../../src/modules/auth/index.js';

async function buildAuthApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    genReqId: (req) =>
      (req.headers['x-request-id'] as string) || crypto.randomUUID(),
  });
  app.decorate('db', db);
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' });
  await app.register(errorHandler);
  await app.register(requestIdPlugin);
  await app.register(authPlugin);
  await app.register(authRoutes);
  return app;
}

describe('auth signup → login → me flow', () => {
  let app: FastifyInstance;
  const email = `test-${Date.now()}@example.com`;
  const raceEmail = `race-${Date.now()}@example.com`;
  const graceEmail = `grace-${Date.now()}@example.com`;
  const password = 'P@ssw0rd!2025'; // pragma: allowlist secret

  beforeAll(async () => {
    app = await buildAuthApp();
    await app.db.delete(refreshTokens);
    await app.db.delete(verificationTokens);
    await app.db.delete(users).where(eq(users.email, email));
  });

  afterAll(async () => {
    await app.db.delete(users).where(eq(users.email, email));
    await app.db.delete(users).where(eq(users.email, raceEmail));
    await app.db.delete(users).where(eq(users.email, graceEmail));
    await app.close();
  });

  it('POST /auth/signup creates a user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email, name: 'Test User', password },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe(email);
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
  });

  it('POST /auth/login returns tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
    expect(body.user.email).toBe(email);
  });

  it('POST /auth/login rejects wrong password with request_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'wrong-password' }, // pragma: allowlist secret
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.detail).toBe('Invalid credentials');
    expect(body.request_id).toBeTruthy();
  });

  it('GET /auth/me returns current user', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    const { access_token } = loginRes.json();

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${access_token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.email).toBe(email);
  });

  it('POST /auth/refresh rotates the refresh token', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    const { refresh_token: oldRefresh } = loginRes.json();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: oldRefresh },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.refresh_token).toBeTruthy();
    expect(body.refresh_token).not.toBe(oldRefresh);
  });

  it('POST /auth/refresh detects genuine replay once the chain advanced', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    const { refresh_token: t1 } = loginRes.json();

    const first = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: t1 },
    });
    expect(first.statusCode).toBe(200);
    const { refresh_token: t2 } = first.json();

    const second = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: t2 },
    });
    expect(second.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: t1 },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().detail).toBe('token_replay_detected');
  });

  it('POST /auth/refresh grants rotation grace for a lost-rotation retry', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: graceEmail, name: 'Grace User', password },
    });
    const { refresh_token: t1 } = signupRes.json();

    const first = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: t1 },
    });
    expect(first.statusCode).toBe(200);

    const grace = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: t1 },
    });
    expect(grace.statusCode).toBe(200);
    expect(grace.json().refresh_token).toBeTruthy();

    const next = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: grace.json().refresh_token },
    });
    expect(next.statusCode).toBe(200);

    const replayAgain = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: t1 },
    });
    expect(replayAgain.statusCode).toBe(401);
  });

  it('POST /auth/refresh recovers concurrent rotations of one token', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: raceEmail, name: 'Race User', password },
    });
    const { refresh_token } = signupRes.json();
    const userId = signupRes.json().user.id as string;

    const attempts = await Promise.all(
      Array.from({ length: 2 }, () =>
        app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { refresh_token },
        }),
      ),
    );

    const winners = attempts.filter((r) => r.statusCode === 200);
    expect(winners.length).toBeGreaterThanOrEqual(1);

    const heads = await app.db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.user_id, userId),
          isNull(refreshTokens.rotated_to),
          isNull(refreshTokens.revoked_at),
          isNull(refreshTokens.replay_detected_at),
        ),
      );
    expect(heads).toHaveLength(1);
  });
});
