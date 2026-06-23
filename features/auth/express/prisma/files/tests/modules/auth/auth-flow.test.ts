import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'test-secret-12345-67890-abcdef-09876';
const ENC_KEY = Buffer.alloc(32, 7).toString('base64');

const stub = vi.hoisted(() => ({
  config: {
    JWT_SECRET: 'test-secret-12345-67890-abcdef-09876' as string | undefined,
    CRED_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') as
      | string
      | undefined,
    NODE_ENV: 'test' as string,
  },
}));

vi.mock('../../../src/config.js', () => ({
  config: stub.config,
  allowedOrigins: () => [],
}));

const { authRouter } = await import('../../../src/modules/auth/index.js');
const { errorHandler, notFoundHandler } =
  await import('../../../src/errors.js');
const { authenticate } =
  await import('../../../src/middlewares/authenticate.js');

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  role: string;
  email_verified: boolean;
  failed_login_count: number;
  locked_until: Date | null;
  mfa_enabled: boolean;
  mfa_secret_enc: string | null;
  mfa_recovery_codes_enc: string | null;
  mfa_verified_at: Date | null;
  mfa_failed_count: number;
  mfa_locked_until: Date | null;
  last_login: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  session_id: string;
  token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  rotated_to: string | null;
  replay_detected_at: Date | null;
  created_at: Date;
}

