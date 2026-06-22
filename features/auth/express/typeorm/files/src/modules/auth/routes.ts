import express, {
  type NextFunction,
  type Request,
  type Response,
  type Router,
} from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { IsNull, MoreThan } from 'typeorm';
import { dataSource } from '../../db/data-source.js';
import { ApiError } from '../../errors.js';
import { requireAuth } from '../../middlewares/authenticate.js';
import { RefreshToken } from '../../entities/refresh-token.js';
import { User } from '../../entities/user.js';
import { VerificationToken } from '../../entities/verification-token.js';
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
  signJwt,
  signTokens,
  verifyJwt,
} from './session.js';

const RESET_TOKEN_TTL_SECONDS = 30 * 60;
const VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
const EXPOSE_RESET_TOKEN =
  (process.env.AUTH_EXPOSE_RESET_TOKEN ?? '').toLowerCase() === 'true';

const publicLimiter = (): ReturnType<typeof rateLimit> =>
  rateLimit({
    windowMs: 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

const resendLimiter = (): ReturnType<typeof rateLimit> =>
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const body = (req.body ?? {}) as { email?: string };
      const email = (body.email ?? '').toLowerCase();
      if (email) return email;
      return req.ip ? ipKeyGenerator(req.ip) : 'unknown';
    },
  });

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
  res: Response,
  code: number,
  detail: string,
  extra?: Record<string, unknown>,
): Response {
  return res
    .status(code)
    .json({ detail, request_id: res.locals.requestId, ...extra });
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(422, z.prettifyError(result.error), 'validation_error');
  }
  return result.data;
}

function signMfaChallenge(userId: string): string {
  return signJwt(
    { sub: userId, stage: 'mfa_pending' },
    MFA_CHALLENGE_TTL_SECONDS,
  );
}

async function recordMfaFailure(user: User): Promise<void> {
  const nextCount = user.mfa_failed_count + 1;
  const data: { mfa_failed_count: number; mfa_locked_until?: Date } = {
    mfa_failed_count: nextCount,
  };
  if (nextCount >= MFA_MAX_ATTEMPTS) {
    data.mfa_locked_until = new Date(Date.now() + MFA_LOCKOUT_MS);
  }
  await dataSource.getRepository(User).update({ id: user.id }, data);
}

async function resetMfaCounters(userId: string): Promise<void> {
  await dataSource
    .getRepository(User)
    .update({ id: userId }, { mfa_failed_count: 0, mfa_locked_until: null });
}

function asyncHandler(
  handler: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}

const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const mfaChallengeSchema = z.object({
  challenge_token: z.string(),
  code: z.string().min(6).max(32),
  use_recovery: z.boolean().optional(),
});

const mfaEnrollVerifySchema = z.object({
  code: z.string().min(6).max(10),
});

const mfaDisableSchema = z.object({
  password: z.string(),
  code: z.string().min(6).max(32),
  use_recovery: z.boolean().optional(),
});

const mfaRegenerateSchema = z.object({
  code: z.string().min(6).max(10),
});

const refreshSchema = z.object({
  refresh_token: z.string(),
});

const logoutSchema = z
  .object({
    session_id: z.string().uuid().optional(),
  })
  .optional();

