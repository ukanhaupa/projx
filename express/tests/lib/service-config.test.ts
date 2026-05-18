import { beforeEach, describe, expect, it, vi } from 'vitest';

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

interface Row {
  purpose: string;
  config: string;
  is_active: boolean;
}

function makePrisma() {
  const rows = new Map<string, Row>();
  return {
    serviceConfig: {
      findFirst: vi
        .fn()
        .mockImplementation(
          async (args: { where: { purpose: string; is_active: boolean } }) => {
            const row = rows.get(args.where.purpose);
            if (!row) return null;
            if (row.is_active !== args.where.is_active) return null;
            return { ...row };
          },
        ),
      upsert: vi
        .fn()
        .mockImplementation(
          async (args: {
            where: { purpose: string };
            create: { purpose: string; config: string; is_active: boolean };
            update: { config: string; is_active: boolean };
          }) => {
            const existing = rows.get(args.where.purpose);
            const next: Row = existing
              ? { ...existing, ...args.update }
              : { ...args.create };
            rows.set(args.where.purpose, next);
            return next;
          },
        ),
    },
    _rows: rows,
  };
}

describe('service-config', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('writes encrypted config and reads it back', async () => {
    const { getServiceConfig, setServiceConfig, invalidateServiceConfigCache } =
      await import('../../src/lib/service-config.js');
    const prisma = makePrisma();
    invalidateServiceConfigCache();

    await setServiceConfig(prisma, 'smtp', { host: 'mail', port: 587 });
    expect(prisma.serviceConfig.upsert).toHaveBeenCalled();

    invalidateServiceConfigCache();
    const got = await getServiceConfig<{ host: string; port: number }>(
      prisma,
      'smtp',
    );
    expect(got).toEqual({ host: 'mail', port: 587 });
  });

  it('caches results until invalidated', async () => {
    const { getServiceConfig, setServiceConfig, invalidateServiceConfigCache } =
      await import('../../src/lib/service-config.js');
    const prisma = makePrisma();
    invalidateServiceConfigCache();

    await setServiceConfig(prisma, 'jwt', { secret: 'one' });
    const first = await getServiceConfig<{ secret: string }>(prisma, 'jwt');
    const second = await getServiceConfig<{ secret: string }>(prisma, 'jwt');
    expect(first).toEqual({ secret: 'one' });
    expect(second).toEqual({ secret: 'one' });
    expect(prisma.serviceConfig.findFirst).toHaveBeenCalledTimes(1);

    invalidateServiceConfigCache('jwt');
    await getServiceConfig(prisma, 'jwt');
    expect(prisma.serviceConfig.findFirst).toHaveBeenCalledTimes(2);
  });

  it('returns null when no row exists for the purpose', async () => {
    const { getServiceConfig, invalidateServiceConfigCache } =
      await import('../../src/lib/service-config.js');
    const prisma = makePrisma();
    invalidateServiceConfigCache();

    const got = await getServiceConfig(prisma, 'missing');
    expect(got).toBeNull();
  });

  it('invalidates every entry when called with no purpose', async () => {
    const { getServiceConfig, setServiceConfig, invalidateServiceConfigCache } =
      await import('../../src/lib/service-config.js');
    const prisma = makePrisma();
    invalidateServiceConfigCache();

    await setServiceConfig(prisma, 'a', { v: 1 });
    await setServiceConfig(prisma, 'b', { v: 2 });
    await getServiceConfig(prisma, 'a');
    await getServiceConfig(prisma, 'b');
    expect(prisma.serviceConfig.findFirst).toHaveBeenCalledTimes(2);

    invalidateServiceConfigCache();
    await getServiceConfig(prisma, 'a');
    await getServiceConfig(prisma, 'b');
    expect(prisma.serviceConfig.findFirst).toHaveBeenCalledTimes(4);
  });
});
