import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackgroundWorkerLeaseService } from './background-worker-lease.service';

describe('BackgroundWorkerLeaseService', () => {
  const backgroundWorkerLease = {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  };
  const queryRaw = vi.fn();
  const prisma = {
    backgroundWorkerLease,
    $transaction: vi.fn(async (fn: (tx: { $queryRaw: typeof queryRaw }) => unknown) =>
      fn({ $queryRaw: queryRaw }),
    ),
  };

  let service: BackgroundWorkerLeaseService;

  beforeEach(() => {
    vi.clearAllMocks();
    backgroundWorkerLease.upsert.mockResolvedValue({});
    service = new BackgroundWorkerLeaseService(prisma as never);
  });

  it('acquire: UPDATE вернул строку → true', async () => {
    queryRaw.mockResolvedValue([{ key: 'cdek_sync' }]);
    expect(await service.acquire('cdek_sync', 120_000)).toBe(true);
    expect(backgroundWorkerLease.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'cdek_sync' } }),
    );
  });

  it('acquire: пустой RETURNING → false', async () => {
    queryRaw.mockResolvedValue([]);
    expect(await service.acquire('cdek_sync', 120_000)).toBe(false);
  });

  it('renew: count=0 → false', async () => {
    backgroundWorkerLease.updateMany.mockResolvedValue({ count: 0 });
    expect(await service.renew('cdek_sync', 120_000)).toBe(false);
  });

  it('renew: count>0 → true', async () => {
    backgroundWorkerLease.updateMany.mockResolvedValue({ count: 1 });
    expect(await service.renew('cdek_sync', 120_000)).toBe(true);
  });

  it('release: expiresAt в прошлое', async () => {
    await service.release('cdek_sync');
    expect(backgroundWorkerLease.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ key: 'cdek_sync' }),
        data: expect.objectContaining({
          expiresAt: expect.any(Date),
        }),
      }),
    );
  });
});