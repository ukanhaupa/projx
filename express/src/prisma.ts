import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export type PrismaLike = object & {
  $connect?: () => Promise<void>;
  $disconnect?: () => Promise<void>;
};
