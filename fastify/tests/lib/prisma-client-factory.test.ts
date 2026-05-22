import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const constructorCalls: unknown[] = [];

vi.mock('@prisma/client', () => {
  class FakePrismaClient {
    constructor(args?: unknown) {
      constructorCalls.push(args ?? null);
    }
    async $disconnect(): Promise<void> {}
  }
  return { PrismaClient: FakePrismaClient };
});

describe('lib/prisma-client getPrismaClient', () => {
  beforeEach(() => {
    constructorCalls.length = 0;
    vi.resetModules();
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/d';
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('throws if DATABASE_URL is not set', async () => {
    delete process.env.DATABASE_URL;
    const { getPrismaClient } = await import('../../src/lib/prisma-client.js');
    expect(() => getPrismaClient()).toThrow(/DATABASE_URL/);
  });

  it('returns the same singleton on subsequent calls', async () => {
    const { getPrismaClient } = await import('../../src/lib/prisma-client.js');
    const a = getPrismaClient();
    const b = getPrismaClient();
    expect(a).toBe(b);
    expect(constructorCalls).toHaveLength(1);
  });

  it('injects application_name into the DATABASE_URL', async () => {
    const { getPrismaClient } = await import('../../src/lib/prisma-client.js');
    getPrismaClient();
    const args = constructorCalls[0] as { datasourceUrl?: string };
    expect(args.datasourceUrl).toContain('application_name=projx-fastify');
  });

  it('injects statement_timeout and idle_in_transaction_session_timeout via options', async () => {
    const { getPrismaClient } = await import('../../src/lib/prisma-client.js');
    getPrismaClient();
    const args = constructorCalls[0] as { datasourceUrl?: string };
    expect(args.datasourceUrl).toContain('statement_timeout%3D5000');
    expect(args.datasourceUrl).toContain(
      'idle_in_transaction_session_timeout%3D10000',
    );
  });

  it('preserves caller-supplied application_name in DATABASE_URL', async () => {
    process.env.DATABASE_URL =
      'postgresql://u:p@h:5432/d?application_name=custom-svc';
    const { getPrismaClient } = await import('../../src/lib/prisma-client.js');
    getPrismaClient();
    const args = constructorCalls[0] as { datasourceUrl?: string };
    expect(args.datasourceUrl).toContain('application_name=custom-svc');
    expect(args.datasourceUrl).not.toContain('application_name=projx-fastify');
  });

  it('sets transactionOptions derived from TIMEOUT (maxWait=5s, timeout=10s)', async () => {
    const { getPrismaClient } = await import('../../src/lib/prisma-client.js');
    getPrismaClient();
    const args = constructorCalls[0] as {
      transactionOptions?: { maxWait?: number; timeout?: number };
    };
    expect(args.transactionOptions?.maxWait).toBe(5000);
    expect(args.transactionOptions?.timeout).toBe(10000);
  });

  it('passes datasourceUrl only — never datasources (Prisma forbids both)', async () => {
    const { getPrismaClient } = await import('../../src/lib/prisma-client.js');
    getPrismaClient();
    const args = constructorCalls[0] as {
      datasources?: unknown;
      datasourceUrl?: string;
    };
    expect(args.datasources).toBeUndefined();
    expect(args.datasourceUrl).toBeDefined();
  });

  it('disposePrismaClient resets the singleton so the next get rebuilds', async () => {
    const { getPrismaClient, disposePrismaClient } =
      await import('../../src/lib/prisma-client.js');
    getPrismaClient();
    await disposePrismaClient();
    getPrismaClient();
    expect(constructorCalls).toHaveLength(2);
  });
});
