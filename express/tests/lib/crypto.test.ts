import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = Buffer.alloc(32, 7).toString('base64');

const stub = vi.hoisted(() => ({
  config: {
    CRED_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') as
      | string
      | undefined,
  },
}));

vi.mock('../../src/config.js', () => ({
  config: stub.config,
  allowedOrigins: () => [],
}));

describe('crypto', () => {
  beforeEach(async () => {
    stub.config.CRED_ENCRYPTION_KEY = KEY;
    vi.resetModules();
  });

  it('round-trips a plaintext string', async () => {
    const { encryptString, decryptString } =
      await import('../../src/lib/crypto.js');
    const plaintext = 'hello-world';
    const ct = encryptString(plaintext);
    expect(ct).not.toBe(plaintext);
    expect(decryptString(ct)).toBe(plaintext);
  });

  it('produces different ciphertext for the same input (random IV)', async () => {
    const { encryptString, decryptString } =
      await import('../../src/lib/crypto.js');
    const a = encryptString('same-input');
    const b = encryptString('same-input');
    expect(a).not.toBe(b);
    expect(decryptString(a)).toBe('same-input');
    expect(decryptString(b)).toBe('same-input');
  });

  it('rejects tampered ciphertext (auth tag mismatch)', async () => {
    const { encryptString, decryptString } =
      await import('../../src/lib/crypto.js');
    const ct = encryptString('secret');
    const buf = Buffer.from(ct, 'base64');
    buf[buf.length - 1] ^= 1;
    const tampered = buf.toString('base64');
    expect(() => decryptString(tampered)).toThrow();
  });

  it('rejects ciphertext that is too short', async () => {
    const { decryptString } = await import('../../src/lib/crypto.js');
    expect(() => decryptString(Buffer.alloc(10).toString('base64'))).toThrow(
      /too short/,
    );
  });

  it('throws when CRED_ENCRYPTION_KEY is unset', async () => {
    stub.config.CRED_ENCRYPTION_KEY = undefined;
    const { encryptString } = await import('../../src/lib/crypto.js');
    expect(() => encryptString('x')).toThrow(/CRED_ENCRYPTION_KEY/);
  });

  it('rejects a key that does not decode to 32 bytes', async () => {
    stub.config.CRED_ENCRYPTION_KEY =
      Buffer.from('too-short').toString('base64');
    const { encryptString } = await import('../../src/lib/crypto.js');
    expect(() => encryptString('x')).toThrow(/32 bytes/);
  });
});