const changePasswordSchema = z.object({
  current_password: z.string(),
  new_password: z.string().min(8),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string(),
  new_password: z.string().min(8),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

const resendVerificationSchema = z.object({
  email: z.string().email(),
});

export function authRouter(): Router {
  const router = express.Router();
  const userRepo = () => dataSource.getRepository(User);
  const refreshRepo = () => dataSource.getRepository(RefreshToken);
  const verificationRepo = () => dataSource.getRepository(VerificationToken);

  router.post(
    '/signup',
    publicLimiter(),
    asyncHandler(async (req, res) => {
      const body = parseBody(signupSchema, req.body);

      const existing = await userRepo().findOne({
        where: { email: body.email.toLowerCase() },
      });
      if (existing) {
        return err(res, 409, 'An account with this email already exists.');
      }
      const passwordHash = await hashPassword(body.password);
      const isFirstUser = (await userRepo().count()) === 0;
      const user = await userRepo().save({
        email: body.email.toLowerCase(),
        name: body.name,
        password_hash: passwordHash,
        role: isFirstUser ? 'admin' : 'user',
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
      const tokens = signTokens(payload);
      const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

      await refreshRepo().save({
        user_id: user.id,
        session_id: sessionId,
        token_hash: hashRefreshToken(tokens.refresh_token),
        expires_at: expiresAt,
        ip_address: req.ip ?? null,
        user_agent: req.headers['user-agent'] ?? null,
      });

      try {
        await sendInitialVerificationEmail(null, user.id);
      } catch (e) {
        req.log?.error?.(
          { err: e, userId: user.id },
          'Failed to send initial verification email',
        );
      }

      res.status(201).json({
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
    }),
  );

  router.post(
    '/login',
    publicLimiter(),
    asyncHandler(async (req, res) => {
      const body = parseBody(loginSchema, req.body);
      const normalizedEmail = body.email.toLowerCase();

      const user = await userRepo().findOne({
        where: { email: normalizedEmail },
      });

      if (user?.locked_until && user.locked_until.getTime() > Date.now()) {
        const mins = Math.ceil(
          (user.locked_until.getTime() - Date.now()) / 60_000,
        );
        return err(
          res,
          429,
          `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
        );
      }

      if (!user || !user.password_hash) {
        return err(res, 401, 'Invalid credentials');
      }

      const validPassword = await verifyPassword(
        body.password,
        user.password_hash,
      );
      if (!validPassword) {
        const nextCount = user.failed_login_count + 1;
        const lockData: { failed_login_count: number; locked_until?: Date } = {
          failed_login_count: nextCount,
        };
        if (nextCount >= LOGIN_MAX_ATTEMPTS) {
          lockData.locked_until = new Date(Date.now() + LOGIN_LOCKOUT_MS);
        }
        await userRepo().update({ id: user.id }, lockData);
        return err(res, 401, 'Invalid credentials');
      }

      await userRepo().update(
        { id: user.id },
        {
          last_login: new Date(),
          failed_login_count: 0,
          locked_until: null,
        },
      );
      const freshUser = await userRepo().findOne({ where: { id: user.id } });
      if (!freshUser) {
        return err(res, 401, 'Invalid credentials');
      }

      if (freshUser.mfa_enabled) {
        if (isMfaLocked(freshUser.mfa_locked_until)) {
          const mins = Math.ceil(
            (freshUser.mfa_locked_until!.getTime() - Date.now()) / 60_000,
          );
          return err(
            res,
            429,
            `MFA temporarily locked. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
          );
        }
        const challenge_token = signMfaChallenge(freshUser.id);
        return res.json({
          mfa_required: true,
          challenge_token,
          email: freshUser.email,
        });
      }

      const session = await issueAuthSession(freshUser, req);
      res.json(session);
    }),
  );

  router.post(
    '/mfa/verify-challenge',
    publicLimiter(),
    asyncHandler(async (req, res) => {
      const body = parseBody(mfaChallengeSchema, req.body);

      let decoded: MfaChallengePayload;
      try {
        decoded = verifyJwt<MfaChallengePayload>(body.challenge_token);
      } catch {
        return err(res, 401, 'Challenge token invalid or expired');
      }
      if (decoded.stage !== 'mfa_pending' || !decoded.sub) {
        return err(res, 401, 'Challenge token invalid');
      }

      const user = await userRepo().findOne({ where: { id: decoded.sub } });
      if (!user || !user.mfa_enabled || !user.mfa_secret_enc) {
        return err(res, 401, 'MFA not configured');
      }
      if (isMfaLocked(user.mfa_locked_until)) {
        const mins = Math.ceil(
          (user.mfa_locked_until!.getTime() - Date.now()) / 60_000,
        );
        return err(
          res,
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
        await recordMfaFailure(user);
        return err(res, 401, 'Invalid MFA code');
      }

      if (consumedRecoveryIndex >= 0) {
        const hashes = decryptRecoveryCodes(user.mfa_recovery_codes_enc);
        hashes.splice(consumedRecoveryIndex, 1);
        await userRepo().update(
          { id: user.id },
          {
            mfa_recovery_codes_enc: encryptRecoveryCodes(hashes),
            mfa_failed_count: 0,
            mfa_locked_until: null,
          },
        );
      } else {
        await resetMfaCounters(user.id);
      }

      const session = await issueAuthSession(user, req);
      res.json(session);
    }),
  );

  router.post(
    '/mfa/enroll',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.authUser!.sub;
      const user = await userRepo().findOne({ where: { id: userId } });
      if (!user) return err(res, 404, 'User not found');
      if (user.mfa_enabled) {
        return err(
          res,
          409,
          'MFA is already enabled. Disable it first to re-enroll.',
        );
      }

      const secret = generateSecret();
      await userRepo().update(
        { id: userId },
        {
          mfa_secret_enc: encryptSecret(secret),
          mfa_verified_at: null,
        },
      );

      res.json({
        secret,
        otpauth_url: buildOtpauthUrl(user.email, secret),
      });
    }),
  );

  router.post(
    '/mfa/enroll/verify',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(mfaEnrollVerifySchema, req.body);
      const userId = req.authUser!.sub;
      const user = await userRepo().findOne({ where: { id: userId } });
      if (!user || !user.mfa_secret_enc) {
        return err(
          res,
          400,
          'No pending MFA enrollment. Start enrollment first.',
        );
      }
      if (user.mfa_enabled) {
        return err(res, 409, 'MFA is already enabled.');
      }

      const valid = verifyTotp(body.code, decryptSecret(user.mfa_secret_enc));
      if (!valid) {
        return err(res, 400, 'Invalid code. Scan the QR and try again.');
      }

      const plaintextCodes = generateRecoveryCodes();
      const hashedCodes = await hashRecoveryCodes(plaintextCodes);

      await userRepo().update(
        { id: userId },
        {
          mfa_enabled: true,
          mfa_verified_at: new Date(),
          mfa_recovery_codes_enc: encryptRecoveryCodes(hashedCodes),
          mfa_failed_count: 0,
          mfa_locked_until: null,
        },
      );

      res.json({ recovery_codes: plaintextCodes });
    }),
  );

  router.post(
    '/mfa/disable',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(mfaDisableSchema, req.body);
      const userId = req.authUser!.sub;
      const user = await userRepo().findOne({ where: { id: userId } });
      if (!user || !user.password_hash) return err(res, 404, 'User not found');
      if (!user.mfa_enabled || !user.mfa_secret_enc) {
        return err(res, 400, 'MFA is not enabled.');
      }

      const passwordOk = await verifyPassword(
        body.password,
        user.password_hash,
      );
      if (!passwordOk) return err(res, 400, 'Invalid password');

      let mfaOk: boolean;
      if (body.use_recovery) {
        const hashes = decryptRecoveryCodes(user.mfa_recovery_codes_enc);
        mfaOk = (await matchRecoveryCode(body.code, hashes)) >= 0;
      } else {
        mfaOk = verifyTotp(body.code, decryptSecret(user.mfa_secret_enc));
      }
      if (!mfaOk) {
        await recordMfaFailure(user);
        return err(res, 400, 'Invalid MFA code');
      }

      await userRepo().update(
        { id: userId },
        {
          mfa_enabled: false,
          mfa_secret_enc: null,
          mfa_recovery_codes_enc: null,
          mfa_verified_at: null,
          mfa_failed_count: 0,
          mfa_locked_until: null,
        },
      );

      res.json({ ok: true });
    }),
  );

  router.post(
    '/mfa/recovery-codes/regenerate',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(mfaRegenerateSchema, req.body);
      const userId = req.authUser!.sub;
      const user = await userRepo().findOne({ where: { id: userId } });
      if (!user || !user.mfa_enabled || !user.mfa_secret_enc) {
        return err(res, 400, 'MFA is not enabled.');
      }
      if (isMfaLocked(user.mfa_locked_until)) {
        return err(res, 429, 'MFA temporarily locked.');
      }

      if (!verifyTotp(body.code, decryptSecret(user.mfa_secret_enc))) {
        await recordMfaFailure(user);
        return err(res, 400, 'Invalid MFA code');
      }

      const plaintextCodes = generateRecoveryCodes();
      const hashedCodes = await hashRecoveryCodes(plaintextCodes);
      await userRepo().update(
        { id: userId },
        {
          mfa_recovery_codes_enc: encryptRecoveryCodes(hashedCodes),
          mfa_failed_count: 0,
          mfa_locked_until: null,
        },
      );

      res.json({ recovery_codes: plaintextCodes });
    }),
  );

  router.post(
    '/refresh',
    asyncHandler(async (req, res) => {
      const body = parseBody(refreshSchema, req.body);
      let decoded: RefreshTokenPayload;
      try {
        decoded = verifyJwt<RefreshTokenPayload>(body.refresh_token);
      } catch {
        return err(res, 401, 'Unauthorized');
      }
      if (decoded.token_type !== 'refresh') {
        return err(res, 401, 'Unauthorized');
      }

      if (
        !decoded.sid ||
        !decoded.sub ||
        !decoded.email ||
        !decoded.role ||
        !decoded.jti
      ) {
        return err(res, 401, 'Unauthorized');
      }

      const presentedHash = hashRefreshToken(body.refresh_token);
      const tokenRow = await refreshRepo().findOne({
        where: { token_hash: presentedHash },
      });

      if (
        !tokenRow ||
        tokenRow.session_id !== decoded.sid ||
        tokenRow.user_id !== decoded.sub
      ) {
        return err(res, 401, 'Unauthorized');
      }

      const handleReplay = async () => {
        const now = new Date();
        await dataSource.transaction(async (manager) => {
          await manager
            .getRepository(RefreshToken)
            .update(
              { session_id: tokenRow.session_id, revoked_at: IsNull() },
              { revoked_at: now },
            );
          await manager
            .getRepository(RefreshToken)
            .update({ id: tokenRow.id }, { replay_detected_at: now });
        });
        req.log?.warn?.(
          {
            session_id: tokenRow.session_id,
            user_id: tokenRow.user_id,
            token_id: tokenRow.id,
          },
          'refresh_token_replay_detected',
        );
        return err(res, 401, 'token_replay_detected');
      };

      if (tokenRow.rotated_to != null || tokenRow.revoked_at != null) {
        return handleReplay();
      }

      if (tokenRow.expires_at.getTime() < Date.now()) {
        return err(res, 401, 'Unauthorized');
      }

      const freshUser = await userRepo().findOne({
        where: { id: decoded.sub },
        select: { id: true, name: true, email: true, role: true },
      });
      if (!freshUser) {
        return err(res, 401, 'Unauthorized');
      }

      const payload = {
        sub: decoded.sub,
        sid: decoded.sid,
        role: freshUser.role,
        email: freshUser.email,
        name: freshUser.name,
        permissions: [...permissionsForRole(freshUser.role)],
      };
      const tokens = signTokens(payload);
      const newExpiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

      const newToken = await dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(RefreshToken);
        const claimed = await repo.update(
          {
            id: tokenRow.id,
            rotated_to: IsNull(),
            revoked_at: IsNull(),
          },
          { revoked_at: new Date() },
        );
        if (!claimed.affected) return null;

        const created = await repo.save({
          user_id: tokenRow.user_id,
          session_id: tokenRow.session_id,
          token_hash: hashRefreshToken(tokens.refresh_token),
          expires_at: newExpiresAt,
          ip_address: req.ip ?? null,
          user_agent: req.headers['user-agent'] ?? null,
        });

        await repo.update({ id: tokenRow.id }, { rotated_to: created.id });

        return created;
      });

      if (!newToken) {
        return handleReplay();
      }

      res.json({ ...tokens, access_token: tokens.token });
    }),
  );

  router.post(
    '/logout',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.authUser?.sub;
      const body = (req.body ?? {}) as { session_id?: string };
      const parsed = logoutSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiError(
          422,
          z.prettifyError(parsed.error),
          'validation_error',
        );
      }
      const sessionId =
        parsed.data?.session_id ??
        (typeof req.authUser?.sid === 'string' ? req.authUser.sid : undefined);
      if (!userId || !sessionId) {
        return err(res, 400, 'session_id is required');
      }

      await refreshRepo().update(
        { session_id: sessionId, user_id: userId, revoked_at: IsNull() },
        { revoked_at: new Date() },
      );

      res.json({ status: 'ok' });
    }),
  );

  router.post(
    '/change-password',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(changePasswordSchema, req.body);
      const userId = req.authUser!.sub;
      const user = await userRepo().findOne({ where: { id: userId } });
      if (!user || !user.password_hash) {
        return err(res, 404, 'User not found');
      }

      const ok = await verifyPassword(
        body.current_password,
        user.password_hash,
      );
      if (!ok) {
        return err(res, 400, 'Invalid password');
      }

      const password_hash = await hashPassword(body.new_password);
      await userRepo().update({ id: userId }, { password_hash });

      const currentSessionId =
        typeof req.authUser?.sid === 'string' ? req.authUser.sid : undefined;

      const qb = refreshRepo()
        .createQueryBuilder()
        .update()
        .set({ revoked_at: new Date() })
        .where('user_id = :userId', { userId })
        .andWhere('revoked_at IS NULL');
      if (currentSessionId) {
        qb.andWhere('session_id <> :sid', { sid: currentSessionId });
      }
      await qb.execute();

      res.json({ status: 'ok' });
    }),
  );

  router.get(
    '/sessions',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.authUser?.sub;
      if (!userId) return err(res, 401, 'Unauthorized');
      const tokens = await refreshRepo()
        .createQueryBuilder('rt')
        .distinctOn(['rt.session_id'])
        .where('rt.user_id = :userId', { userId })
        .andWhere('rt.revoked_at IS NULL')
        .orderBy('rt.session_id')
        .addOrderBy('rt.created_at', 'DESC')
        .getMany();
      res.json({
        data: tokens.map((token) => ({
          id: token.session_id,
          ip_address: token.ip_address,
          user_agent: token.user_agent,
          expires_at: token.expires_at,
          created_at: token.created_at,
          current: req.authUser?.sid === token.session_id,
        })),
      });
    }),
  );

  router.post(
    '/forgot-password',
    publicLimiter(),
    asyncHandler(async (req, res) => {
      const body = parseBody(forgotPasswordSchema, req.body);
      const user = await userRepo().findOne({
        where: { email: body.email.toLowerCase(), deleted_at: IsNull() },
      });

      if (!user) {
        res.json({
          message:
            'If the account exists, a password reset link has been generated.',
        });
        return;
      }

      const rawToken = `${randomUUID()}${randomUUID()}`;
      const tokenHash = hashToken(rawToken);

      await verificationRepo().save({
        user_id: user.id,
        token_hash: tokenHash,
        kind: 'password_reset',
        expires_at: new Date(Date.now() + RESET_TOKEN_TTL_SECONDS * 1000),
      });

      const resetLink = buildResetLink(rawToken);
      try {
        const sent = await sendPasswordResetEmail(user.email, resetLink);
        if (!sent) {
          req.log?.warn?.('SMTP is not configured; reset email was not sent.');
        }
      } catch (e) {
        req.log?.error?.(
          { err: e },
          'Failed to send password reset email via SMTP',
        );
      }

      res.json({
        message:
          'If the account exists, a password reset link has been generated.',
        ...(EXPOSE_RESET_TOKEN ? { reset_token: rawToken } : {}),
      });
    }),
  );

  router.post(
    '/reset-password',
    asyncHandler(async (req, res) => {
      const body = parseBody(resetPasswordSchema, req.body);
      const tokenHash = hashToken(body.token);
      const reset = await verificationRepo().findOne({
        where: {
          token_hash: tokenHash,
          kind: 'password_reset',
          consumed_at: IsNull(),
          expires_at: MoreThan(new Date()),
        },
      });

      if (!reset) {
        return err(res, 400, 'Invalid or expired reset token');
      }

      const password_hash = await hashPassword(body.new_password);

      await dataSource.transaction(async (manager) => {
        await manager
          .getRepository(User)
          .update({ id: reset.user_id }, { password_hash });
        await manager
          .getRepository(VerificationToken)
          .update({ id: reset.id }, { consumed_at: new Date() });
        await manager
          .getRepository(RefreshToken)
          .update(
            { user_id: reset.user_id, revoked_at: IsNull() },
            { revoked_at: new Date() },
          );
      });

      res.json({ status: 'ok' });
    }),
  );

  router.post(
    '/verify-email',
    asyncHandler(async (req, res) => {
      const body = parseBody(verifyEmailSchema, req.body);
      const tokenHash = hashToken(body.token);

      const record = await verificationRepo().findOne({
        where: {
          token_hash: tokenHash,
          kind: 'email_verify',
          consumed_at: IsNull(),
          expires_at: MoreThan(new Date()),
        },
      });

      if (!record) {
        return err(res, 400, 'Invalid or expired verification token');
      }

      await dataSource.transaction(async (manager) => {
        await manager
          .getRepository(User)
          .update({ id: record.user_id }, { email_verified: true });
        await manager
          .getRepository(VerificationToken)
          .update({ id: record.id }, { consumed_at: new Date() });
      });

      res.json({ verified: true });
    }),
  );

  router.post(
    '/resend-verification',
    resendLimiter(),
    asyncHandler(async (req, res) => {
      const body = parseBody(resendVerificationSchema, req.body);
      const user = await userRepo().findOne({
        where: { email: body.email.toLowerCase(), deleted_at: IsNull() },
      });

      if (user && !user.email_verified) {
        const rawToken = `${randomUUID()}${randomUUID()}`;
        await verificationRepo().save({
          user_id: user.id,
          token_hash: hashToken(rawToken),
          kind: 'email_verify',
          expires_at: new Date(
            Date.now() + VERIFICATION_TOKEN_TTL_SECONDS * 1000,
          ),
        });

        const link = buildVerificationLink(rawToken);
        try {
          const sent = await sendVerificationEmail(user.email, link);
          if (!sent) {
            req.log?.warn?.(
              'SMTP is not configured; verification email was not sent.',
            );
          }
        } catch (e) {
          req.log?.error?.(
            { err: e },
            'Failed to send verification email via SMTP',
          );
        }
      }

      res.status(202).json({ sent: true });
    }),
  );

  router.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.authUser?.sub;
      if (!userId) return err(res, 401, 'Unauthorized');
      const user = await userRepo().findOne({ where: { id: userId } });
      if (!user || user.deleted_at) return err(res, 404, 'User not found');
      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        email_verified: user.email_verified,
        mfa_enabled: user.mfa_enabled,
        last_login: user.last_login,
        created_at: user.created_at,
        updated_at: user.updated_at,
      });
    }),
  );

  return router;
}
