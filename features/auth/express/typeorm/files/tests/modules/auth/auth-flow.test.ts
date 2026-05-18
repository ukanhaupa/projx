import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
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
  const password = 'P@ssw0rd!2025'; // pragma: allowlist secret

  beforeAll(async () => {
    app = await buildAuthApp();
    await dataSource.getRepository(RefreshToken).clear();
    await dataSource.getRepository(VerificationToken).clear();
    await dataSource.getRepository(User).delete({ email });
  });

  afterAll(async () => {
    await dataSource.getRepository(User).delete({ email });
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

  it('POST /auth/refresh detects replay of revoked token', async () => {
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email, password });
    const { refresh_token } = loginRes.body;

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
});
