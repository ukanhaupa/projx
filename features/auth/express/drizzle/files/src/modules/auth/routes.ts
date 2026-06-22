import express, { type Request, type Response, type Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, count, eq, gt, isNull, ne } from 'drizzle-orm';
import type { DbClient } from '../../db/client.js';
import { refreshTokens, users, verificationTokens } from '../../db/schema.js';
import { requireAuth } from '../../middlewares/authenticate.js';
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

type User = typeof users.$inferSelect;

const RESET_TOKEN_TTL_SECONDS = 30 * 60;
const VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const MFA_CHALLENGE_TTL = '5m' as const;
const PUBLIC_RATE_LIMIT_WINDOW_MS = 60_000;
const RESEND_VERIFICATION_WINDOW_MS = 60 * 60 * 1000;
const EXPOSE_RESET_TOKEN =
  (process.env.AUTH_EXPOSE_RESET_TOKEN ?? '').toLowerCase() === 'true';

function publicRateLimitMax(): number {
  return Number(process.env.AUTH_PUBLIC_RATE_LIMIT_MAX ?? '5');
}

function resendVerificationRateLimitMax(): number {
  return Number(process.env.AUTH_RESEND_VERIFICATION_RATE_LIMIT_MAX ?? '5');
}

const SignupBody = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string(),
});

const MfaVerifyChallengeBody = z.object({
  challenge_token: z.string(),
  code: z.string().min(6).max(32),
  use_recovery: z.boolean().optional(),
});

const MfaEnrollVerifyBody = z.object({
  code: z.string().min(6).max(10),
});

const MfaDisableBody = z.object({
  password: z.string(),
  code: z.string().min(6).max(32),
  use_recovery: z.boolean().optional(),
});

const MfaRegenerateBody = z.object({
  code: z.string().min(6).max(10),
});

const RefreshBody = z.object({
  refresh_token: z.string(),
});

const LogoutBody = z
  .object({
    session_id: z.string().uuid().optional(),
  })
  .optional();

const ChangePasswordBody = z.object({
  current_password: z.string(),
  new_password: z.string().min(8),
});

const ForgotPasswordBody = z.object({
  email: z.string().email(),
});

const ResetPasswordBody = z.object({
  token: z.string(),
  new_password: z.string().min(8),
});

const VerifyEmailBody = z.object({
  token: z.string().min(1),
});

const ResendVerificationBody = z.object({
  email: z.string().email(),
});

interface MfaChallengePayload {
  sub?: string;
  stage?: string;
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

function bodyValidationError(res: Response, parseError: z.ZodError): Response {
  return err(res, 400, parseError.issues[0]?.message ?? 'Invalid body');
}

function signMfaChallenge(user: User): string {
  return signJwt(
    { sub: user.id, stage: 'mfa_pending' },
    { expiresIn: MFA_CHALLENGE_TTL },
  );
}

async function recordMfaFailure(db: DbClient, user: User): Promise<void> {
  const nextCount = user.mfa_failed_count + 1;
  const data: { mfa_failed_count: number; mfa_locked_until?: Date } = {
    mfa_failed_count: nextCount,
  };
  if (nextCount >= MFA_MAX_ATTEMPTS) {
    data.mfa_locked_until = new Date(Date.now() + MFA_LOCKOUT_MS);
  }
  await db.update(users).set(data).where(eq(users.id, user.id));
}

async function resetMfaCounters(db: DbClient, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ mfa_failed_count: 0, mfa_locked_until: null })
    .where(eq(users.id, userId));
}

function publicRateLimit() {
  return rateLimit({
    windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
    limit: publicRateLimitMax(),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => (req.ip ? ipKeyGenerator(req.ip) : 'unknown'),
  });
}

function resendVerificationRateLimit() {
  return rateLimit({
    windowMs: RESEND_VERIFICATION_WINDOW_MS,
    limit: resendVerificationRateLimitMax(),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email =
        typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
      if (email) return email;
      return req.ip ? ipKeyGenerator(req.ip) : 'unknown';
    },
  });
}

