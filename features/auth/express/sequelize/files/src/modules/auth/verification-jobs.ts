import cron, { type ScheduledTask } from 'node-cron';
import { randomUUID } from 'node:crypto';
import { Op, type Sequelize } from 'sequelize';
import { User } from '../../models/user.js';
import { RefreshToken } from '../../models/refresh-token.js';
import { VerificationToken } from '../../models/verification-token.js';
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
  _sequelize: Sequelize,
  userId: string,
  log: Logger = defaultLogger,
): Promise<{
  status: 'sent' | 'skipped_verified' | 'skipped_deleted' | 'skipped_missing';
}> {
  const user = await User.findOne({ where: { id: userId } });
  if (!user) return { status: 'skipped_missing' };
  if (user.deleted_at) return { status: 'skipped_deleted' };
  if (user.email_verified) return { status: 'skipped_verified' };

  const rawToken = `${randomUUID()}${randomUUID()}`;
  await VerificationToken.create({
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
  _sequelize: Sequelize,
  options: { now?: Date } = {},
  log: Logger = defaultLogger,
): Promise<CleanupResult> {
  const now = options.now ?? new Date();
  const revokedCutoff = new Date(
    now.getTime() - REVOKED_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const expiredVerificationTokens = await VerificationToken.destroy({
    where: {
      [Op.or]: [
        { expires_at: { [Op.lt]: now } },
        { consumed_at: { [Op.ne]: null, [Op.lt]: revokedCutoff } },
      ],
    },
  });

  const expiredRefreshTokens = await RefreshToken.destroy({
    where: {
      [Op.or]: [
        { expires_at: { [Op.lt]: now } },
        { revoked_at: { [Op.ne]: null, [Op.lt]: revokedCutoff } },
      ],
    },
  });

  if (expiredVerificationTokens > 0 || expiredRefreshTokens > 0) {
    log.info(
      {
        expiredVerificationTokens,
        expiredRefreshTokens,
      },
      '[cleanup] auth artifacts cleaned up',
    );
  }
  return {
    expiredVerificationTokens,
    expiredRefreshTokens,
  };
}

export function startVerificationJobs(
  sequelize: Sequelize,
  log: Logger = defaultLogger,
  schedule = '0 3 * * *',
): ScheduledTask {
  return cron.schedule(schedule, () => {
    cleanupAuthArtifacts(sequelize, {}, log).catch((err) => {
      log.error({ err }, '[cleanup] job failed');
    });
  });
}
