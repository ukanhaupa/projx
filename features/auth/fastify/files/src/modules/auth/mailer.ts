import nodemailer from 'nodemailer';
import type { ExtendedPrismaClient } from '../../plugins/prisma.js';
import { getServiceConfig } from '../../lib/service-config.js';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  [key: string]: unknown;
}

interface Logger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

let smtpConfig: SmtpConfig | null = null;
let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
let mailWarned = false;
let log: Logger = console;

export async function initMailer(prisma: ExtendedPrismaClient, logger?: Logger): Promise<void> {
  if (logger) log = logger;
  const dbConfig = await getServiceConfig<SmtpConfig>(prisma, 'smtp');
  if (!dbConfig || !dbConfig.host) {
    log.warn('[mailer] no SMTP configured in service_configs — emails will be logged');
    return;
  }
  smtpConfig = dbConfig;
  transporter = nodemailer.createTransport({
    host: dbConfig.host,
    port: dbConfig.port ?? 587,
    secure: dbConfig.secure ?? false,
    auth: dbConfig.user && dbConfig.pass ? { user: dbConfig.user, pass: dbConfig.pass } : undefined,
  });
  log.info(`[mailer] SMTP configured (${dbConfig.host})`);
}

function getSmtpFrom(): string {
  return smtpConfig?.from || `noreply@${new URL(FRONTEND_URL).hostname}`;
}

function getTransporter() {
  if (!transporter && !mailWarned) {
    mailWarned = true;
    log.warn('[mailer] transporter not initialized — call initMailer() at startup');
  }
  return transporter;
}

function logEmail(to: string, subject: string, link: string) {
  log.info(`[mailer:dev] To: ${to} | Subject: ${subject} | Link: ${link}`);
}

type SendMailInfo = { messageId?: string; response?: string };

async function sendAndLog(
  tx: NonNullable<ReturnType<typeof getTransporter>>,
  to: string,
  subject: string,
  mail: Parameters<typeof tx.sendMail>[0],
): Promise<boolean> {
  try {
    const info = (await tx.sendMail(mail)) as SendMailInfo;
    log.info(
      `[mailer] sent | to=${to} | subject=${subject} | messageId=${info.messageId ?? 'n/a'}`,
    );
    return true;
  } catch (err) {
    log.error({ err, to, subject }, '[mailer] send failed');
    return false;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type EscapeValue = (value: string) => string;

interface EmailTemplate<K extends string> {
  source: string;
  keys: readonly K[];
}

export function extractTemplateVars(source: string): string[] {
  return [...new Set([...source.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].map((m) => m[1]))];
}

export function assertTemplateVars(source: string, keys: readonly string[]): void {
  const templateVars = extractTemplateVars(source);
  const missing = templateVars.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !templateVars.includes(key));
  if (missing.length || extra.length) {
    const parts = [];
    if (missing.length) parts.push(`missing keys: ${missing.join(', ')}`);
    if (extra.length) parts.push(`extra keys: ${extra.join(', ')}`);
    throw new Error(`Mailer template variable drift: ${parts.join('; ')}`);
  }
}

export function defineTemplate<const K extends string>(
  source: string,
  keys: readonly K[],
): EmailTemplate<K> {
  assertTemplateVars(source, keys);
  return { source, keys };
}

export function renderTemplate<const K extends string>(
  template: EmailTemplate<K>,
  data: Record<K, string>,
  escapeValue: EscapeValue = escapeHtml,
): string {
  const dataKeys = Object.keys(data);
  const missing = template.keys.filter((key) => !Object.prototype.hasOwnProperty.call(data, key));
  const extra = dataKeys.filter((key) => !template.keys.includes(key as K));
  if (missing.length || extra.length) {
    const parts = [];
    if (missing.length) parts.push(`missing values: ${missing.join(', ')}`);
    if (extra.length) parts.push(`extra values: ${extra.join(', ')}`);
    throw new Error(`Mailer render variable drift: ${parts.join('; ')}`);
  }
  return template.source.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, key: K) =>
    escapeValue(data[key]),
  );
}

const EMAIL_HTML_TEMPLATE = defineTemplate(
  `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:24px auto;padding:24px;color:#222;">
  <h2 style="margin-top:0;">{{title}}</h2>
  <p>{{message}}</p>
  <p><a href="{{actionUrl}}" style="display:inline-block;padding:10px 20px;background:#0a66c2;color:#fff;text-decoration:none;border-radius:4px;">{{actionLabel}}</a></p>
  <p style="font-size:12px;color:#888;margin-top:24px;">If the button doesn't work, paste this link: {{actionUrl}}</p>
</body></html>`,
  ['title', 'message', 'actionUrl', 'actionLabel'],
);

const PASSWORD_RESET_TEXT_TEMPLATE = defineTemplate(
  `Reset your password using this link (expires in 30 minutes):

{{resetLink}}

If you didn't request this, ignore this email.`,
  ['resetLink'],
);

const VERIFICATION_TEXT_TEMPLATE = defineTemplate(
  `Confirm your email by visiting this link (expires in 24 hours):

{{verificationLink}}

If you didn't create this account, ignore this email.`,
  ['verificationLink'],
);

function renderEmail(title: string, message: string, actionLabel: string, actionUrl: string): string {
  return renderTemplate(EMAIL_HTML_TEMPLATE, { title, message, actionLabel, actionUrl });
}

export function buildResetLink(token: string): string {
  const base = FRONTEND_URL.replace(/\/$/, '');
  const url = new URL('/reset-password', `${base}/`);
  url.searchParams.set('token', token);
  return url.toString();
}

export function buildVerificationLink(token: string): string {
  const base = FRONTEND_URL.replace(/\/$/, '');
  const url = new URL('/verify-email', `${base}/`);
  url.searchParams.set('token', token);
  return url.toString();
}

export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<boolean> {
  const tx = getTransporter();
  if (!tx) {
    logEmail(to, 'Password reset', resetLink);
    return true;
  }
  const subject = 'Reset your password';
  return sendAndLog(tx, to, subject, {
    from: getSmtpFrom(),
    to,
    subject,
    text: renderTemplate(PASSWORD_RESET_TEXT_TEMPLATE, { resetLink }, (value) => value),
    html: renderEmail(
      'Reset your password',
      "Click the button below to set a new password. This link expires in 30 minutes. If you didn't request this, ignore this email.",
      'Reset password',
      resetLink,
    ),
  });
}

export async function sendVerificationEmail(to: string, verificationLink: string): Promise<boolean> {
  const tx = getTransporter();
  if (!tx) {
    logEmail(to, 'Email verification', verificationLink);
    return true;
  }
  const subject = 'Verify your email';
  return sendAndLog(tx, to, subject, {
    from: getSmtpFrom(),
    to,
    subject,
    text: renderTemplate(VERIFICATION_TEXT_TEMPLATE, { verificationLink }, (value) => value),
    html: renderEmail(
      'Verify your email',
      "Click the button below to confirm your email address. This link expires in 24 hours. If you didn't create this account, ignore this email.",
      'Verify email',
      verificationLink,
    ),
  });
}
