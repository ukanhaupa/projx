import express, {
  type NextFunction,
  type Request,
  type Response,
  type Router,
} from 'express';
import { randomUUID } from 'node:crypto';
import { Op, type Sequelize } from 'sequelize';
import { z } from 'zod';
import { requireAuth } from '../../middlewares/authenticate.js';
import { User } from '../../models/user.js';
import { RefreshToken } from '../../models/refresh-token.js';
import { VerificationToken } from '../../models/verification-token.js';
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
  ACCESS_TTL_SECONDS,
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

function signMfaChallenge(user: User): string {
  return signJwt(
    { sub: user.id, stage: 'mfa_pending' },
    MFA_CHALLENGE_TTL_SECONDS,
  );
}

async function recordMfaFailure(user: User): Promise<void> {
  const nextCount = user.mfa_failed_count + 1;
  user.set('mfa_failed_count', nextCount);
  if (nextCount >= MFA_MAX_ATTEMPTS) {
    user.set('mfa_locked_until', new Date(Date.now() + MFA_LOCKOUT_MS));
  }
  await user.save();
}

async function resetMfaCounters(user: User): Promise<void> {
  user.set('mfa_failed_count', 0);
  user.set('mfa_locked_until', null);
  await user.save();
}

function validate<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const result = schema.safeParse(value);
  if (!result.success) return null;
  return result.data;
}

const SignupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const MfaVerifyChallengeSchema = z.object({
  challenge_token: z.string(),
  code: z.string().min(6).max(32),
  use_recovery: z.boolean().optional(),
});

const MfaEnrollVerifySchema = z.object({
  code: z.string().min(6).max(10),
});

const MfaDisableSchema = z.object({
  password: z.string(),
  code: z.string().min(6).max(32),
  use_recovery: z.boolean().optional(),
});

const MfaRegenerateSchema = z.object({
  code: z.string().min(6).max(10),
});

const RefreshSchema = z.object({
  refresh_token: z.string(),
});

const LogoutSchema = z
  .object({
    session_id: z.string().uuid().optional(),
  })
  .optional();

const ChangePasswordSchema = z.object({
  current_password: z.string(),
  new_password: z.string().min(8),
});

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

const ResetPasswordSchema = z.object({
  token: z.string(),
  new_password: z.string().min(8),
});

const VerifyEmailSchema = z.object({
  token: z.string().min(1),
});

const ResendVerificationSchema = z.object({
  email: z.string().email(),
});

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

