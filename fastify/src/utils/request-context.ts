import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestContext {
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function setRequestUserId(userId: string | undefined): void {
  const current = storage.getStore();
  if (current) {
    current.userId = userId;
    return;
  }
  storage.enterWith({ userId });
}

export function getRequestUserId(): string | undefined {
  return storage.getStore()?.userId;
}

export async function runWithUserId<T>(
  userId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    storage.run({ userId }, () => {
      fn().then(resolve, reject);
    });
  });
}
