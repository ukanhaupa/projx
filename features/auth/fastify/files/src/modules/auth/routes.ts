import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import fp from 'fastify-plugin';
import { Type } from '@sinclair/typebox';
import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword, hashToken } from './password.js';
import {
  buildResetLink,
  buildVerificationLink,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from './mailer.js';
import {
  buildOtpauthUrl,
  decryptRecoveryCodes,
  decryptSecret,
  encryptRecoveryCodes,
  encryptSecret,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCodes,
  isMfaLocked,
  matchRecoveryCode,
  MFA_LOCKOUT_MS,
  MFA_MAX_ATTEMPTS,
  verifyTotp,
} from './mfa.js';
import { sendInitialVerificationEmail } from './verification-jobs.js';
import {
  hashRefreshToken,
  issueAuthSession,
  permissionsForRole,
  REFRESH_TTL_SECONDS,
  signTokens,
} from './session.js';

const RESET_TOKEN_TTL_SECONDS = 30 * 60;
const VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const MFA_CHALLENGE_TTL = '5m';
const PUBLIC_RATE_LIMIT = { max: 5, timeWindow: '1 minute' } as const;

interface MfaChallengePayload {
  sub: string;
  stage: 'mfa_pending';
}

interface RefreshTokenPayload {
  sub?: string;
  role?: string;
  sid?: string;
  jti?: string;
  email?: string;
  permissions?: string[];
  token_type?: string;
}

function err(
  reply: FastifyReply,
  request: FastifyRequest,
  code: number,
  detail: string,
  extra?: Record<string, unknown>,
): FastifyReply {
  return reply.status(code).send({ detail, request_id: request.id, ...extra });
}

function signMfaChallenge(fastify: FastifyInstance, user: User): string {
  return fastify.jwt.sign(
    { sub: user.id, stage: 'mfa_pending' },
    { expiresIn: MFA_CHALLENGE_TTL },
  );
}

async function recordMfaFailure(fastify: FastifyInstance, user: User): Promise<void> {
  const nextCount = user.mfa_failed_count + 1;
  const data: { mfa_failed_count: number; mfa_locked_until?: Date } = {
    mfa_failed_count: nextCount,
  };
  if (nextCount >= MFA_MAX_ATTEMPTS) {
    data.mfa_locked_until = new Date(Date.now() + MFA_LOCKOUT_MS);
  }
  await fastify.prisma.user.update({ where: { id: user.id }, data });
}

async function resetMfaCounters(fastify: FastifyInstance, userId: string): Promise<void> {
  await fastify.prisma.user.update({
    where: { id: userId },
    data: { mfa_failed_count: 0, mfa_locked_until: null },
  });
}

export default fp(async (fastify) => {
  fastify.post('/auth/signup',
    {
      config: {
        public: true,
        rateLimit: PUBLIC_RATE_LIMIT,
      },
      schema: {
        tags: ['auth'],
        body: Type.Object({
          email: Type.String({ format: 'email' }),
          name: Type.String({ minLength: 1 }),
          password: Type.String({ minLength: 8 }),
        }),
      },
    },
    async (request, reply) => {
      const body = request.body as {
        email: string;
        name: string;
        password: string;
      };

      const existing = await fastify.prisma.user.findUnique({
        where: { email: body.email.toLowerCase() },
      });
      if (existing) {
        return err(reply, request, 409, 'An account with this email already exists.');
      }
      const passwordHash = await hashPassword(body.password);
      const isFirstUser = (await fastify.prisma.user.count()) === 0;
      const user = await fastify.prisma.user.create({
        data: {
          email: body.email.toLowerCase(),
          name: body.name,
          password_hash: passwordHash,
          role: isFirstUser ? 'admin' : 'user',
        },
      });

      const sessionId = randomUUID();
      const payload = {
        sub: user.id,
        sid: sessionId,
        role: user.role,
        email: user.email,
        name: user.name,
        permissions: [...permissionsForRole(user.role)],
      };
      const tokens = signTokens(fastify, payload);
      const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

      await fastify.prisma.refreshToken.create({
        data: {
          user_id: user.id,
          session_id: sessionId,
          token_hash: hashRefreshToken(tokens.refresh_token),
          expires_at: expiresAt,
          ip_address: request.ip,
          user_agent: request.headers['user-agent'] ?? null,
        },
      });

      try {
        await sendInitialVerificationEmail(fastify.prisma, user.id);
      } catch (e) {
        fastify.log.error(
          { err: e, userId: user.id },
          'Failed to send initial verification email',
        );
      }

      return reply.status(201).send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          last_login: user.last_login,
          created_at: user.created_at,
          updated_at: user.updated_at,
        },
        token: tokens.token,
        access_token: tokens.token,
        refresh_token: tokens.refresh_token,
      });
    },
  );

  fastify.post('/auth/login',
    {
      config: {
        public: true,
        rateLimit: PUBLIC_RATE_LIMIT,
      },
      schema: {
        tags: ['auth'],
        body: Type.Object({
          email: Type.String({ format: 'email' }),
          password: Type.String(),
        }),
      },
    },
    async (request, reply) => {
      const { email, password } = request.body as {
        email: string;
        password: string;
      };
      const normalizedEmail = email.toLowerCase();

      const user = await fastify.prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (user?.locked_until && user.locked_until.getTime() > Date.now()) {
        const mins = Math.ceil((user.locked_until.getTime() - Date.now()) / 60_000);
        return err(
          reply,
          request,
          429,
          `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
        );
      }

      if (!user || !user.password_hash) {
        return err(reply, request, 401, 'Invalid credentials');
      }

      const validPassword = await verifyPassword(password, user.password_hash);
      if (!validPassword) {
        const nextCount = user.failed_login_count + 1;
        const lockData: { failed_login_count: number; locked_until?: Date } = {
          failed_login_count: nextCount,
        };
        if (nextCount >= LOGIN_MAX_ATTEMPTS) {
          lockData.locked_until = new Date(Date.now() + LOGIN_LOCKOUT_MS);
        }
        await fastify.prisma.user.update({
          where: { id: user.id },
          data: lockData,
        });
        return err(reply, request, 401, 'Invalid credentials');
      }

      const freshUser = await fastify.prisma.user.update({
        where: { id: user.id },
        data: {
          last_login: new Date(),
          failed_login_count: 0,
          locked_until: null,
        },
      });

      if (freshUser.mfa_enabled) {
        if (isMfaLocked(freshUser.mfa_locked_until)) {
          const mins = Math.ceil((freshUser.mfa_locked_until!.getTime() - Date.now()) / 60_000);
          return err(
            reply,
            request,
            429,
            `MFA temporarily locked. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
          );
        }
        const challenge_token = signMfaChallenge(fastify, freshUser);
        return reply.send({
          mfa_required: true,
          challenge_token,
          email: freshUser.email,
        });
      }

      const session = await issueAuthSession(fastify, freshUser, request);
      return reply.send(session);
    },
  );

  fastify.post('/auth/mfa/verify-challenge',
    {
      config: {
        public: true,
        rateLimit: PUBLIC_RATE_LIMIT,
      },
      schema: {
        tags: ['auth'],
        body: Type.Object({
          challenge_token: Type.String(),
          code: Type.String({ minLength: 6, maxLength: 32 }),
          use_recovery: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (request, reply) => {
      const body = request.body as {
        challenge_token: string;
        code: string;
        use_recovery?: boolean;
      };

      let decoded: MfaChallengePayload;
      try {
        decoded = fastify.jwt.verify<MfaChallengePayload>(body.challenge_token);
      } catch {
        return err(reply, request, 401, 'Challenge token invalid or expired');
      }
      if (decoded.stage !== 'mfa_pending' || !decoded.sub) {
        return err(reply, request, 401, 'Challenge token invalid');
      }

      const user = await fastify.prisma.user.findUnique({ where: { id: decoded.sub } });
      if (!user || !user.mfa_enabled || !user.mfa_secret_enc) {
        return err(reply, request, 401, 'MFA not configured');
      }
      if (isMfaLocked(user.mfa_locked_until)) {
        const mins = Math.ceil((user.mfa_locked_until!.getTime() - Date.now()) / 60_000);
        return err(
          reply,
          request,
          429,
          `MFA temporarily locked. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
        );
      }

      let success: boolean;
      let consumedRecoveryIndex = -1;

      if (body.use_recovery) {
        const hashes = decryptRecoveryCodes(user.mfa_recovery_codes_enc);
        consumedRecoveryIndex = await matchRecoveryCode(body.code, hashes);
        success = consumedRecoveryIndex >= 0;
      } else {
        success = verifyTotp(body.code, decryptSecret(user.mfa_secret_enc));
      }

      if (!success) {
        await recordMfaFailure(fastify, user);
        return err(reply, request, 401, 'Invalid MFA code');
      }

      if (consumedRecoveryIndex >= 0) {
        const hashes = decryptRecoveryCodes(user.mfa_recovery_codes_enc);
        hashes.splice(consumedRecoveryIndex, 1);
        await fastify.prisma.user.update({
          where: { id: user.id },
          data: {
            mfa_recovery_codes_enc: encryptRecoveryCodes(hashes),
            mfa_failed_count: 0,
            mfa_locked_until: null,
          },
        });
      } else {
        await resetMfaCounters(fastify, user.id);
      }

      const session = await issueAuthSession(fastify, user, request);
      return reply.send(session);
    },
  );

  fastify.post('/auth/mfa/enroll',
    { preHandler: fastify.authenticate, schema: { tags: ['auth'] } },
    async (request, reply) => {
      const userId = request.authUser!.sub as string;
      const user = await fastify.prisma.user.findUnique({ where: { id: userId } });
      if (!user) return err(reply, request, 404, 'User not found');
      if (user.mfa_enabled) {
        return err(
          reply,
          request,
          409,
          'MFA is already enabled. Disable it first to re-enroll.',
        );
      }

      const secret = generateSecret();
      await fastify.prisma.user.update({
        where: { id: userId },
        data: {
          mfa_secret_enc: encryptSecret(secret),
          mfa_verified_at: null,
        },
      });

      return reply.send({
        secret,
        otpauth_url: buildOtpauthUrl(user.email, secret),
      });
    },
  );

  fastify.post('/auth/mfa/enroll/verify',
    {
      preHandler: fastify.authenticate,
      schema: {
        tags: ['auth'],
        body: Type.Object({ code: Type.String({ minLength: 6, maxLength: 10 }) }),
      },
    },
    async (request, reply) => {
      const { code } = request.body as { code: string };
      const userId = request.authUser!.sub as string;
      const user = await fastify.prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.mfa_secret_enc) {
        return err(
          reply,
          request,
          400,
          'No pending MFA enrollment. Start enrollment first.',
        );
      }
      if (user.mfa_enabled) {
        return err(reply, request, 409, 'MFA is already enabled.');
      }

      const valid = verifyTotp(code, decryptSecret(user.mfa_secret_enc));
      if (!valid) {
        return err(reply, request, 400, 'Invalid code. Scan the QR and try again.');
      }

      const plaintextCodes = generateRecoveryCodes();
      const hashedCodes = await hashRecoveryCodes(plaintextCodes);

      await fastify.prisma.user.update({
        where: { id: userId },
        data: {
          mfa_enabled: true,
          mfa_verified_at: new Date(),
          mfa_recovery_codes_enc: encryptRecoveryCodes(hashedCodes),
          mfa_failed_count: 0,
          mfa_locked_until: null,
        },
      });

      return reply.send({ recovery_codes: plaintextCodes });
    },
  );

  fastify.post('/auth/mfa/disable',
    {
      preHandler: fastify.authenticate,
      schema: {
        tags: ['auth'],
        body: Type.Object({
          password: Type.String(),
          code: Type.String({ minLength: 6, maxLength: 32 }),
          use_recovery: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (request, reply) => {
      const body = request.body as { password: string; code: string; use_recovery?: boolean };
      const userId = request.authUser!.sub as string;
      const user = await fastify.prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.password_hash) return err(reply, request, 404, 'User not found');
      if (!user.mfa_enabled || !user.mfa_secret_enc) {
        return err(reply, request, 400, 'MFA is not enabled.');
      }

      const passwordOk = await verifyPassword(body.password, user.password_hash);
      if (!passwordOk) return err(reply, request, 400, 'Invalid password');

      let mfaOk: boolean;
      if (body.use_recovery) {
        const hashes = decryptRecoveryCodes(user.mfa_recovery_codes_enc);
        mfaOk = (await matchRecoveryCode(body.code, hashes)) >= 0;
      } else {
        mfaOk = verifyTotp(body.code, decryptSecret(user.mfa_secret_enc));
      }
      if (!mfaOk) {
        await recordMfaFailure(fastify, user);
        return err(reply, request, 400, 'Invalid MFA code');
      }

      await fastify.prisma.user.update({
        where: { id: userId },
        data: {
          mfa_enabled: false,
          mfa_secret_enc: null,
          mfa_recovery_codes_enc: null,
          mfa_verified_at: null,
          mfa_failed_count: 0,
          mfa_locked_until: null,
        },
      });

      return reply.send({ ok: true });
    },
  );

  fastify.post('/auth/mfa/recovery-codes/regenerate',
    {
      preHandler: fastify.authenticate,
      schema: {
        tags: ['auth'],
        body: Type.Object({ code: Type.String({ minLength: 6, maxLength: 10 }) }),
      },
    },
    async (request, reply) => {
      const { code } = request.body as { code: string };
      const userId = request.authUser!.sub as string;
      const user = await fastify.prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.mfa_enabled || !user.mfa_secret_enc) {
        return err(reply, request, 400, 'MFA is not enabled.');
      }
      if (isMfaLocked(user.mfa_locked_until)) {
        return err(reply, request, 429, 'MFA temporarily locked.');
      }

      if (!verifyTotp(code, decryptSecret(user.mfa_secret_enc))) {
        await recordMfaFailure(fastify, user);
        return err(reply, request, 400, 'Invalid MFA code');
      }

      const plaintextCodes = generateRecoveryCodes();
      const hashedCodes = await hashRecoveryCodes(plaintextCodes);
      await fastify.prisma.user.update({
        where: { id: userId },
        data: {
          mfa_recovery_codes_enc: encryptRecoveryCodes(hashedCodes),
          mfa_failed_count: 0,
          mfa_locked_until: null,
        },
      });

      return reply.send({ recovery_codes: plaintextCodes });
    },
  );

  fastify.post('/auth/refresh',
    {
      config: { public: true },
      schema: {
        tags: ['auth'],
        body: Type.Object({
          refresh_token: Type.String(),
        }),
      },
    },
    async (request, reply) => {
      const { refresh_token } = request.body as { refresh_token: string };
      const decoded = fastify.jwt.verify<RefreshTokenPayload>(refresh_token);
      if (decoded.token_type !== 'refresh') {
        return err(reply, request, 401, 'Unauthorized');
      }

      if (
        !decoded.sid ||
        !decoded.sub ||
        !decoded.email ||
        !decoded.role ||
        !decoded.jti
      ) {
        return err(reply, request, 401, 'Unauthorized');
      }

      const presentedHash = hashRefreshToken(refresh_token);
      const tokenRow = await fastify.prisma.refreshToken.findUnique({
        where: { token_hash: presentedHash },
      });

      if (
        !tokenRow ||
        tokenRow.session_id !== decoded.sid ||
        tokenRow.user_id !== decoded.sub
      ) {
        return err(reply, request, 401, 'Unauthorized');
      }

      if (tokenRow.rotated_to != null || tokenRow.revoked_at != null) {
        const now = new Date();
        await fastify.prisma.$transaction([
          fastify.prisma.refreshToken.updateMany({
            where: { session_id: tokenRow.session_id, revoked_at: null },
            data: { revoked_at: now },
          }),
          fastify.prisma.refreshToken.update({
            where: { id: tokenRow.id },
            data: { replay_detected_at: now },
          }),
        ]);
        request.log.warn(
          { session_id: tokenRow.session_id, user_id: tokenRow.user_id, token_id: tokenRow.id },
          'refresh_token_replay_detected',
        );
        return err(reply, request, 401, 'token_replay_detected');
      }

      if (tokenRow.expires_at.getTime() < Date.now()) {
        return err(reply, request, 401, 'Unauthorized');
      }

      const freshUser = await fastify.prisma.user.findUnique({
        where: { id: decoded.sub },
        select: { id: true, name: true, email: true, role: true },
      });
      if (!freshUser) {
        return err(reply, request, 401, 'Unauthorized');
      }

      const payload = {
        sub: decoded.sub,
        sid: decoded.sid,
        role: freshUser.role,
        email: freshUser.email,
        name: freshUser.name,
        permissions: [...permissionsForRole(freshUser.role)],
      };
      const tokens = signTokens(fastify, payload);
      const newExpiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

      const newToken = await fastify.prisma.refreshToken.create({
        data: {
          user_id: tokenRow.user_id,
          session_id: tokenRow.session_id,
          token_hash: hashRefreshToken(tokens.refresh_token),
          expires_at: newExpiresAt,
          ip_address: request.ip,
          user_agent: request.headers['user-agent'] ?? null,
        },
      });

      await fastify.prisma.refreshToken.update({
        where: { id: tokenRow.id },
        data: { rotated_to: newToken.id, revoked_at: new Date() },
      });

      return reply.send({ ...tokens, access_token: tokens.token });
    },
  );

  fastify.post('/auth/logout',
    {
      preHandler: fastify.authenticate,
      schema: {
        tags: ['auth'],
        body: Type.Optional(
          Type.Object({
            session_id: Type.Optional(Type.String({ format: 'uuid' })),
          }),
        ),
      },
    },
    async (request, reply) => {
      const userId = request.authUser?.sub;
      const body = (request.body ?? {}) as { session_id?: string };
      const sessionId =
        body.session_id ??
        (typeof request.authUser?.sid === 'string' ? request.authUser.sid : undefined);
      if (!userId || !sessionId) {
        return err(reply, request, 400, 'session_id is required');
      }

      await fastify.prisma.refreshToken.updateMany({
        where: { session_id: sessionId, user_id: userId, revoked_at: null },
        data: { revoked_at: new Date() },
      });

      return { status: 'ok' };
    },
  );

  fastify.post('/auth/change-password',
    {
      preHandler: fastify.authenticate,
      schema: {
        tags: ['auth'],
        body: Type.Object({
          current_password: Type.String(),
          new_password: Type.String({ minLength: 8 }),
        }),
      },
    },
    async (request, reply) => {
      const { current_password, new_password } = request.body as {
        current_password: string;
        new_password: string;
      };
      const userId = request.authUser!.sub as string;
      const user = await fastify.prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.password_hash) {
        return err(reply, request, 404, 'User not found');
      }

      const ok = await verifyPassword(current_password, user.password_hash);
      if (!ok) {
        return err(reply, request, 400, 'Invalid password');
      }

      const password_hash = await hashPassword(new_password);
      await fastify.prisma.user.update({
        where: { id: userId },
        data: { password_hash },
      });

      const currentSessionId =
        typeof request.authUser?.sid === 'string' ? request.authUser.sid : undefined;
      await fastify.prisma.refreshToken.updateMany({
        where: {
          user_id: userId,
          revoked_at: null,
          ...(currentSessionId ? { NOT: { session_id: currentSessionId } } : {}),
        },
        data: { revoked_at: new Date() },
      });

      return { status: 'ok' };
    },
  );

  fastify.get('/auth/sessions',
    {
      preHandler: fastify.authenticate,
      schema: { tags: ['auth'] },
    },
    async (request, reply) => {
      const userId = request.authUser?.sub;
      if (!userId) return err(reply, request, 401, 'Unauthorized');
      const tokens = await fastify.prisma.refreshToken.findMany({
        where: { user_id: userId, revoked_at: null },
        orderBy: { created_at: 'desc' },
        distinct: ['session_id'],
      });
      return {
        data: tokens.map((token) => ({
          id: token.session_id,
          ip_address: token.ip_address,
          user_agent: token.user_agent,
          expires_at: token.expires_at,
          created_at: token.created_at,
          current: request.authUser?.sid === token.session_id,
        })),
      };
    },
  );

  fastify.post('/auth/forgot-password',
    {
      config: {
        public: true,
        rateLimit: PUBLIC_RATE_LIMIT,
      },
      schema: {
        tags: ['auth'],
        body: Type.Object({ email: Type.String({ format: 'email' }) }),
      },
    },
    async (request) => {
      const { email } = request.body as { email: string };
      const user = await fastify.prisma.user.findFirst({
        where: { email: email.toLowerCase(), deleted_at: null },
      });

      if (!user) {
        return {
          message: 'If the account exists, a password reset link has been generated.',
        };
      }

      const rawToken = `${randomUUID()}${randomUUID()}`;
      const tokenHash = hashToken(rawToken);

      await fastify.prisma.verificationToken.create({
        data: {
          user_id: user.id,
          token_hash: tokenHash,
          kind: 'password_reset',
          expires_at: new Date(Date.now() + RESET_TOKEN_TTL_SECONDS * 1000),
        },
      });

      const resetLink = buildResetLink(rawToken);
      try {
        const sent = await sendPasswordResetEmail(user.email, resetLink);
        if (!sent) {
          fastify.log.warn('SMTP is not configured; reset email was not sent.');
        }
      } catch (e) {
        fastify.log.error({ err: e }, 'Failed to send password reset email via SMTP');
      }

      return {
        message: 'If the account exists, a password reset link has been generated.',
        ...(process.env.NODE_ENV !== 'production' ? { reset_token: rawToken } : {}),
      };
    },
  );

  fastify.post('/auth/reset-password',
    {
      config: { public: true },
      schema: {
        tags: ['auth'],
        body: Type.Object({
          token: Type.String(),
          new_password: Type.String({ minLength: 8 }),
        }),
      },
    },
    async (request, reply) => {
      const { token, new_password } = request.body as {
        token: string;
        new_password: string;
      };

      const tokenHash = hashToken(token);
      const reset = await fastify.prisma.verificationToken.findFirst({
        where: {
          token_hash: tokenHash,
          kind: 'password_reset',
          consumed_at: null,
          expires_at: { gt: new Date() },
        },
      });

      if (!reset) {
        return err(reply, request, 400, 'Invalid or expired reset token');
      }

      const password_hash = await hashPassword(new_password);

      await fastify.prisma.$transaction([
        fastify.prisma.user.update({
          where: { id: reset.user_id },
          data: { password_hash },
        }),
        fastify.prisma.verificationToken.update({
          where: { id: reset.id },
          data: { consumed_at: new Date() },
        }),
        fastify.prisma.refreshToken.updateMany({
          where: { user_id: reset.user_id, revoked_at: null },
          data: { revoked_at: new Date() },
        }),
      ]);

      return { status: 'ok' };
    },
  );

  fastify.post('/auth/verify-email',
    {
      config: { public: true },
      schema: {
        tags: ['auth'],
        body: Type.Object({ token: Type.String({ minLength: 1 }) }),
      },
    },
    async (request, reply) => {
      const { token } = request.body as { token: string };
      const tokenHash = hashToken(token);

      const record = await fastify.prisma.verificationToken.findFirst({
        where: {
          token_hash: tokenHash,
          kind: 'email_verify',
          consumed_at: null,
          expires_at: { gt: new Date() },
        },
      });

      if (!record) {
        return err(reply, request, 400, 'Invalid or expired verification token');
      }

      await fastify.prisma.$transaction([
        fastify.prisma.user.update({
          where: { id: record.user_id },
          data: { email_verified: true },
        }),
        fastify.prisma.verificationToken.update({
          where: { id: record.id },
          data: { consumed_at: new Date() },
        }),
      ]);

      return reply.send({ verified: true });
    },
  );

  fastify.post('/auth/resend-verification',
    {
      config: {
        public: true,
        rateLimit: {
          max: 5,
          timeWindow: '1 hour',
          keyGenerator: (req) => {
            const body = (req.body ?? {}) as { email?: string };
            return (body.email ?? '').toLowerCase() || req.ip;
          },
        },
      },
      schema: {
        tags: ['auth'],
        body: Type.Object({ email: Type.String({ format: 'email' }) }),
      },
    },
    async (request, reply) => {
      const { email } = request.body as { email: string };
      const user = await fastify.prisma.user.findFirst({
        where: { email: email.toLowerCase(), deleted_at: null },
      });

      if (user && !user.email_verified) {
        const rawToken = `${randomUUID()}${randomUUID()}`;
        await fastify.prisma.verificationToken.create({
          data: {
            user_id: user.id,
            token_hash: hashToken(rawToken),
            kind: 'email_verify',
            expires_at: new Date(Date.now() + VERIFICATION_TOKEN_TTL_SECONDS * 1000),
          },
        });

        const link = buildVerificationLink(rawToken);
        try {
          const sent = await sendVerificationEmail(user.email, link);
          if (!sent) {
            fastify.log.warn('SMTP is not configured; verification email was not sent.');
          }
        } catch (e) {
          fastify.log.error({ err: e }, 'Failed to send verification email via SMTP');
        }
      }

      return reply.status(202).send({ sent: true });
    },
  );

  fastify.get('/auth/me',
    {
      preHandler: fastify.authenticate,
      schema: { tags: ['auth'] },
    },
    async (request, reply) => {
      const userId = request.authUser?.sub;
      if (!userId) return err(reply, request, 401, 'Unauthorized');
      const user = await fastify.prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.deleted_at) return err(reply, request, 404, 'User not found');
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        email_verified: user.email_verified,
        mfa_enabled: user.mfa_enabled,
        last_login: user.last_login,
        created_at: user.created_at,
        updated_at: user.updated_at,
      };
    },
  );
});
