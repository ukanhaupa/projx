import cron, { type ScheduledTask } from 'node-cron';
import { randomUUID } from 'node:crypto';
import type { ExtendedPrismaClient } from '../../plugins/prisma.js';
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
  prisma: ExtendedPrismaClient,
  userId: string,
  log: Logger = defaultLogger,
): Promise<{ status: 'sent' | 'skipped_verified' | 'skipped_deleted' | 'skipped_missing' }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { status: 'skipped_missing' };
  if (user.deleted_at) return { status: 'skipped_deleted' };
  if (user.email_verified) return { status: 'skipped_verified' };

  const rawToken = `${randomUUID()}${randomUUID()}`;
  await prisma.verificationToken.create({
    data: {
      user_id: user.id,
      kind: 'email_verify',
      token_hash: hashToken(rawToken),
      expires_at: new Date(Date.now() + VERIFICATION_TOKEN_TTL_SECONDS * 1000),
    },
  });

  const link = buildVerificationLink(rawToken);
  try {
    const sent = await sendVerificationEmail(user.email, link);
    if (!sent) {
      log.warn({ userId: user.id }, '[verification] SMTP not configured; email logged only');
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
  prisma: ExtendedPrismaClient,
  options: { now?: Date } = {},
  log: Logger = defaultLogger,
): Promise<CleanupResult> {
  const now = options.now ?? new Date();
  const revokedCutoff = new Date(now.getTime() - REVOKED_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const expiredVerificationTokens = await prisma.verificationToken.deleteMany({
    where: {
      OR: [
        { expires_at: { lt: now } },
        { consumed_at: { not: null, lt: revokedCutoff } },
      ],
    },
  });

  const expiredRefreshTokens = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expires_at: { lt: now } },
        { revoked_at: { not: null, lt: revokedCutoff } },
      ],
    },
  });

  if (expiredVerificationTokens.count > 0 || expiredRefreshTokens.count > 0) {
    log.info(
      {
        expiredVerificationTokens: expiredVerificationTokens.count,
        expiredRefreshTokens: expiredRefreshTokens.count,
      },
      '[cleanup] auth artifacts cleaned up',
    );
  }
  return {
    expiredVerificationTokens: expiredVerificationTokens.count,
    expiredRefreshTokens: expiredRefreshTokens.count,
  };
}

export function startVerificationJobs(
  prisma: ExtendedPrismaClient,
  log: Logger = defaultLogger,
  schedule = '0 3 * * *',
): ScheduledTask {
  return cron.schedule(schedule, () => {
    cleanupAuthArtifacts(prisma, {}, log).catch((err) => {
      log.error({ err }, '[cleanup] job failed');
    });
  });
}
