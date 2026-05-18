import cron, { type ScheduledTask } from 'node-cron';
import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull, lt, or } from 'drizzle-orm';
import type { DbClient } from '../../db/client.js';
import { refreshTokens, users, verificationTokens } from '../../db/schema.js';
import { hashToken } from './password.js';
import { buildVerificationLink, sendVerificationEmail } from './mailer.js';

const VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const REVOKED_RETENTION_DAYS = 30;

export interface Logger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

const defaultLogger: Logger = {
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

export async function sendInitialVerificationEmail(
  db: DbClient,
  userId: string,
  log: Logger = defaultLogger,
): Promise<{
  status: 'sent' | 'skipped_verified' | 'skipped_deleted' | 'skipped_missing';
}> {
  const user = (
    await db.select().from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  if (!user) return { status: 'skipped_missing' };
  if (user.deleted_at) return { status: 'skipped_deleted' };
  if (user.email_verified) return { status: 'skipped_verified' };

  const rawToken = `${randomUUID()}${randomUUID()}`;
  await db.insert(verificationTokens).values({
    user_id: user.id,
    kind: 'email_verify',
    token_hash: hashToken(rawToken),
    expires_at: new Date(Date.now() + VERIFICATION_TOKEN_TTL_SECONDS * 1000),
  });

  const link = buildVerificationLink(rawToken);
  try {
    const sent = await sendVerificationEmail(user.email, link);
    if (!sent) {
      log.warn(
        { userId: user.id },
        '[verification] SMTP not configured; email logged only',
      );
    }
  } catch (err) {
    log.error({ err, userId: user.id }, '[verification] send failed');
  }
  return { status: 'sent' };
}

export interface CleanupResult {
  expiredVerificationTokens: number;
  expiredRefreshTokens: number;
}

export async function cleanupAuthArtifacts(
  db: DbClient,
  options: { now?: Date } = {},
  log: Logger = defaultLogger,
): Promise<CleanupResult> {
  const now = options.now ?? new Date();
  const revokedCutoff = new Date(
    now.getTime() - REVOKED_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const deletedVerification = await db
    .delete(verificationTokens)
    .where(
      or(
        lt(verificationTokens.expires_at, now),
        and(
          isNotNull(verificationTokens.consumed_at),
          lt(verificationTokens.consumed_at, revokedCutoff),
        ),
      ),
    )
    .returning({ id: verificationTokens.id });

  const deletedRefresh = await db
    .delete(refreshTokens)
    .where(
      or(
        lt(refreshTokens.expires_at, now),
        and(
          isNotNull(refreshTokens.revoked_at),
          lt(refreshTokens.revoked_at, revokedCutoff),
        ),
      ),
    )
    .returning({ id: refreshTokens.id });

  const expiredVerificationTokens = deletedVerification.length;
  const expiredRefreshTokens = deletedRefresh.length;

  if (expiredVerificationTokens > 0 || expiredRefreshTokens > 0) {
    log.info(
      { expiredVerificationTokens, expiredRefreshTokens },
      '[cleanup] auth artifacts cleaned up',
    );
  }
  return { expiredVerificationTokens, expiredRefreshTokens };
}

export function startVerificationJobs(
  db: DbClient,
  log: Logger = defaultLogger,
  schedule = '0 3 * * *',
): ScheduledTask {
  return cron.schedule(schedule, () => {
    cleanupAuthArtifacts(db, {}, log).catch((err) => {
      log.error({ err }, '[cleanup] job failed');
    });
  });
}