interface VerificationTokenRow {
  id: string;
  user_id: string;
  kind: string;
  token_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

function newUser(overrides: Partial<UserRow> = {}): UserRow {
  const now = new Date();
  return {
    id: `user-${Math.random().toString(36).slice(2, 10)}`,
    email: 'placeholder@example.com',
    name: 'Test User',
    password_hash: null,
    role: 'user',
    email_verified: false,
    failed_login_count: 0,
    locked_until: null,
    mfa_enabled: false,
    mfa_secret_enc: null,
    mfa_recovery_codes_enc: null,
    mfa_verified_at: null,
    mfa_failed_count: 0,
    mfa_locked_until: null,
    last_login: null,
    deleted_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeMockPrisma() {
  const users = new Map<string, UserRow>();
  const refreshTokens = new Map<string, RefreshTokenRow>();
  const verificationTokens = new Map<string, VerificationTokenRow>();

  function userMatches(user: UserRow, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (v === null) {
        if ((user as unknown as Record<string, unknown>)[k] !== null)
          return false;
      } else if ((user as unknown as Record<string, unknown>)[k] !== v) {
        return false;
      }
    }
    return true;
  }

  function evalCondition(value: unknown, condition: unknown): boolean {
    if (
      condition !== null &&
      typeof condition === 'object' &&
      !Array.isArray(condition)
    ) {
      const cond = condition as Record<string, unknown>;
      if ('gt' in cond) {
        return (
          value instanceof Date && value.getTime() > (cond.gt as Date).getTime()
        );
      }
      if ('lt' in cond) {
        return (
          value instanceof Date && value.getTime() < (cond.lt as Date).getTime()
        );
      }
      if ('not' in cond) {
        return value !== cond.not;
      }
    }
    return value === condition;
  }

  function tokenMatches(
    row: VerificationTokenRow,
    where: Record<string, unknown>,
  ): boolean {
    for (const [k, v] of Object.entries(where)) {
      const value = (row as unknown as Record<string, unknown>)[k];
      if (!evalCondition(value, v)) return false;
    }
    return true;
  }

  const prisma = {
    user: {
      findUnique: vi.fn(async (args: { where: Record<string, unknown> }) => {
        for (const u of users.values()) {
          if (userMatches(u, args.where)) return { ...u };
        }
        return null;
      }),
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        for (const u of users.values()) {
          if (userMatches(u, args.where)) return { ...u };
        }
        return null;
      }),
      count: vi.fn(async () => users.size),
      create: vi.fn(async (args: { data: Partial<UserRow> }) => {
        const row = newUser({ ...args.data, id: args.data.id ?? randomId() });
        users.set(row.id, row);
        return { ...row };
      }),
      update: vi.fn(
        async (args: { where: { id: string }; data: Partial<UserRow> }) => {
          const existing = users.get(args.where.id);
          if (!existing) throw new Error('user not found');
          const next: UserRow = {
            ...existing,
            ...args.data,
            updated_at: new Date(),
          };
          users.set(args.where.id, next);
          return { ...next };
        },
      ),
    },
    refreshToken: {
      create: vi.fn(async (args: { data: Partial<RefreshTokenRow> }) => {
        const row: RefreshTokenRow = {
          id: randomId(),
          user_id: args.data.user_id!,
          session_id: args.data.session_id!,
          token_hash: args.data.token_hash!,
          ip_address: args.data.ip_address ?? null,
          user_agent: args.data.user_agent ?? null,
          expires_at: args.data.expires_at!,
          revoked_at: args.data.revoked_at ?? null,
          rotated_to: args.data.rotated_to ?? null,
          replay_detected_at: args.data.replay_detected_at ?? null,
          created_at: new Date(),
        };
        refreshTokens.set(row.id, row);
        return { ...row };
      }),
      findUnique: vi.fn(
        async (args: { where: { token_hash: string } | { id: string } }) => {
          if ('id' in args.where) {
            const byId = refreshTokens.get(args.where.id);
            return byId ? { ...byId } : null;
          }
          for (const t of refreshTokens.values()) {
            if (t.token_hash === args.where.token_hash) return { ...t };
          }
          return null;
        },
      ),
      findMany: vi.fn(
        async (args: {
          where: { user_id: string; revoked_at: null };
          orderBy: { created_at: 'desc' };
          distinct: ['session_id'];
        }) => {
          const filtered = [...refreshTokens.values()]
            .filter(
              (t) => t.user_id === args.where.user_id && t.revoked_at === null,
            )
            .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
          const seen = new Set<string>();
          const out: RefreshTokenRow[] = [];
          for (const t of filtered) {
            if (seen.has(t.session_id)) continue;
            seen.add(t.session_id);
            out.push({ ...t });
          }
          return out;
        },
      ),
      updateMany: vi.fn(
        async (args: {
          where: Partial<RefreshTokenRow> & { NOT?: { session_id: string } };
          data: { revoked_at: Date };
        }) => {
          let count = 0;
          for (const t of refreshTokens.values()) {
            if (args.where.id !== undefined && t.id !== args.where.id) continue;
            if (
              args.where.user_id !== undefined &&
              t.user_id !== args.where.user_id
            )
              continue;
            if (
              args.where.session_id !== undefined &&
              t.session_id !== args.where.session_id
            )
              continue;
            if (args.where.revoked_at === null && t.revoked_at !== null)
              continue;
            if (args.where.rotated_to === null && t.rotated_to !== null)
              continue;
            if (args.where.NOT && t.session_id === args.where.NOT.session_id)
              continue;
            t.revoked_at = args.data.revoked_at;
            count += 1;
          }
          return { count };
        },
      ),
      update: vi.fn(
        async (args: {
          where: { id: string };
          data: Partial<RefreshTokenRow>;
        }) => {
          const existing = refreshTokens.get(args.where.id);
          if (!existing) throw new Error('refresh token not found');
          const next = { ...existing, ...args.data };
          refreshTokens.set(args.where.id, next);
          return { ...next };
        },
      ),
    },
    verificationToken: {
      create: vi.fn(async (args: { data: Partial<VerificationTokenRow> }) => {
        const row: VerificationTokenRow = {
          id: randomId(),
          user_id: args.data.user_id!,
          kind: args.data.kind!,
          token_hash: args.data.token_hash!,
          expires_at: args.data.expires_at!,
          consumed_at: args.data.consumed_at ?? null,
          created_at: new Date(),
        };
        verificationTokens.set(row.id, row);
        return { ...row };
      }),
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        for (const t of verificationTokens.values()) {
          if (tokenMatches(t, args.where)) return { ...t };
        }
        return null;
      }),
      update: vi.fn(
        async (args: {
          where: { id: string };
          data: Partial<VerificationTokenRow>;
        }) => {
          const existing = verificationTokens.get(args.where.id);
          if (!existing) throw new Error('verification token not found');
          const next = { ...existing, ...args.data };
          verificationTokens.set(args.where.id, next);
          return { ...next };
        },
      ),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    _state: { users, refreshTokens, verificationTokens },
  };
  return prisma;
}

function randomId(): string {
  return `id-${Math.random().toString(36).slice(2, 14)}`;
}

type MockPrisma = ReturnType<typeof makeMockPrisma>;

