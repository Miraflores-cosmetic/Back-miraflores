import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersCdekSyncWorker } from './orders-cdek-sync.worker';

const zero = () => ({
  scanned: 0,
  trackingUpdated: 0,
  trackingEmailed: 0,
  retriedMails: 0,
  mailOutboxHighAttempt: 0,
  mailOutboxExhausted: 0,
  delivered: 0,
  errors: 0,
});

describe('OrdersCdekSyncWorker', () => {
  const sync = {
    isEnabled: vi.fn(() => true),
    runTick: vi.fn(async () => zero()),
  };
  const lease = {
    acquire: vi.fn(async () => true),
    renew: vi.fn(async () => true),
    release: vi.fn(async () => undefined),
  };
  const config = {
    get: vi.fn((key: string) =>
      key === 'CDEK_SYNC_INTERVAL_MS' ? '60000' : undefined,
    ),
  };

  let worker: OrdersCdekSyncWorker;

  beforeEach(() => {
    vi.clearAllMocks();
    worker = new OrdersCdekSyncWorker(
      config as never,
      sync as never,
      lease as never,
    );
  });

  const tick = () =>
    (
      worker as unknown as { tick: () => Promise<void> }
    ).tick();

  it('tick: lease acquire → runTick → release', async () => {
    await tick();
    expect(lease.acquire).toHaveBeenCalledWith('cdek_sync', 60_000 * 2 + 60_000);
    expect(sync.runTick).toHaveBeenCalledWith(
      expect.objectContaining({
        onBatchProgress: expect.any(Function),
      }),
    );
    expect(lease.release).toHaveBeenCalledWith('cdek_sync');
    const [{ onBatchProgress }] = sync.runTick.mock.calls[0] as [
      { onBatchProgress: () => void },
    ];
    void onBatchProgress();
    expect(lease.renew).toHaveBeenCalledWith('cdek_sync', 60_000 * 2 + 60_000);
  });

  it('tick: renew=false прерывает runTick (abort)', async () => {
    lease.renew.mockResolvedValue(false);
    sync.runTick.mockImplementation(async (opts) => {
      await opts?.onBatchProgress?.();
      return zero();
    });
    await tick();
    expect(sync.runTick).toHaveBeenCalled();
    expect(lease.renew).toHaveBeenCalled();
  });

  it('tick: без lease — не runTick', async () => {
    lease.acquire.mockResolvedValue(false);
    await tick();
    expect(sync.runTick).not.toHaveBeenCalled();
  });

  it('tick: overlapping — второй вызов не берёт lease', async () => {
    let releaseFirst: () => void = () => undefined;
    sync.runTick.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve(zero());
        }),
    );

    const t1 = tick();
    const t2 = tick();
    expect(lease.acquire).toHaveBeenCalledTimes(1);
    releaseFirst();
    await Promise.all([t1, t2]);
  });

});