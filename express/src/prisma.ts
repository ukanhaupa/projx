import { getPrismaClient } from './lib/prisma-client.js';

const lazyTarget = {} as Record<string, unknown>;
export const prisma = new Proxy(lazyTarget, {
  get(_target, prop) {
    const client = getPrismaClient();
    return Reflect.get(client, prop, client);
  },
}) as unknown as ReturnType<typeof getPrismaClient>;

export type PrismaLike = object & {
  $connect?: () => Promise<void>;
  $disconnect?: () => Promise<void>;
};