function buildAuthApp(prisma: MockPrisma) {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  app.use('/auth', authRouter(prisma));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('auth signup -> login -> me flow', () => {
  const email = 'flow@example.com';
  const password = 'P@ssw0rd!2025'; // pragma: allowlist secret
  let app: express.Express;
  let prisma: MockPrisma;

  beforeEach(() => {
    stub.config.JWT_SECRET = SECRET;
    stub.config.CRED_ENCRYPTION_KEY = ENC_KEY;
    prisma = makeMockPrisma();
    app = buildAuthApp(prisma);
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
    await request(app)
      .post('/auth/signup')
      .send({ email, name: 'Test User', password });

    const res = await request(app)
      .post('/auth/login')
      .send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();
    expect(res.body.user.email).toBe(email);
  });

  it('POST /auth/login rejects wrong password with request_id', async () => {
    await request(app)
      .post('/auth/signup')
      .send({ email, name: 'Test User', password });

    const res = await request(app)
      .post('/auth/login')
      .set('x-request-id', 'req-test-1')
      .send({ email, password: 'wrong-password' }); // pragma: allowlist secret

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_credentials');
    expect(res.body.detail).toBe('Invalid credentials');
  });

  it('GET /auth/me returns current user', async () => {
    await request(app)
      .post('/auth/signup')
      .send({ email, name: 'Test User', password });

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
    await request(app)
      .post('/auth/signup')
      .send({ email, name: 'Test User', password });

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
    await request(app)
      .post('/auth/signup')
      .send({ email, name: 'Test User', password });

    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email, password });
    const { refresh_token: t1 } = loginRes.body;

    const first = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: t1 });
    expect(first.status).toBe(200);
    const { refresh_token: t2 } = first.body;

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
    await request(app)
      .post('/auth/signup')
      .send({ email, name: 'Test User', password });

    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email, password });
    const { refresh_token: t1 } = loginRes.body;

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
    await request(app)
      .post('/auth/signup')
      .send({ email, name: 'Test User', password });

    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email, password });
    const { refresh_token } = loginRes.body;

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app).post('/auth/refresh').send({ refresh_token }),
      ),
    );

    const winners = attempts.filter((r) => r.status === 200);
    expect(winners.length).toBeGreaterThanOrEqual(1);

    const heads = [...prisma._state.refreshTokens.values()].filter(
      (t) =>
        t.rotated_to === null &&
        t.revoked_at === null &&
        t.replay_detected_at === null,
    );
    expect(heads).toHaveLength(1);
  });

  it('POST /auth/logout revokes the current session', async () => {
    await request(app)
      .post('/auth/signup')
      .send({ email, name: 'Test User', password });

    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email, password });
    const { access_token } = loginRes.body;

    const res = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${access_token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('POST /auth/change-password requires current password', async () => {
    await request(app)
      .post('/auth/signup')
      .send({ email, name: 'Test User', password });
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email, password });
    const { access_token } = loginRes.body;

    const fail = await request(app)
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${access_token}`)
      .send({ current_password: 'wrong', new_password: 'N3wP@ssword!' }); // pragma: allowlist secret
    expect(fail.status).toBe(400);
    expect(fail.body.code).toBe('invalid_password');

    const ok = await request(app)
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${access_token}`)
      .send({ current_password: password, new_password: 'N3wP@ssword!' }); // pragma: allowlist secret
    expect(ok.status).toBe(200);
  });

  it('POST /auth/forgot-password is silent for unknown email', async () => {
    const res = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'unknown@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If the account exists/);
  });

  it('POST /auth/reset-password rejects invalid token', async () => {
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token: 'invalid', new_password: 'N3wP@ssword!' }); // pragma: allowlist secret
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_reset_token');
  });

  it('POST /auth/verify-email rejects invalid token', async () => {
    const res = await request(app)
      .post('/auth/verify-email')
      .send({ token: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_verification_token');
  });

  it('POST /auth/resend-verification returns 202 even for unknown email', async () => {
    const res = await request(app)
      .post('/auth/resend-verification')
      .send({ email: 'unknown@example.com' });
    expect(res.status).toBe(202);
    expect(res.body.sent).toBe(true);
  });

  it('GET /auth/sessions lists active sessions', async () => {
    await request(app)
      .post('/auth/signup')
      .send({ email, name: 'Test User', password });
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email, password });
    const { access_token } = loginRes.body;

    const res = await request(app)
      .get('/auth/sessions')
      .set('Authorization', `Bearer ${access_token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('POST /auth/signup rejects duplicate email', async () => {
    await request(app)
      .post('/auth/signup')
      .send({ email, name: 'Test User', password });
    const dup = await request(app)
      .post('/auth/signup')
      .send({ email, name: 'Other', password });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('duplicate_email');
  });
});

describe('mfa enrollment', () => {
  const email = 'mfa@example.com';
  const password = 'P@ssw0rd!2025'; // pragma: allowlist secret
  let app: express.Express;
  let prisma: MockPrisma;

  beforeEach(() => {
    stub.config.JWT_SECRET = SECRET;
    stub.config.CRED_ENCRYPTION_KEY = ENC_KEY;
    prisma = makeMockPrisma();
    app = buildAuthApp(prisma);
  });

  it('starts MFA enrollment and returns secret + otpauth url', async () => {
    await request(app)
      .post('/auth/signup')
      .send({ email, name: 'Test User', password });
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email, password });
    const { access_token } = loginRes.body;

    const res = await request(app)
      .post('/auth/mfa/enroll')
      .set('Authorization', `Bearer ${access_token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.secret).toBeTruthy();
    expect(res.body.otpauth_url).toMatch(/^otpauth:\/\/totp/);
  });
});