export function authRouter(sequelize: Sequelize): Router {
  const router = express.Router();

  router.post(
    '/signup',
    asyncHandler(async (req, res) => {
      const body = validate(SignupSchema, req.body);
      if (!body) return err(res, 400, 'Invalid request body');

      const existing = await User.findOne({
        where: { email: body.email.toLowerCase() },
      });
      if (existing) {
        return err(res, 409, 'An account with this email already exists.');
      }
      const passwordHash = await hashPassword(body.password);
      const isFirstUser = (await User.count()) === 0;
      const user = await User.create({
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

      await RefreshToken.create({
        user_id: user.id,
        session_id: sessionId,
        token_hash: hashRefreshToken(tokens.refresh_token),
        expires_at: expiresAt,
        ip_address: req.ip ?? null,
        user_agent: req.headers['user-agent'] ?? null,
      });

      try {
        await sendInitialVerificationEmail(sequelize, user.id);
      } catch (e) {
        req.log?.error?.(
          { err: e, userId: user.id },
          'Failed to send initial verification email',
        );
      }

      return res.status(201).json({
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
    asyncHandler(async (req, res) => {
      const body = validate(LoginSchema, req.body);
      if (!body) return err(res, 400, 'Invalid request body');
      const normalizedEmail = body.email.toLowerCase();

      const user = await User.findOne({ where: { email: normalizedEmail } });

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
        user.set('failed_login_count', nextCount);
        if (nextCount >= LOGIN_MAX_ATTEMPTS) {
          user.set('locked_until', new Date(Date.now() + LOGIN_LOCKOUT_MS));
        }
        await user.save();
        return err(res, 401, 'Invalid credentials');
      }

      user.set('last_login', new Date());
      user.set('failed_login_count', 0);
      user.set('locked_until', null);
      await user.save();

      if (user.mfa_enabled) {
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
        const challenge_token = signMfaChallenge(user);
        return res.json({
          mfa_required: true,
          challenge_token,
          email: user.email,
        });
      }

      const session = await issueAuthSession(user, req);
      return res.json(session);
    }),
  );

  router.post(
    '/mfa/verify-challenge',
    asyncHandler(async (req, res) => {
      const body = validate(MfaVerifyChallengeSchema, req.body);
      if (!body) return err(res, 400, 'Invalid request body');

      let decoded: MfaChallengePayload;
      try {
        decoded = verifyJwt<MfaChallengePayload>(body.challenge_token);
      } catch {
        return err(res, 401, 'Challenge token invalid or expired');
      }
      if (decoded.stage !== 'mfa_pending' || !decoded.sub) {
        return err(res, 401, 'Challenge token invalid');
      }

      const user = await User.findOne({ where: { id: decoded.sub } });
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
        user.set('mfa_recovery_codes_enc', encryptRecoveryCodes(hashes));
        user.set('mfa_failed_count', 0);
        user.set('mfa_locked_until', null);
        await user.save();
      } else {
        await resetMfaCounters(user);
      }

      const session = await issueAuthSession(user, req);
      return res.json(session);
    }),
  );

  router.post(
    '/mfa/enroll',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.authUser!.sub;
      const user = await User.findOne({ where: { id: userId } });
      if (!user) return err(res, 404, 'User not found');
      if (user.mfa_enabled) {
        return err(
          res,
          409,
          'MFA is already enabled. Disable it first to re-enroll.',
        );
      }

      const secret = generateSecret();
      user.set('mfa_secret_enc', encryptSecret(secret));
      user.set('mfa_verified_at', null);
      await user.save();

      return res.json({
        secret,
        otpauth_url: buildOtpauthUrl(user.email, secret),
      });
    }),
  );

  router.post(
    '/mfa/enroll/verify',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = validate(MfaEnrollVerifySchema, req.body);
      if (!body) return err(res, 400, 'Invalid request body');
      const userId = req.authUser!.sub;
      const user = await User.findOne({ where: { id: userId } });
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

      user.set('mfa_enabled', true);
      user.set('mfa_verified_at', new Date());
      user.set('mfa_recovery_codes_enc', encryptRecoveryCodes(hashedCodes));
      user.set('mfa_failed_count', 0);
      user.set('mfa_locked_until', null);
      await user.save();

      return res.json({ recovery_codes: plaintextCodes });
    }),
  );

  router.post(
    '/mfa/disable',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = validate(MfaDisableSchema, req.body);
      if (!body) return err(res, 400, 'Invalid request body');
      const userId = req.authUser!.sub;
      const user = await User.findOne({ where: { id: userId } });
      if (!user || !user.password_hash) {
        return err(res, 404, 'User not found');
      }
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

      user.set('mfa_enabled', false);
      user.set('mfa_secret_enc', null);
      user.set('mfa_recovery_codes_enc', null);
      user.set('mfa_verified_at', null);
      user.set('mfa_failed_count', 0);
      user.set('mfa_locked_until', null);
      await user.save();

      return res.json({ ok: true });
    }),
  );

  router.post(
    '/mfa/recovery-codes/regenerate',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = validate(MfaRegenerateSchema, req.body);
      if (!body) return err(res, 400, 'Invalid request body');
      const userId = req.authUser!.sub;
      const user = await User.findOne({ where: { id: userId } });
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
      user.set('mfa_recovery_codes_enc', encryptRecoveryCodes(hashedCodes));
      user.set('mfa_failed_count', 0);
      user.set('mfa_locked_until', null);
      await user.save();

      return res.json({ recovery_codes: plaintextCodes });
    }),
  );

  router.post(
    '/refresh',
    asyncHandler(async (req, res) => {
      const body = validate(RefreshSchema, req.body);
      if (!body) return err(res, 400, 'Invalid request body');

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
      const tokenRow = await RefreshToken.findOne({
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
        await sequelize.transaction(async (t) => {
          await RefreshToken.update(
            { revoked_at: now },
            {
              where: { session_id: tokenRow.session_id, revoked_at: null },
              transaction: t,
            },
          );
          await RefreshToken.update(
            { replay_detected_at: now },
            { where: { id: tokenRow.id }, transaction: t },
          );
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

      const freshUser = await User.findOne({
        where: { id: decoded.sub },
        attributes: ['id', 'name', 'email', 'role'],
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

      const newToken = await sequelize.transaction(async (t) => {
        const [claimed] = await RefreshToken.update(
          { revoked_at: new Date() },
          {
            where: { id: tokenRow.id, rotated_to: null, revoked_at: null },
            transaction: t,
          },
        );
        if (claimed === 0) return null;

        const created = await RefreshToken.create(
          {
            user_id: tokenRow.user_id,
            session_id: tokenRow.session_id,
            token_hash: hashRefreshToken(tokens.refresh_token),
            expires_at: newExpiresAt,
            ip_address: req.ip ?? null,
            user_agent: req.headers['user-agent'] ?? null,
          },
          { transaction: t },
        );

        await RefreshToken.update(
          { rotated_to: created.id },
          { where: { id: tokenRow.id }, transaction: t },
        );

        return created;
      });

      if (!newToken) {
        return handleReplay();
      }

      return res.json({ ...tokens, access_token: tokens.token });
    }),
  );

  router.post(
    '/logout',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.authUser?.sub;
      const parsed = LogoutSchema.safeParse(req.body);
      const sessionId =
        (parsed.success ? parsed.data?.session_id : undefined) ??
        req.authUser?.sid;
      if (!userId || !sessionId) {
        return err(res, 400, 'session_id is required');
      }

      await RefreshToken.update(
        { revoked_at: new Date() },
        {
          where: { session_id: sessionId, user_id: userId, revoked_at: null },
        },
      );

      return res.json({ status: 'ok' });
    }),
  );

  router.post(
    '/change-password',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = validate(ChangePasswordSchema, req.body);
      if (!body) return err(res, 400, 'Invalid request body');
      const userId = req.authUser!.sub;
      const user = await User.findOne({ where: { id: userId } });
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
      user.set('password_hash', password_hash);
      await user.save();

      const currentSessionId = req.authUser?.sid;
      const revokeWhere: Record<string, unknown> = {
        user_id: userId,
        revoked_at: null,
      };
      if (currentSessionId) {
        revokeWhere.session_id = { [Op.ne]: currentSessionId };
      }
      await RefreshToken.update(
        { revoked_at: new Date() },
        { where: revokeWhere },
      );

      return res.json({ status: 'ok' });
    }),
  );

  router.get(
    '/sessions',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.authUser?.sub;
      if (!userId) return err(res, 401, 'Unauthorized');
      const tokens = await RefreshToken.findAll({
        where: { user_id: userId, revoked_at: null },
        order: [['created_at', 'DESC']],
      });
      const seen = new Set<string>();
      const unique: RefreshToken[] = [];
      for (const token of tokens) {
        if (seen.has(token.session_id)) continue;
        seen.add(token.session_id);
        unique.push(token);
      }
      return res.json({
        data: unique.map((token) => ({
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
    asyncHandler(async (req, res) => {
      const body = validate(ForgotPasswordSchema, req.body);
      if (!body) return err(res, 400, 'Invalid request body');
      const user = await User.findOne({
        where: { email: body.email.toLowerCase(), deleted_at: null },
      });

      if (!user) {
        return res.json({
          message:
            'If the account exists, a password reset link has been generated.',
        });
      }

      const rawToken = `${randomUUID()}${randomUUID()}`;
      const tokenHash = hashToken(rawToken);

      await VerificationToken.create({
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

      return res.json({
        message:
          'If the account exists, a password reset link has been generated.',
      });
    }),
  );

  router.post(
    '/reset-password',
    asyncHandler(async (req, res) => {
      const body = validate(ResetPasswordSchema, req.body);
      if (!body) return err(res, 400, 'Invalid request body');

      const tokenHash = hashToken(body.token);
      const reset = await VerificationToken.findOne({
        where: {
          token_hash: tokenHash,
          kind: 'password_reset',
          consumed_at: null,
          expires_at: { [Op.gt]: new Date() },
        },
      });

      if (!reset) {
        return err(res, 400, 'Invalid or expired reset token');
      }

      const password_hash = await hashPassword(body.new_password);

      await sequelize.transaction(async (t) => {
        await User.update(
          { password_hash },
          { where: { id: reset.user_id }, transaction: t },
        );
        await VerificationToken.update(
          { consumed_at: new Date() },
          { where: { id: reset.id }, transaction: t },
        );
        await RefreshToken.update(
          { revoked_at: new Date() },
          {
            where: { user_id: reset.user_id, revoked_at: null },
            transaction: t,
          },
        );
      });

      return res.json({ status: 'ok' });
    }),
  );

  router.post(
    '/verify-email',
    asyncHandler(async (req, res) => {
      const body = validate(VerifyEmailSchema, req.body);
      if (!body) return err(res, 400, 'Invalid request body');
      const tokenHash = hashToken(body.token);

      const record = await VerificationToken.findOne({
        where: {
          token_hash: tokenHash,
          kind: 'email_verify',
          consumed_at: null,
          expires_at: { [Op.gt]: new Date() },
        },
      });

      if (!record) {
        return err(res, 400, 'Invalid or expired verification token');
      }

      await sequelize.transaction(async (t) => {
        await User.update(
          { email_verified: true },
          { where: { id: record.user_id }, transaction: t },
        );
        await VerificationToken.update(
          { consumed_at: new Date() },
          { where: { id: record.id }, transaction: t },
        );
      });

      return res.json({ verified: true });
    }),
  );

  router.post(
    '/resend-verification',
    asyncHandler(async (req, res) => {
      const body = validate(ResendVerificationSchema, req.body);
      if (!body) return err(res, 400, 'Invalid request body');
      const user = await User.findOne({
        where: { email: body.email.toLowerCase(), deleted_at: null },
      });

      if (user && !user.email_verified) {
        const rawToken = `${randomUUID()}${randomUUID()}`;
        await VerificationToken.create({
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

      return res.status(202).json({ sent: true });
    }),
  );

  router.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.authUser?.sub;
      if (!userId) return err(res, 401, 'Unauthorized');
      const user = await User.findOne({ where: { id: userId } });
      if (!user || user.deleted_at) return err(res, 404, 'User not found');
      return res.json({
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

export { ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS };
