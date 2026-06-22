import crypto from 'node:crypto';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticate } from '../../../src/middlewares/authenticate.js';
import { errorHandler, notFoundHandler } from '../../../src/errors.js';
import { authRouter } from '../../../src/modules/auth/routes.js';
import { sequelize } from '../../../src/db/client.js';
import { User } from '../../../src/models/user.js';
import { RefreshToken } from '../../../src/models/refresh-token.js';
import { VerificationToken } from '../../../src/models/verification-token.js';

const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const value =
    typeof incoming === 'string' && incoming.trim()
      ? incoming
      : crypto.randomUUID();
  res.locals.requestId = value;
  res.setHeader('x-request-id', value);
  next();
};

function buildAuthApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.locals.sequelize = sequelize;
  app.use(requestId);
  app.use(express.json());
  app.use(authenticate);
  app.use('/auth', authRouter(sequelize));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('auth signup -> login -> me flow', () => {
  let app: express.Express;
  const email = `test-${Date.now()}@example.com`;
  const raceEmail = `race-${Date.now()}@example.com`;
  const password = 'P@ssw0rd!2025'; // pragma: allowlist secret

  beforeAll(async () => {
    await sequelize.sync();
    await RefreshToken.destroy({ where: {}, truncate: true, cascade: true });
    await VerificationToken.destroy({
      where: {},
      truncate: true,
      cascade: true,
    });
    await User.destroy({ where: { email } });
    app = buildAuthApp();
  });

  afterAll(async () => {
    await User.destroy({ where: { email } });
    await User.destroy({ where: { email: raceEmail } });
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
    const accessToken = loginRes.body.access_token as string;

    const res = await request(app)
      .get('/auth/me')
      .set('authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email);
  });

  it('POST /auth/refresh rotates the refresh token', async () => {
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email, password });
    const oldRefresh = loginRes.body.refresh_token as string;

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
    const refreshToken = loginRes.body.refresh_token as string;

    const first = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: refreshToken });
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: refreshToken });
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
