import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';

export type RlsStore = {
  tx: Prisma.TransactionClient;
  afterCommit?: Array<() => void | Promise<void>>;
};

export const rlsAls = new AsyncLocalStorage<RlsStore>();

export function getRlsTx(): Prisma.TransactionClient | undefined {
  return rlsAls.getStore()?.tx;
}
