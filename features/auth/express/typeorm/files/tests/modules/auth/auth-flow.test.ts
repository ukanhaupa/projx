import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { IsNull } from 'typeorm';
import { errorHandler, notFoundHandler } from '../../../src/errors.js';
import { authenticate } from '../../../src/middlewares/authenticate.js';
import { dataSource } from '../../../src/db/data-source.js';
import { RefreshToken } from '../../../src/entities/refresh-token.js';
import { User } from '../../../src/entities/user.js';
import { VerificationToken } from '../../../src/entities/verification-token.js';
import { authRouter } from '../../../src/modules/auth/routes.js';

async function buildAuthApp(): Promise<express.Express> {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }
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
  app.use('/auth', authRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('auth signup -> login -> me flow', () => {
  let app: express.Express;
  const email = `test-${Date.now()}@example.com`;
  const raceEmail = `race-${Date.now()}@example.com`;
  const graceEmail = `grace-${Date.now()}@example.com`;
  const password = 'P@ssw0rd!2025'; // pragma: allowlist secret

  beforeAll(async () => {
    app = await buildAuthApp();
    await dataSource.getRepository(RefreshToken).clear();
    await dataSource.getRepository(VerificationToken).clear();
    await dataSource.getRepository(User).delete({ email });
  });

  afterAll(async () => {
    await dataSource.getRepository(User).delete({ email });
    await dataSource.getRepository(User).delete({ email: raceEmail });
    await dataSource.getRepository(User).delete({ email: graceEmail });
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
      .set('Authorization', `Bearer ${access_token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email);
  });

  it('POST /auth/refresh rotates the refresh token', async () => {
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email, password });
    const { refresh_token: oldRefresh } = loginRes.body;

    const res = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: oldRefresh });
    expect(res.status).toBe(200);
    expect(res.body.refresh_token).toBeTruthy();
    expect(res.body.refresh_token).not.toBe(oldRefresh);
  });

  it('POST /auth/refresh detects genuine replay once the chain advanced', async () => {
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email, password });
    const t1 = loginRes.body.refresh_token as string;

    const first = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: t1 });
    expect(first.status).toBe(200);
    const t2 = first.body.refresh_token as string;

    const second = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: t2 });
    expect(second.status).toBe(200);

    const replay = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: t1 });
    expect(replay.status).toBe(401);
    expect(replay.body.detail).toBe('token_replay_detected');
  });

  it('POST /auth/refresh grants rotation grace for a lost-rotation retry', async () => {
    const signupRes = await request(app)
      .post('/auth/signup')
      .send({ email: graceEmail, name: 'Grace User', password });
    const t1 = signupRes.body.refresh_token as string;

    const first = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: t1 });
    expect(first.status).toBe(200);

    const grace = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: t1 });
    expect(grace.status).toBe(200);
    expect(grace.body.refresh_token).toBeTruthy();

    const next = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: grace.body.refresh_token });
    expect(next.status).toBe(200);

    const replayAgain = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: t1 });
    expect(replayAgain.status).toBe(401);
  });

  it('POST /auth/refresh recovers concurrent rotations of one token', async () => {
    const signupRes = await request(app)
      .post('/auth/signup')
      .send({ email: raceEmail, name: 'Race User', password });
    const refreshToken = signupRes.body.refresh_token as string;
    const userId = signupRes.body.user.id as string;

    const attempts = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app)
          .post('/auth/refresh')
          .send({ refresh_token: refreshToken }),
      ),
    );

    const winners = attempts.filter((r) => r.status === 200);
    expect(winners.length).toBeGreaterThanOrEqual(1);

    const heads = await dataSource.getRepository(RefreshToken).find({
      where: {
        user_id: userId,
        rotated_to: IsNull(),
        revoked_at: IsNull(),
        replay_detected_at: IsNull(),
      },
    });
    expect(heads).toHaveLength(1);
  });
});