export function authRouter(db: DbClient): Router {
  const router = express.Router();

  router.post(
    '/signup',
    publicRateLimit(),
    async (req: Request, res: Response, next): Promise<void> => {
      try {
        const parsed = SignupBody.safeParse(req.body);
        if (!parsed.success) {
          bodyValidationError(res, parsed.error);
          return;
        }
        const body = parsed.data;
        const normalizedEmail = body.email.toLowerCase();
        const existing = (
          await db
            .select()
            .from(users)
            .where(eq(users.email, normalizedEmail))
            .limit(1)
        )[0];
        if (existing) {
          err(res, 409, 'An account with this email already exists.');
          return;
        }
        const passwordHash = await hashPassword(body.password);
        const totalUsers = Number(
          (await db.select({ c: count() }).from(users))[0].c,
        );
        const isFirstUser = totalUsers === 0;
        const user = (
          await db
            .insert(users)
            .values({
              email: normalizedEmail,
              name: body.name,
              password_hash: passwordHash,
              role: isFirstUser ? 'admin' : 'user',
            })
            .returning()
        )[0];

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

        await db.insert(refreshTokens).values({
          user_id: user.id,
          session_id: sessionId,
          token_hash: hashRefreshToken(tokens.refresh_token),
          expires_at: expiresAt,
          ip_address: req.ip ?? null,
          user_agent: req.get('user-agent') ?? null,
        });

        try {
          await sendInitialVerificationEmail(db, user.id);
        } catch (e) {
          console.error('[auth] failed to send initial verification email', e, {
            userId: user.id,
          });
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
      } catch (e) {
        next(e);
      }
    },
  );

  router.post(
    '/login',
    publicRateLimit(),
    async (req: Request, res: Response, next): Promise<void> => {
      try {
        const parsed = LoginBody.safeParse(req.body);
        if (!parsed.success) {
          bodyValidationError(res, parsed.error);
          return;
        }
        const { email, password } = parsed.data;
        const normalizedEmail = email.toLowerCase();

        const user = (
          await db
            .select()
            .from(users)
            .where(eq(users.email, normalizedEmail))
            .limit(1)
        )[0];

        if (user?.locked_until && user.locked_until.getTime() > Date.now()) {
          const mins = Math.ceil(
            (user.locked_until.getTime() - Date.now()) / 60_000,
          );
          err(
            res,
            429,
            `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
          );
          return;
        }

        if (!user || !user.password_hash) {
          err(res, 401, 'Invalid credentials');
          return;
        }

        const validPassword = await verifyPassword(
          password,
          user.password_hash,
        );
        if (!validPassword) {
          const nextCount = user.failed_login_count + 1;
          const lockData: { failed_login_count: number; locked_until?: Date } =
            {
              failed_login_count: nextCount,
            };
          if (nextCount >= LOGIN_MAX_ATTEMPTS) {
            lockData.locked_until = new Date(Date.now() + LOGIN_LOCKOUT_MS);
          }
          await db.update(users).set(lockData).where(eq(users.id, user.id));
          err(res, 401, 'Invalid credentials');
          return;
        }

        const freshUser = (
          await db
            .update(users)
            .set({
              last_login: new Date(),
              failed_login_count: 0,
              locked_until: null,
            })
            .where(eq(users.id, user.id))
            .returning()
        )[0];

        if (freshUser.mfa_enabled) {
          if (isMfaLocked(freshUser.mfa_locked_until)) {
            const mins = Math.ceil(
              (freshUser.mfa_locked_until!.getTime() - Date.now()) / 60_000,
            );
            err(
              res,
              429,
              `MFA temporarily locked. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
            );
            return;
          }
          const challenge_token = signMfaChallenge(freshUser);
          res.json({
            mfa_required: true,
            challenge_token,
            email: freshUser.email,
          });
          return;
        }

        const session = await issueAuthSession(db, freshUser, req);
        res.json(session);
      } catch (e) {
        next(e);
      }
    },
  );

  router.post(
    '/mfa/verify-challenge',
    publicRateLimit(),
    async (req: Request, res: Response, next): Promise<void> => {
      try {
        const parsed = MfaVerifyChallengeBody.safeParse(req.body);
        if (!parsed.success) {
          bodyValidationError(res, parsed.error);
          return;
        }
        const body = parsed.data;

        let decoded: MfaChallengePayload;
        try {
          decoded = verifyJwt<MfaChallengePayload>(body.challenge_token);
        } catch {
          err(res, 401, 'Challenge token invalid or expired');
          return;
        }
        if (decoded.stage !== 'mfa_pending' || !decoded.sub) {
          err(res, 401, 'Challenge token invalid');
          return;
        }

        const user = (
          await db
            .select()
            .from(users)
            .where(eq(users.id, decoded.sub))
            .limit(1)
        )[0];
        if (!user || !user.mfa_enabled || !user.mfa_secret_enc) {
          err(res, 401, 'MFA not configured');
          return;
        }
        if (isMfaLocked(user.mfa_locked_until)) {
          const mins = Math.ceil(
            (user.mfa_locked_until!.getTime() - Date.now()) / 60_000,
          );
          err(
            res,
            429,
            `MFA temporarily locked. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
          );
          return;
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
          await recordMfaFailure(db, user);
          err(res, 401, 'Invalid MFA code');
          return;
        }

        if (consumedRecoveryIndex >= 0) {
          const hashes = decryptRecoveryCodes(user.mfa_recovery_codes_enc);
          hashes.splice(consumedRecoveryIndex, 1);
          await db
            .update(users)
            .set({
              mfa_recovery_codes_enc: encryptRecoveryCodes(hashes),
              mfa_failed_count: 0,
              mfa_locked_until: null,
            })
            .where(eq(users.id, user.id));
        } else {
          await resetMfaCounters(db, user.id);
        }

        const session = await issueAuthSession(db, user, req);
        res.json(session);
      } catch (e) {
        next(e);
      }
    },
  );

  router.post(
    '/mfa/enroll',
    requireAuth,
    async (req: Request, res: Response, next): Promise<void> => {
      try {
        const userId = req.authUser!.sub;
        const user = (
          await db.select().from(users).where(eq(users.id, userId)).limit(1)
        )[0];
        if (!user) {
          err(res, 404, 'User not found');
          return;
        }
        if (user.mfa_enabled) {
          err(
            res,
            409,
            'MFA is already enabled. Disable it first to re-enroll.',
          );
          return;
        }

        const secret = generateSecret();
        await db
          .update(users)
          .set({ mfa_secret_enc: encryptSecret(secret), mfa_verified_at: null })
          .where(eq(users.id, userId));

        res.json({
          secret,
          otpauth_url: buildOtpauthUrl(user.email, secret),
        });
      } catch (e) {
        next(e);
      }
    },
  );

  router.post(
    '/mfa/enroll/verify',
    requireAuth,
    async (req: Request, res: Response, next): Promise<void> => {
      try {
        const parsed = MfaEnrollVerifyBody.safeParse(req.body);
        if (!parsed.success) {
          bodyValidationError(res, parsed.error);
          return;
        }
        const { code } = parsed.data;
        const userId = req.authUser!.sub;
        const user = (
          await db.select().from(users).where(eq(users.id, userId)).limit(1)
        )[0];
        if (!user || !user.mfa_secret_enc) {
          err(res, 400, 'No pending MFA enrollment. Start enrollment first.');
          return;
        }
        if (user.mfa_enabled) {
          err(res, 409, 'MFA is already enabled.');
          return;
        }

        const valid = verifyTotp(code, decryptSecret(user.mfa_secret_enc));
        if (!valid) {
          err(res, 400, 'Invalid code. Scan the QR and try again.');
          return;
        }

        const plaintextCodes = generateRecoveryCodes();
        const hashedCodes = await hashRecoveryCodes(plaintextCodes);

        await db
          .update(users)
          .set({
            mfa_enabled: true,
            mfa_verified_at: new Date(),
            mfa_recovery_codes_enc: encryptRecoveryCodes(hashedCodes),
            mfa_failed_count: 0,
            mfa_locked_until: null,
          })
          .where(eq(users.id, userId));

        res.json({ recovery_codes: plaintextCodes });
      } catch (e) {
        next(e);
      }
    },
  );

  router.post(
    '/mfa/disable',
    requireAuth,
    async (req: Request, res: Response, next): Promise<void> => {
      try {
        const parsed = MfaDisableBody.safeParse(req.body);
        if (!parsed.success) {
          bodyValidationError(res, parsed.error);
          return;
        }
        const body = parsed.data;
        const userId = req.authUser!.sub;
        const user = (
          await db.select().from(users).where(eq(users.id, userId)).limit(1)
        )[0];
        if (!user || !user.password_hash) {
          err(res, 404, 'User not found');
          return;
        }
        if (!user.mfa_enabled || !user.mfa_secret_enc) {
          err(res, 400, 'MFA is not enabled.');
          return;
        }

        const passwordOk = await verifyPassword(
          body.password,
          user.password_hash,
        );
        if (!passwordOk) {
          err(res, 400, 'Invalid password');
          return;
        }

        let mfaOk: boolean;
        if (body.use_recovery) {
          const hashes = decryptRecoveryCodes(user.mfa_recovery_codes_enc);
          mfaOk = (await matchRecoveryCode(body.code, hashes)) >= 0;
        } else {
          mfaOk = verifyTotp(body.code, decryptSecret(user.mfa_secret_enc));
        }
        if (!mfaOk) {
          await recordMfaFailure(db, user);
          err(res, 400, 'Invalid MFA code');
          return;
        }

        await db
          .update(users)
          .set({
            mfa_enabled: false,
            mfa_secret_enc: null,
            mfa_recovery_codes_enc: null,
            mfa_verified_at: null,
            mfa_failed_count: 0,
            mfa_locked_until: null,
          })
          .where(eq(users.id, userId));

        res.json({ ok: true });
      } catch (e) {
        next(e);
      }
    },
  );

  router.post(
    '/mfa/recovery-codes/regenerate',
    requireAuth,
    async (req: Request, res: Response, next): Promise<void> => {
      try {
        const parsed = MfaRegenerateBody.safeParse(req.body);
        if (!parsed.success) {
          bodyValidationError(res, parsed.error);
          return;
        }
        const { code } = parsed.data;
        const userId = req.authUser!.sub;
        const user = (
          await db.select().from(users).where(eq(users.id, userId)).limit(1)
        )[0];
        if (!user || !user.mfa_enabled || !user.mfa_secret_enc) {
          err(res, 400, 'MFA is not enabled.');
          return;
        }
        if (isMfaLocked(user.mfa_locked_until)) {
          err(res, 429, 'MFA temporarily locked.');
          return;
        }

        if (!verifyTotp(code, decryptSecret(user.mfa_secret_enc))) {
          await recordMfaFailure(db, user);
          err(res, 400, 'Invalid MFA code');
          return;
        }

        const plaintextCodes = generateRecoveryCodes();
        const hashedCodes = await hashRecoveryCodes(plaintextCodes);
        await db
          .update(users)
          .set({
            mfa_recovery_codes_enc: encryptRecoveryCodes(hashedCodes),
            mfa_failed_count: 0,
            mfa_locked_until: null,
          })
          .where(eq(users.id, userId));

        res.json({ recovery_codes: plaintextCodes });
      } catch (e) {
        next(e);
      }
    },
  );

  router.post(
    '/refresh',
    async (req: Request, res: Response, next): Promise<void> => {
      try {
        const parsed = RefreshBody.safeParse(req.body);
        if (!parsed.success) {
          bodyValidationError(res, parsed.error);
          return;
        }
        const { refresh_token } = parsed.data;
        let decoded: RefreshTokenPayload;
        try {
          decoded = verifyJwt<RefreshTokenPayload>(refresh_token);
        } catch {
          err(res, 401, 'Unauthorized');
          return;
        }
        if (decoded.token_type !== 'refresh') {
          err(res, 401, 'Unauthorized');
          return;
        }

        if (
          !decoded.sid ||
          !decoded.sub ||
          !decoded.email ||
          !decoded.role ||
          !decoded.jti
        ) {
          err(res, 401, 'Unauthorized');
          return;
        }

        const presentedHash = hashRefreshToken(refresh_token);
        const tokenRow = (
          await db
            .select()
            .from(refreshTokens)
            .where(eq(refreshTokens.token_hash, presentedHash))
            .limit(1)
        )[0];

        if (
          !tokenRow ||
          tokenRow.session_id !== decoded.sid ||
          tokenRow.user_id !== decoded.sub
        ) {
          err(res, 401, 'Unauthorized');
          return;
        }

        const handleReplay = async () => {
          const now = new Date();
          await db.transaction(async (tx) => {
            await tx
              .update(refreshTokens)
              .set({ revoked_at: now })
              .where(
                and(
                  eq(refreshTokens.session_id, tokenRow.session_id),
                  isNull(refreshTokens.revoked_at),
                ),
              );
            await tx
              .update(refreshTokens)
              .set({ replay_detected_at: now })
              .where(eq(refreshTokens.id, tokenRow.id));
          });
          console.warn('[auth] refresh_token_replay_detected', {
            session_id: tokenRow.session_id,
            user_id: tokenRow.user_id,
            token_id: tokenRow.id,
          });
          err(res, 401, 'token_replay_detected');
        };

        if (tokenRow.rotated_to != null || tokenRow.revoked_at != null) {
          await handleReplay();
          return;
        }

        if (tokenRow.expires_at.getTime() < Date.now()) {
          err(res, 401, 'Unauthorized');
          return;
        }

        const freshUser = (
          await db
            .select()
            .from(users)
            .where(eq(users.id, decoded.sub))
            .limit(1)
        )[0];
        if (!freshUser) {
          err(res, 401, 'Unauthorized');
          return;
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

        const newToken = await db.transaction(async (tx) => {
          const claimed = await tx
            .update(refreshTokens)
            .set({ revoked_at: new Date() })
            .where(
              and(
                eq(refreshTokens.id, tokenRow.id),
                isNull(refreshTokens.rotated_to),
                isNull(refreshTokens.revoked_at),
              ),
            )
            .returning({ id: refreshTokens.id });
          if (claimed.length === 0) return null;

          const created = (
            await tx
              .insert(refreshTokens)
              .values({
                user_id: tokenRow.user_id,
                session_id: tokenRow.session_id,
                token_hash: hashRefreshToken(tokens.refresh_token),
                expires_at: newExpiresAt,
                ip_address: req.ip ?? null,
                user_agent: req.get('user-agent') ?? null,
              })
              .returning()
          )[0];

          await tx
            .update(refreshTokens)
            .set({ rotated_to: created.id })
            .where(eq(refreshTokens.id, tokenRow.id));

          return created;
        });

        if (!newToken) {
          await handleReplay();
          return;
        }

        res.json({
          token: tokens.token,
          access_token: tokens.token,
          refresh_token: tokens.refresh_token,
          access_jti: tokens.access_jti,
          refresh_jti: tokens.refresh_jti,
        });
      } catch (e) {
        next(e);
      }
    },
  );

  router.post(
    '/logout',
    requireAuth,
    async (req: Request, res: Response, next): Promise<void> => {
      try {
        const parsed = LogoutBody.safeParse(req.body ?? {});
        if (!parsed.success) {
          bodyValidationError(res, parsed.error);
          return;
        }
        const userId = req.authUser?.sub;
        const body = parsed.data ?? {};
        const sessionId = body.session_id ?? req.authUser?.sid;
        if (!userId || !sessionId) {
          err(res, 400, 'session_id is required');
          return;
        }

        await db
          .update(refreshTokens)
          .set({ revoked_at: new Date() })
          .where(
            and(
              eq(refreshTokens.session_id, sessionId),
              eq(refreshTokens.user_id, userId),
              isNull(refreshTokens.revoked_at),
            ),
          );

        res.json({ status: 'ok' });
      } catch (e) {
        next(e);
      }
    },
  );

  router.post(
    '/change-password',
    requireAuth,
    async (req: Request, res: Response, next): Promise<void> => {
      try {
        const parsed = ChangePasswordBody.safeParse(req.body);
        if (!parsed.success) {
          bodyValidationError(res, parsed.error);
          return;
        }
        const { current_password, new_password } = parsed.data;
        const userId = req.authUser!.sub;
        const user = (
          await db.select().from(users).where(eq(users.id, userId)).limit(1)
        )[0];
        if (!user || !user.password_hash) {
          err(res, 404, 'User not found');
          return;
        }

        const ok = await verifyPassword(current_password, user.password_hash);
        if (!ok) {
          err(res, 400, 'Invalid password');
          return;
        }

        const password_hash = await hashPassword(new_password);
        await db
          .update(users)
          .set({ password_hash })
          .where(eq(users.id, userId));

        const currentSessionId = req.authUser?.sid;
        const revokeFilter = currentSessionId
          ? and(
              eq(refreshTokens.user_id, userId),
              isNull(refreshTokens.revoked_at),
              ne(refreshTokens.session_id, currentSessionId),
            )
          : and(
              eq(refreshTokens.user_id, userId),
              isNull(refreshTokens.revoked_at),
            );
        await db
          .update(refreshTokens)
          .set({ revoked_at: new Date() })
          .where(revokeFilter);

        res.json({ status: 'ok' });
      } catch (e) {
        next(e);
      }
    },
  );

  router.get(
    '/sessions',
    requireAuth,
    async (req: Request, res: Response, next): Promise<void> => {
      try {
        const userId = req.authUser?.sub;
        if (!userId) {
          err(res, 401, 'Unauthorized');
          return;
        }
        const rows = await db
          .selectDistinctOn([refreshTokens.session_id])
          .from(refreshTokens)
          .where(
            and(
              eq(refreshTokens.user_id, userId),
              isNull(refreshTokens.revoked_at),
            ),
          )
          .orderBy(refreshTokens.session_id, refreshTokens.created_at);
        res.json({
          data: rows.map((token) => ({
            id: token.session_id,
            ip_address: token.ip_address,
            user_agent: token.user_agent,
            expires_at: token.expires_at,
            created_at: token.created_at,
            current: req.authUser?.sid === token.session_id,
          })),
        });
      } catch (e) {
        next(e);
      }
    },
  );

  router.post(
    '/forgot-password',
    publicRateLimit(),
    async (req: Request, res: Response, next): Promise<void> => {
      try {
        const parsed = ForgotPasswordBody.safeParse(req.body);
        if (!parsed.success) {
          bodyValidationError(res, parsed.error);
          return;
        }
        const { email } = parsed.data;
        const user = (
          await db
            .select()
            .from(users)
            .where(
              and(
                eq(users.email, email.toLowerCase()),
                isNull(users.deleted_at),
              ),
            )
            .limit(1)
        )[0];

        if (!user) {
          res.json({
            message:
              'If the account exists, a password reset link has been generated.',
          });
          return;
        }

        const rawToken = `${randomUUID()}${randomUUID()}`;
        const tokenHash = hashToken(rawToken);

        await db.insert(verificationTokens).values({
          user_id: user.id,
          token_hash: tokenHash,
          kind: 'password_reset',
          expires_at: new Date(Date.now() + RESET_TOKEN_TTL_SECONDS * 1000),
        });

        const resetLink = buildResetLink(rawToken);
        try {
          const sent = await sendPasswordResetEmail(user.email, resetLink);
          if (!sent) {
            console.warn(
              '[auth] SMTP is not configured; reset email was not sent.',
            );
          }
        } catch (e) {
          console.error('[auth] failed to send password reset email', e);
        }

        res.json({
          message:
            'If the account exists, a password reset link has been generated.',
          ...(EXPOSE_RESET_TOKEN ? { reset_token: rawToken } : {}),
        });
      } catch (e) {
        next(e);
      }
    },
  );

  router.post(
    '/reset-password',
    async (req: Request, res: Response, next): Promise<void> => {
      try {
        const parsed = ResetPasswordBody.safeParse(req.body);
        if (!parsed.success) {
          bodyValidationError(res, parsed.error);
          return;
        }
        const { token, new_password } = parsed.data;

        const tokenHash = hashToken(token);
        const reset = (
          await db
            .select()
            .from(verificationTokens)
            .where(
              and(
                eq(verificationTokens.token_hash, tokenHash),
                eq(verificationTokens.kind, 'password_reset'),
                isNull(verificationTokens.consumed_at),
                gt(verificationTokens.expires_at, new Date()),
              ),
            )
            .limit(1)
        )[0];

        if (!reset) {
          err(res, 400, 'Invalid or expired reset token');
          return;
        }

        const password_hash = await hashPassword(new_password);
        const now = new Date();

        await db.transaction(async (tx) => {
          await tx
            .update(users)
            .set({ password_hash })
            .where(eq(users.id, reset.user_id));
          await tx
            .update(verificationTokens)
            .set({ consumed_at: now })
            .where(eq(verificationTokens.id, reset.id));
          await tx
            .update(refreshTokens)
            .set({ revoked_at: now })
            .where(
              and(
                eq(refreshTokens.user_id, reset.user_id),
                isNull(refreshTokens.revoked_at),
              ),
            );
        });

        res.json({ status: 'ok' });
      } catch (e) {
        next(e);
      }
    },
  );

  router.post(
    '/verify-email',
    async (req: Request, res: Response, next): Promise<void> => {
      try {
        const parsed = VerifyEmailBody.safeParse(req.body);
        if (!parsed.success) {
          bodyValidationError(res, parsed.error);
          return;
        }
        const { token } = parsed.data;
        const tokenHash = hashToken(token);

        const record = (
          await db
            .select()
            .from(verificationTokens)
            .where(
              and(
                eq(verificationTokens.token_hash, tokenHash),
                eq(verificationTokens.kind, 'email_verify'),
                isNull(verificationTokens.consumed_at),
                gt(verificationTokens.expires_at, new Date()),
              ),
            )
            .limit(1)
        )[0];

        if (!record) {
          err(res, 400, 'Invalid or expired verification token');
          return;
        }

        const now = new Date();
        await db.transaction(async (tx) => {
          await tx
            .update(users)
            .set({ email_verified: true })
            .where(eq(users.id, record.user_id));
          await tx
            .update(verificationTokens)
            .set({ consumed_at: now })
            .where(eq(verificationTokens.id, record.id));
        });

        res.json({ verified: true });
      } catch (e) {
        next(e);
      }
    },
  );

  router.post(
    '/resend-verification',
    resendVerificationRateLimit(),
    async (req: Request, res: Response, next): Promise<void> => {
      try {
        const parsed = ResendVerificationBody.safeParse(req.body);
        if (!parsed.success) {
          bodyValidationError(res, parsed.error);
          return;
        }
        const { email } = parsed.data;
        const user = (
          await db
            .select()
            .from(users)
            .where(
              and(
                eq(users.email, email.toLowerCase()),
                isNull(users.deleted_at),
              ),
            )
            .limit(1)
        )[0];

        if (user && !user.email_verified) {
          const rawToken = `${randomUUID()}${randomUUID()}`;
          await db.insert(verificationTokens).values({
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
              console.warn(
                '[auth] SMTP is not configured; verification email was not sent.',
              );
            }
          } catch (e) {
            console.error('[auth] failed to send verification email', e);
          }
        }

        res.status(202).json({ sent: true });
      } catch (e) {
        next(e);
      }
    },
  );

  router.get(
    '/me',
    requireAuth,
    async (req: Request, res: Response, next): Promise<void> => {
      try {
        const userId = req.authUser?.sub;
        if (!userId) {
          err(res, 401, 'Unauthorized');
          return;
        }
        const user = (
          await db.select().from(users).where(eq(users.id, userId)).limit(1)
        )[0];
        if (!user || user.deleted_at) {
          err(res, 404, 'User not found');
          return;
        }
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
      } catch (e) {
        next(e);
      }
    },
  );

  return router;
}
