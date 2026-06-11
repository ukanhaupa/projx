import express, { type Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ApiError } from "../../errors.js";
import type { PrismaLike } from "../../prisma.js";
import { requireAuth } from "../../middlewares/authenticate.js";
import { hashPassword, verifyPassword, hashToken } from "./password.js";
import {
  buildResetLink,
  buildVerificationLink,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "./mailer.js";
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
} from "./mfa.js";
import { sendInitialVerificationEmail } from "./verification-jobs.js";
import {
  hashRefreshToken,
  issueAuthSession,
  permissionsForRole,
  REFRESH_TTL_SECONDS,
  signTokens,
  signWithExpiry,
  verifyToken,
} from "./session.js";

const RESET_TOKEN_TTL_SECONDS = 30 * 60;
const VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const MFA_CHALLENGE_TTL = "5m";

const PUBLIC_RATE_LIMIT_OPTS = {
  windowMs: 60_000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
} as const;

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

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  role: string;
  email_verified: boolean;
  email_verified_at: Date | null;
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

interface UserDelegate {
  findUnique(args: {
    where: { id?: string; email?: string };
  }): Promise<UserRow | null>;
  findFirst(args: {
    where: { email?: string; deleted_at?: null };
  }): Promise<UserRow | null>;
  count(): Promise<number>;
  create(args: { data: Partial<UserRow> }): Promise<UserRow>;
  update(args: {
    where: { id: string };
    data: Partial<UserRow>;
  }): Promise<UserRow>;
}

interface RefreshTokenDelegate {
  create(args: { data: Partial<RefreshTokenRow> }): Promise<RefreshTokenRow>;
  findUnique(args: {
    where: { token_hash: string };
  }): Promise<RefreshTokenRow | null>;
  findMany(args: {
    where: { user_id: string; revoked_at: null };
    orderBy: { created_at: "desc" };
    distinct: ["session_id"];
  }): Promise<RefreshTokenRow[]>;
  updateMany(args: {
    where: Partial<RefreshTokenRow> & { NOT?: { session_id: string } };
    data: { revoked_at: Date };
  }): Promise<{ count: number }>;
  update(args: {
    where: { id: string };
    data: Partial<RefreshTokenRow>;
  }): Promise<RefreshTokenRow>;
}

interface VerificationTokenDelegate {
  create(args: {
    data: Partial<VerificationTokenRow>;
  }): Promise<VerificationTokenRow>;
  findFirst(args: {
    where: {
      token_hash: string;
      kind: string;
      consumed_at: null;
      expires_at: { gt: Date };
    };
  }): Promise<VerificationTokenRow | null>;
  update(args: {
    where: { id: string };
    data: Partial<VerificationTokenRow>;
  }): Promise<VerificationTokenRow>;
}

type AuthPrismaClient = PrismaLike & {
  user: UserDelegate;
  refreshToken: RefreshTokenDelegate;
  verificationToken: VerificationTokenDelegate;
  $transaction<P extends readonly Promise<unknown>[]>(
    arg: [...P],
  ): Promise<{ [K in keyof P]: Awaited<P[K]> }>;
};

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

const MfaRecoveryRegenerateSchema = z.object({
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

function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first.path.join(".");
    const detail = path ? `${path}: ${first.message}` : first.message;
    throw new ApiError(400, detail, "validation_error");
  }
  return parsed.data;
}

function signMfaChallenge(user: UserRow): string {
  return signWithExpiry(
    { sub: user.id, stage: "mfa_pending" },
    MFA_CHALLENGE_TTL,
  );
}

async function recordMfaFailure(
  prisma: AuthPrismaClient,
  user: UserRow,
): Promise<void> {
  const nextCount = user.mfa_failed_count + 1;
  const data: { mfa_failed_count: number; mfa_locked_until?: Date } = {
    mfa_failed_count: nextCount,
  };
  if (nextCount >= MFA_MAX_ATTEMPTS) {
    data.mfa_locked_until = new Date(Date.now() + MFA_LOCKOUT_MS);
  }
  await prisma.user.update({ where: { id: user.id }, data });
}

async function resetMfaCounters(
  prisma: AuthPrismaClient,
  userId: string,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { mfa_failed_count: 0, mfa_locked_until: null },
  });
}

