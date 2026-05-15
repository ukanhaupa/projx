import { randomInt } from 'node:crypto';
import { authenticator } from 'otplib';
import { encryptString, decryptString } from '../../lib/crypto.js';
import { hashPassword, verifyPassword } from './password.js';

const ISSUER = process.env.MFA_ISSUER ?? 'projx';
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOTP_WINDOW = 3;

authenticator.options = { window: TOTP_WINDOW };

export function generateSecret(): string {
  return authenticator.generateSecret(20);
}

export function buildOtpauthUrl(email: string, secret: string): string {
  return authenticator.keyuri(email, ISSUER, secret);
}

export function verifyTotp(code: string, secret: string): boolean {
  return authenticator.verify({ token: code.trim(), secret });
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    codes.push(`${pickChars(4)}-${pickChars(4)}`);
  }
  return codes;
}

function pickChars(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const idx = randomInt(RECOVERY_CODE_ALPHABET.length);
    out += RECOVERY_CODE_ALPHABET[idx];
  }
  return out;
}

function denormalize(code: string): string {
  const stripped = code.trim().toUpperCase().replace(/\s+/g, '').replace(/-/g, '');
  return `${stripped.slice(0, 4)}-${stripped.slice(4)}`;
}

export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => hashPassword(denormalize(code))));
}

export async function matchRecoveryCode(input: string, hashes: string[]): Promise<number> {
  const normalized = denormalize(input);
  for (let i = 0; i < hashes.length; i += 1) {
    if (await verifyPassword(normalized, hashes[i])) return i;
  }
  return -1;
}

export function encryptRecoveryCodes(hashes: string[]): string {
  return encryptString(JSON.stringify(hashes));
}

export function decryptRecoveryCodes(enc: string | null | undefined): string[] {
  if (!enc) return [];
  try {
    const parsed = JSON.parse(decryptString(enc)) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function encryptSecret(secret: string): string {
  return encryptString(secret);
}

export function decryptSecret(enc: string): string {
  return decryptString(enc);
}

export function isMfaLocked(lockedUntil: Date | null | undefined): boolean {
  if (!lockedUntil) return false;
  return lockedUntil.getTime() > Date.now();
}

export const MFA_MAX_ATTEMPTS = 5;
export const MFA_LOCKOUT_MS = 15 * 60 * 1000;
