import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/app.js';
import {
  getServiceConfig,
  setServiceConfig,
  invalidateServiceConfigCache,
} from '../../src/lib/service-config.js';

describe('service-config', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
    await app.prisma.serviceConfig.deleteMany();
    invalidateServiceConfigCache();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('returns null when no config exists', async () => {
    const got = await getServiceConfig(app.prisma, 'smtp');
    expect(got).toBeNull();
  });

  it('round-trips an encrypted config', async () => {
    await setServiceConfig(app.prisma, 'smtp', { host: 'mail.example', port: 587 });
    const got = await getServiceConfig<{ host: string; port: number }>(app.prisma, 'smtp');
    expect(got).toEqual({ host: 'mail.example', port: 587 });
  });

  it('persists ciphertext, not plaintext', async () => {
    await setServiceConfig(app.prisma, 'smtp', { password: 'super-secret-value' });
    const row = await app.prisma.serviceConfig.findFirstOrThrow({
      where: { purpose: 'smtp' },
    });
    expect(row.config).not.toContain('super-secret-value');
  });

  it('updates existing config in place (no duplicate row)', async () => {
    await setServiceConfig(app.prisma, 'smtp', { host: 'old' });
    await setServiceConfig(app.prisma, 'smtp', { host: 'new' });
    const got = await getServiceConfig<{ host: string }>(app.prisma, 'smtp');
    expect(got).toEqual({ host: 'new' });
    const count = await app.prisma.serviceConfig.count({ where: { purpose: 'smtp' } });
    expect(count).toBe(1);
  });
});