export function authRouter(prisma: PrismaLike): Router {
  const router = express.Router();
  const db = prisma as AuthPrismaClient;
  const publicRateLimit = rateLimit(PUBLIC_RATE_LIMIT_OPTS);
  const resendVerificationRateLimit = rateLimit({
    windowMs: 60 * 60_000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => {
      const body = (req.body ?? {}) as { email?: string };
      const email = (body.email ?? "").toLowerCase();
      if (email) return email;
      return ipKeyGenerator(req.ip ?? "unknown");
    },
  });

  router.post("/signup", publicRateLimit, async (req, res, next) => {
    try {
      const body = parseOrThrow(SignupSchema, req.body);
      const normalizedEmail = body.email.toLowerCase();
      const existing = await db.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (existing) {
        throw new ApiError(
          409,
          "An account with this email already exists.",
          "duplicate_email",
        );
      }
      const passwordHash = await hashPassword(body.password);
      const isFirstUser = (await db.user.count()) === 0;
      const user = await db.user.create({
        data: {
          email: normalizedEmail,
          name: body.name,
          password_hash: passwordHash,
          role: isFirstUser ? "admin" : "user",
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
      const tokens = signTokens(payload);
      const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

      await db.refreshToken.create({
        data: {
          user_id: user.id,
          session_id: sessionId,
          token_hash: hashRefreshToken(tokens.refresh_token),
          expires_at: expiresAt,
          ip_address: req.ip ?? null,
          user_agent: req.headers["user-agent"] ?? null,
        },
      });

      try {
        await sendInitialVerificationEmail(db, user.id);
      } catch (e) {
        req.log?.error?.(
          { err: e, userId: user.id },
          "Failed to send initial verification email",
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
    } catch (err) {
      next(err);
    }
  });

  router.post("/login", publicRateLimit, async (req, res, next) => {
    try {
      const body = parseOrThrow(LoginSchema, req.body);
      const normalizedEmail = body.email.toLowerCase();
      const user = await db.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (user?.locked_until && user.locked_until.getTime() > Date.now()) {
        const mins = Math.ceil(
          (user.locked_until.getTime() - Date.now()) / 60_000,
        );
        throw new ApiError(
          429,
          `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
          "account_locked",
        );
      }

      if (!user || !user.password_hash) {
        throw new ApiError(401, "Invalid credentials", "invalid_credentials");
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
        await db.user.update({ where: { id: user.id }, data: lockData });
        throw new ApiError(401, "Invalid credentials", "invalid_credentials");
      }

      const freshUser = await db.user.update({
        where: { id: user.id },
        data: {
          last_login: new Date(),
          failed_login_count: 0,
          locked_until: null,
        },
      });

      if (freshUser.mfa_enabled) {
        if (isMfaLocked(freshUser.mfa_locked_until)) {
          const mins = Math.ceil(
            (freshUser.mfa_locked_until!.getTime() - Date.now()) / 60_000,
          );
          throw new ApiError(
            429,
            `MFA temporarily locked. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
            "mfa_locked",
          );
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
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/mfa/verify-challenge",
    publicRateLimit,
    async (req, res, next) => {
      try {
        const body = parseOrThrow(MfaVerifyChallengeSchema, req.body);

        let decoded: MfaChallengePayload;
        try {
          decoded = verifyToken<MfaChallengePayload>(body.challenge_token);
        } catch {
          throw new ApiError(
            401,
            "Challenge token invalid or expired",
            "invalid_challenge",
          );
        }
        if (decoded.stage !== "mfa_pending" || !decoded.sub) {
          throw new ApiError(
            401,
            "Challenge token invalid",
            "invalid_challenge",
          );
        }

        const user = await db.user.findUnique({ where: { id: decoded.sub } });
        if (!user || !user.mfa_enabled || !user.mfa_secret_enc) {
          throw new ApiError(401, "MFA not configured", "mfa_not_configured");
        }
        if (isMfaLocked(user.mfa_locked_until)) {
          const mins = Math.ceil(
            (user.mfa_locked_until!.getTime() - Date.now()) / 60_000,
          );
          throw new ApiError(
            429,
            `MFA temporarily locked. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
            "mfa_locked",
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
          await recordMfaFailure(db, user);
          throw new ApiError(401, "Invalid MFA code", "invalid_mfa_code");
        }

        if (consumedRecoveryIndex >= 0) {
          const hashes = decryptRecoveryCodes(user.mfa_recovery_codes_enc);
          hashes.splice(consumedRecoveryIndex, 1);
          await db.user.update({
            where: { id: user.id },
            data: {
              mfa_recovery_codes_enc: encryptRecoveryCodes(hashes),
              mfa_failed_count: 0,
              mfa_locked_until: null,
            },
          });
        } else {
          await resetMfaCounters(db, user.id);
        }

        const session = await issueAuthSession(db, user, req);
        res.json(session);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post("/mfa/enroll", requireAuth, async (req, res, next) => {
    try {
      const userId = req.authUser!.sub;
      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user) throw new ApiError(404, "User not found", "not_found");
      if (user.mfa_enabled) {
        throw new ApiError(
          409,
          "MFA is already enabled. Disable it first to re-enroll.",
          "mfa_already_enabled",
        );
      }

      const secret = generateSecret();
      await db.user.update({
        where: { id: userId },
        data: {
          mfa_secret_enc: encryptSecret(secret),
          mfa_verified_at: null,
        },
      });

      res.json({
        secret,
        otpauth_url: buildOtpauthUrl(user.email, secret),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/mfa/enroll/verify", requireAuth, async (req, res, next) => {
    try {
      const body = parseOrThrow(MfaEnrollVerifySchema, req.body);
      const userId = req.authUser!.sub;
      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user || !user.mfa_secret_enc) {
        throw new ApiError(
          400,
          "No pending MFA enrollment. Start enrollment first.",
          "no_mfa_enrollment",
        );
      }
      if (user.mfa_enabled) {
        throw new ApiError(
          409,
          "MFA is already enabled.",
          "mfa_already_enabled",
        );
      }

      const valid = verifyTotp(body.code, decryptSecret(user.mfa_secret_enc));
      if (!valid) {
        throw new ApiError(
          400,
          "Invalid code. Scan the QR and try again.",
          "invalid_mfa_code",
        );
      }

      const plaintextCodes = generateRecoveryCodes();
      const hashedCodes = await hashRecoveryCodes(plaintextCodes);

      await db.user.update({
        where: { id: userId },
        data: {
          mfa_enabled: true,
          mfa_verified_at: new Date(),
          mfa_recovery_codes_enc: encryptRecoveryCodes(hashedCodes),
          mfa_failed_count: 0,
          mfa_locked_until: null,
        },
      });

      res.json({ recovery_codes: plaintextCodes });
    } catch (err) {
      next(err);
    }
  });

  router.post("/mfa/disable", requireAuth, async (req, res, next) => {
    try {
      const body = parseOrThrow(MfaDisableSchema, req.body);
      const userId = req.authUser!.sub;
      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user || !user.password_hash) {
        throw new ApiError(404, "User not found", "not_found");
      }
      if (!user.mfa_enabled || !user.mfa_secret_enc) {
        throw new ApiError(400, "MFA is not enabled.", "mfa_not_enabled");
      }

      const passwordOk = await verifyPassword(
        body.password,
        user.password_hash,
      );
      if (!passwordOk) {
        throw new ApiError(400, "Invalid password", "invalid_password");
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
        throw new ApiError(400, "Invalid MFA code", "invalid_mfa_code");
      }

      await db.user.update({
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

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/mfa/recovery-codes/regenerate",
    requireAuth,
    async (req, res, next) => {
      try {
        const body = parseOrThrow(MfaRecoveryRegenerateSchema, req.body);
        const userId = req.authUser!.sub;
        const user = await db.user.findUnique({ where: { id: userId } });
        if (!user || !user.mfa_enabled || !user.mfa_secret_enc) {
          throw new ApiError(400, "MFA is not enabled.", "mfa_not_enabled");
        }
        if (isMfaLocked(user.mfa_locked_until)) {
          throw new ApiError(429, "MFA temporarily locked.", "mfa_locked");
        }

        if (!verifyTotp(body.code, decryptSecret(user.mfa_secret_enc))) {
          await recordMfaFailure(db, user);
          throw new ApiError(400, "Invalid MFA code", "invalid_mfa_code");
        }

        const plaintextCodes = generateRecoveryCodes();
        const hashedCodes = await hashRecoveryCodes(plaintextCodes);
        await db.user.update({
          where: { id: userId },
          data: {
            mfa_recovery_codes_enc: encryptRecoveryCodes(hashedCodes),
            mfa_failed_count: 0,
            mfa_locked_until: null,
          },
        });

        res.json({ recovery_codes: plaintextCodes });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post("/refresh", async (req, res, next) => {
    try {
      const body = parseOrThrow(RefreshSchema, req.body);
      let decoded: RefreshTokenPayload;
      try {
        decoded = verifyToken<RefreshTokenPayload>(body.refresh_token);
      } catch {
        throw new ApiError(401, "Unauthorized", "unauthorized");
      }
      if (decoded.token_type !== "refresh") {
        throw new ApiError(401, "Unauthorized", "unauthorized");
      }
      if (
        !decoded.sid ||
        !decoded.sub ||
        !decoded.email ||
        !decoded.role ||
        !decoded.jti
      ) {
        throw new ApiError(401, "Unauthorized", "unauthorized");
      }

      const presentedHash = hashRefreshToken(body.refresh_token);
      const tokenRow = await db.refreshToken.findUnique({
        where: { token_hash: presentedHash },
      });

      if (
        !tokenRow ||
        tokenRow.session_id !== decoded.sid ||
        tokenRow.user_id !== decoded.sub
      ) {
        throw new ApiError(401, "Unauthorized", "unauthorized");
      }

      const handleReplay = async (): Promise<never> => {
        const now = new Date();
        await db.$transaction([
          db.refreshToken.updateMany({
            where: { session_id: tokenRow.session_id, revoked_at: null },
            data: { revoked_at: now },
          }),
          db.refreshToken.update({
            where: { id: tokenRow.id },
            data: { replay_detected_at: now },
          }),
        ]);
        req.log?.warn?.(
          {
            session_id: tokenRow.session_id,
            user_id: tokenRow.user_id,
            token_id: tokenRow.id,
          },
          "refresh_token_replay_detected",
        );
        throw new ApiError(
          401,
          "token_replay_detected",
          "token_replay_detected",
        );
      };

      if (tokenRow.rotated_to != null || tokenRow.revoked_at != null) {
        await handleReplay();
      }

      if (tokenRow.expires_at.getTime() < Date.now()) {
        throw new ApiError(401, "Unauthorized", "unauthorized");
      }

      const freshUser = await db.user.findUnique({
        where: { id: decoded.sub },
      });
      if (!freshUser) {
        throw new ApiError(401, "Unauthorized", "unauthorized");
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

      const claimed = await db.refreshToken.updateMany({
        where: { id: tokenRow.id, rotated_to: null, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      if (claimed.count === 0) {
        await handleReplay();
      }

      const newToken = await db.refreshToken.create({
        data: {
          user_id: tokenRow.user_id,
          session_id: tokenRow.session_id,
          token_hash: hashRefreshToken(tokens.refresh_token),
          expires_at: newExpiresAt,
          ip_address: req.ip ?? null,
          user_agent: req.headers["user-agent"] ?? null,
        },
      });

      await db.refreshToken.update({
        where: { id: tokenRow.id },
        data: { rotated_to: newToken.id },
      });

      res.json({ ...tokens, access_token: tokens.token });
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", requireAuth, async (req, res, next) => {
    try {
      const userId = req.authUser?.sub;
      const parsed = LogoutSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ApiError(
          400,
          parsed.error.issues[0].message,
          "validation_error",
        );
      }
      const body = parsed.data ?? {};
      const sessionId =
        body.session_id ??
        (typeof req.authUser?.sid === "string" ? req.authUser.sid : undefined);
      if (!userId || !sessionId) {
        throw new ApiError(
          400,
          "session_id is required",
          "session_id_required",
        );
      }

      await db.refreshToken.updateMany({
        where: { session_id: sessionId, user_id: userId, revoked_at: null },
        data: { revoked_at: new Date() },
      });

      res.json({ status: "ok" });
    } catch (err) {
      next(err);
    }
  });

  router.post("/change-password", requireAuth, async (req, res, next) => {
    try {
      const body = parseOrThrow(ChangePasswordSchema, req.body);
      const userId = req.authUser!.sub;
      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user || !user.password_hash) {
        throw new ApiError(404, "User not found", "not_found");
      }

      const ok = await verifyPassword(
        body.current_password,
        user.password_hash,
      );
      if (!ok) {
        throw new ApiError(400, "Invalid password", "invalid_password");
      }

      const password_hash = await hashPassword(body.new_password);
      await db.user.update({ where: { id: userId }, data: { password_hash } });

      const currentSessionId =
        typeof req.authUser?.sid === "string" ? req.authUser.sid : undefined;
      await db.refreshToken.updateMany({
        where: {
          user_id: userId,
          revoked_at: null,
          ...(currentSessionId
            ? { NOT: { session_id: currentSessionId } }
            : {}),
        },
        data: { revoked_at: new Date() },
      });

      res.json({ status: "ok" });
    } catch (err) {
      next(err);
    }
  });

  router.get("/sessions", requireAuth, async (req, res, next) => {
    try {
      const userId = req.authUser?.sub;
      if (!userId) throw new ApiError(401, "Unauthorized", "unauthorized");
      const tokens = await db.refreshToken.findMany({
        where: { user_id: userId, revoked_at: null },
        orderBy: { created_at: "desc" },
        distinct: ["session_id"],
      });
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
    } catch (err) {
      next(err);
    }
  });

  router.post("/forgot-password", publicRateLimit, async (req, res, next) => {
    try {
      const body = parseOrThrow(ForgotPasswordSchema, req.body);
      const user = await db.user.findFirst({
        where: { email: body.email.toLowerCase(), deleted_at: null },
      });

      if (!user) {
        res.json({
          message:
            "If the account exists, a password reset link has been generated.",
        });
        return;
      }

      const rawToken = `${randomUUID()}${randomUUID()}`;
      const tokenHash = hashToken(rawToken);

      await db.verificationToken.create({
        data: {
          user_id: user.id,
          token_hash: tokenHash,
          kind: "password_reset",
          expires_at: new Date(Date.now() + RESET_TOKEN_TTL_SECONDS * 1000),
        },
      });

      const resetLink = buildResetLink(rawToken);
      try {
        const sent = await sendPasswordResetEmail(user.email, resetLink);
        if (!sent) {
          req.log?.warn?.("SMTP is not configured; reset email was not sent.");
        }
      } catch (e) {
        req.log?.error?.(
          { err: e },
          "Failed to send password reset email via SMTP",
        );
      }

      res.json({
        message:
          "If the account exists, a password reset link has been generated.",
        ...(process.env.AUTH_EXPOSE_RESET_TOKEN === "true"
          ? { reset_token: rawToken }
          : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/reset-password", async (req, res, next) => {
    try {
      const body = parseOrThrow(ResetPasswordSchema, req.body);
      const tokenHash = hashToken(body.token);
      const reset = await db.verificationToken.findFirst({
        where: {
          token_hash: tokenHash,
          kind: "password_reset",
          consumed_at: null,
          expires_at: { gt: new Date() },
        },
      });

      if (!reset) {
        throw new ApiError(
          400,
          "Invalid or expired reset token",
          "invalid_reset_token",
        );
      }

      const password_hash = await hashPassword(body.new_password);

      await db.$transaction([
        db.user.update({
          where: { id: reset.user_id },
          data: { password_hash },
        }),
        db.verificationToken.update({
          where: { id: reset.id },
          data: { consumed_at: new Date() },
        }),
        db.refreshToken.updateMany({
          where: { user_id: reset.user_id, revoked_at: null },
          data: { revoked_at: new Date() },
        }),
      ]);

      res.json({ status: "ok" });
    } catch (err) {
      next(err);
    }
  });

  router.post("/verify-email", async (req, res, next) => {
    try {
      const body = parseOrThrow(VerifyEmailSchema, req.body);
      const tokenHash = hashToken(body.token);

      const record = await db.verificationToken.findFirst({
        where: {
          token_hash: tokenHash,
          kind: "email_verify",
          consumed_at: null,
          expires_at: { gt: new Date() },
        },
      });

      if (!record) {
        throw new ApiError(
          400,
          "Invalid or expired verification token",
          "invalid_verification_token",
        );
      }

      await db.$transaction([
        db.user.update({
          where: { id: record.user_id },
          data: { email_verified: true },
        }),
        db.verificationToken.update({
          where: { id: record.id },
          data: { consumed_at: new Date() },
        }),
      ]);

      res.json({ verified: true });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/resend-verification",
    resendVerificationRateLimit,
    async (req, res, next) => {
      try {
        const body = parseOrThrow(ResendVerificationSchema, req.body);
        const user = await db.user.findFirst({
          where: { email: body.email.toLowerCase(), deleted_at: null },
        });

        if (user && !user.email_verified) {
          const rawToken = `${randomUUID()}${randomUUID()}`;
          await db.verificationToken.create({
            data: {
              user_id: user.id,
              token_hash: hashToken(rawToken),
              kind: "email_verify",
              expires_at: new Date(
                Date.now() + VERIFICATION_TOKEN_TTL_SECONDS * 1000,
              ),
            },
          });

          const link = buildVerificationLink(rawToken);
          try {
            const sent = await sendVerificationEmail(user.email, link);
            if (!sent) {
              req.log?.warn?.(
                "SMTP is not configured; verification email was not sent.",
              );
            }
          } catch (e) {
            req.log?.error?.(
              { err: e },
              "Failed to send verification email via SMTP",
            );
          }
        }

        res.status(202).json({ sent: true });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get("/me", requireAuth, async (req, res, next) => {
    try {
      const userId = req.authUser?.sub;
      if (!userId) throw new ApiError(401, "Unauthorized", "unauthorized");
      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user || user.deleted_at)
        throw new ApiError(404, "User not found", "not_found");
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
    } catch (err) {
      next(err);
    }
  });

  return router;
}
