import { describe, it, expect, beforeEach, vi } from 'vitest';
import { encryptString, decryptString } from '../../src/lib/crypto.js';

describe('crypto', () => {
  it('round-trips a plaintext string', () => {
    const plaintext = 'hello-world';
    const ct = encryptString(plaintext);
    expect(ct).not.toBe(plaintext);
    expect(decryptString(ct)).toBe(plaintext);
  });

  it('produces different ciphertext for the same input (random IV)', () => {
    const a = encryptString('same-input');
    const b = encryptString('same-input');
    expect(a).not.toBe(b);
    expect(decryptString(a)).toBe('same-input');
    expect(decryptString(b)).toBe('same-input');
  });

  it('rejects tampered ciphertext (auth tag mismatch)', () => {
    const ct = encryptString('secret');
    const buf = Buffer.from(ct, 'base64');
    buf[buf.length - 1] ^= 1;
    const tampered = buf.toString('base64');
    expect(() => decryptString(tampered)).toThrow();
  });

  it('rejects ciphertext that is too short', () => {
    expect(() => decryptString(Buffer.alloc(10).toString('base64'))).toThrow(
      /too short/,
    );
  });
});

describe('crypto key resolution', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws when CRED_ENCRYPTION_KEY is unset (no silent JWT_SECRET fallback)', async () => {
    vi.stubEnv('CRED_ENCRYPTION_KEY', '');
    vi.stubEnv('JWT_SECRET', 'any-jwt-secret-value');
    const mod = await import('../../src/lib/crypto.js');
    expect(() => mod.encryptString('x')).toThrow(/CRED_ENCRYPTION_KEY/);
    vi.unstubAllEnvs();
  });

  it('rejects a CRED_ENCRYPTION_KEY that does not decode to 32 bytes', async () => {
    vi.stubEnv(
      'CRED_ENCRYPTION_KEY',
      Buffer.from('too-short').toString('base64'),
    );
    const mod = await import('../../src/lib/crypto.js');
    expect(() => mod.encryptString('x')).toThrow(/32 bytes/);
    vi.unstubAllEnvs();
  });
});
