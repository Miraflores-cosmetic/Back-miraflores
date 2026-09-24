import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { rlsAls } from './rls-context';

const log = new Logger('RlsAfterCommit');

export type RlsCtx = { userId: string; bypass: boolean };

export function rlsCtxForJwtRole(jwtUserId: string, jwtRole: string): RlsCtx {
  const isBuyer = jwtRole === 'USER';
  return {
    userId: isBuyer ? jwtUserId : '',
    bypass: !isBuyer,
  };
}

/** Side effects after successful commit of the outer RLS transaction (or immediately if no tx). */
export function scheduleAfterRlsCommit(fn: () => void | Promise<void>): void {
  const store = rlsAls.getStore();
  if (!store?.afterCommit) {
    void Promise.resolve(fn()).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`after-commit job failed (no tx): ${msg}`);
    });
    return;
  }
  store.afterCommit.push(fn);
}

export async function flushAfterRlsCommit(
  jobs: Array<() => void | Promise<void>>,
): Promise<void> {
  for (const job of jobs) {
    try {
      await job();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`after-commit job failed: ${msg}`);
    }
  }
}

/** DB work in a fresh bypass transaction after the request tx commits. */
export function scheduleAfterRlsCommitWithBypass(
  prisma: PrismaService,
  fn: () => Promise<void>,
): void {
  scheduleAfterRlsCommit(() =>
    prisma.runInRlsTransaction({ userId: '', bypass: true }, fn),
  );
}
