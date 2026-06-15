import { describe, it, expect } from 'vitest';
import {
  parseRustVersion,
  isRustVersionSupported,
  parsePhpVersion,
  isPhpVersionSupported,
  parseComposerVersion,
} from '../src/doctor.js';

describe('parseRustVersion', () => {
  it('parses standard rustc output', () => {
    expect(parseRustVersion('rustc 1.83.0 (90b35a623 2024-11-26)')).toBe(
      '1.83.0',
    );
  });

  it('parses version without trailing metadata', () => {
    expect(parseRustVersion('rustc 1.90.1')).toBe('1.90.1');
  });

  it('returns null on malformed input', () => {
    expect(parseRustVersion('not rust')).toBeNull();
    expect(parseRustVersion('rustc beta')).toBeNull();
    expect(parseRustVersion('')).toBeNull();
  });
});

describe('isRustVersionSupported', () => {
  it('accepts >= 1.83.0', () => {
    expect(isRustVersionSupported('1.83.0')).toBe(true);
    expect(isRustVersionSupported('1.83.1')).toBe(true);
    expect(isRustVersionSupported('1.90.0')).toBe(true);
    expect(isRustVersionSupported('2.0.0')).toBe(true);
  });

  it('rejects < 1.83.0', () => {
    expect(isRustVersionSupported('1.82.9')).toBe(false);
    expect(isRustVersionSupported('1.70.0')).toBe(false);
    expect(isRustVersionSupported('0.99.0')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isRustVersionSupported('beta')).toBe(false);
    expect(isRustVersionSupported('')).toBe(false);
  });
});

describe('parsePhpVersion', () => {
  it('parses standard PHP CLI output', () => {
    expect(
      parsePhpVersion('PHP 8.3.10 (cli) (built: Jul 19 2024 12:00:00)'),
    ).toBe('8.3.10');
  });

  it('parses minimal PHP output', () => {
    expect(parsePhpVersion('PHP 8.4.0')).toBe('8.4.0');
  });

  it('returns null on malformed input', () => {
    expect(parsePhpVersion('Python 3.11.0')).toBeNull();
    expect(parsePhpVersion('PHP beta')).toBeNull();
    expect(parsePhpVersion('')).toBeNull();
  });
});

describe('isPhpVersionSupported', () => {
  it('accepts >= 8.3.0', () => {
    expect(isPhpVersionSupported('8.3.0')).toBe(true);
    expect(isPhpVersionSupported('8.3.10')).toBe(true);
    expect(isPhpVersionSupported('8.4.0')).toBe(true);
    expect(isPhpVersionSupported('9.0.0')).toBe(true);
  });

  it('rejects < 8.3.0', () => {
    expect(isPhpVersionSupported('8.2.99')).toBe(false);
    expect(isPhpVersionSupported('8.1.0')).toBe(false);
    expect(isPhpVersionSupported('7.4.0')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isPhpVersionSupported('rc1')).toBe(false);
    expect(isPhpVersionSupported('')).toBe(false);
  });
});

describe('parseComposerVersion', () => {
  it('parses standard composer output', () => {
    expect(
      parseComposerVersion('Composer version 2.7.7 2024-06-10 22:11:12'),
    ).toBe('2.7.7');
  });

  it('parses composer output without "version" word', () => {
    expect(parseComposerVersion('Composer 2.8.1')).toBe('2.8.1');
  });

  it('returns null on malformed input', () => {
    expect(parseComposerVersion('npm 10.0.0')).toBeNull();
    expect(parseComposerVersion('Composer dev')).toBeNull();
    expect(parseComposerVersion('')).toBeNull();
  });
});
