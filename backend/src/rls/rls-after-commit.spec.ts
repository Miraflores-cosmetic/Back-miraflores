import { describe, expect, it, vi } from 'vitest';
import {
  flushAfterRlsCommit,
  scheduleAfterRlsCommit,
} from './rls-after-commit';
import { rlsAls, type RlsStore } from './rls-context';

describe('scheduleAfterRlsCommit', () => {
  it('runs immediately when not in RLS store', async () => {
    const fn = vi.fn();
    scheduleAfterRlsCommit(fn);
    await vi.waitFor(() => expect(fn).toHaveBeenCalledOnce());
  });

  it('queues until flushAfterRlsCommit', async () => {
    const fn = vi.fn();
    const afterCommit: RlsStore['afterCommit'] = [];
    const fakeTx = {} as RlsStore['tx'];
    await new Promise<void>((resolve) => {
      rlsAls.run({ tx: fakeTx, afterCommit }, () => {
        scheduleAfterRlsCommit(fn);
        expect(fn).not.toHaveBeenCalled();
        resolve();
      });
    });
    flushAfterRlsCommit(afterCommit);
    await vi.waitFor(() => expect(fn).toHaveBeenCalledOnce());
  });
});
