import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moscowDateString } from '../dashboard/dashboard-period.util';
import { ReferralVisitService } from './referral-visit.service';

describe('ReferralVisitService', () => {
  let prisma: {
    runInRlsTransaction: ReturnType<typeof vi.fn>;
    referralMfVisitDaily: {
      upsert: ReturnType<typeof vi.fn>;
      aggregate: ReturnType<typeof vi.fn>;
      groupBy: ReturnType<typeof vi.fn>;
    };
    user: {
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      groupBy: ReturnType<typeof vi.fn>;
    };
    orderReferralAttribution: {
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    referralCodeAlias: { findMany: ReturnType<typeof vi.fn> };
    $queryRaw: ReturnType<typeof vi.fn>;
  };
  let codes: { resolveByCode: ReturnType<typeof vi.fn> };
  let svc: ReferralVisitService;

  beforeEach(() => {
    prisma = {
      runInRlsTransaction: vi.fn(async (_c, fn) => fn()),
      referralMfVisitDaily: {
        upsert: vi.fn().mockResolvedValue({}),
        aggregate: vi.fn().mockResolvedValue({ _sum: { visits: 12 } }),
        groupBy: vi.fn().mockResolvedValue([
          { code: 'ANNA1', _sum: { visits: 10 }, day: new Date() },
        ]),
      },
      user: {
        count: vi.fn().mockResolvedValue(3),
        findMany: vi.fn().mockResolvedValue([
          { id: 'u1', email: 'a@b.c', referralCode: 'ANNA1' },
        ]),
        groupBy: vi.fn().mockResolvedValue([
          { referredByUserId: 'u1', _count: { _all: 2 } },
        ]),
      },
      orderReferralAttribution: {
        count: vi
          .fn()
          .mockResolvedValueOnce(5)
          .mockResolvedValueOnce(4),
        findMany: vi.fn().mockResolvedValue([
          { code: 'ANNA1', order: { status: 'PAID' } },
          { code: 'ANNA1', order: { status: 'AWAITING_PAYMENT' } },
        ]),
      },
      referralCodeAlias: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    codes = {
      resolveByCode: vi.fn().mockResolvedValue({
        userId: 'u1',
        code: 'ANNA1',
        matchedByCodeAlias: false,
      }),
    };
    svc = new ReferralVisitService(prisma as never, codes as never);
  });

  it('trackVisit: невалидный код → ok без upsert', async () => {
    await expect(svc.trackVisit('!!')).resolves.toEqual({ ok: true });
    expect(prisma.runInRlsTransaction).not.toHaveBeenCalled();
  });

  it('trackVisit: upsert день×код + referrer', async () => {
    await expect(svc.trackVisit('anna1')).resolves.toEqual({ ok: true });
    expect(codes.resolveByCode).toHaveBeenCalledWith('ANNA1');
    expect(prisma.referralMfVisitDaily.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          day_code: {
            day: expect.any(Date),
            code: 'ANNA1',
          },
        },
        create: expect.objectContaining({
          code: 'ANNA1',
          referrerUserId: 'u1',
          visits: 1,
        }),
        update: expect.objectContaining({
          visits: { increment: 1 },
          referrerUserId: 'u1',
        }),
      }),
    );
    const dayArg =
      prisma.referralMfVisitDaily.upsert.mock.calls[0][0].where.day_code.day;
    expect(dayArg.toISOString().slice(0, 10)).toBe(moscowDateString());
  });

  it('trackVisit: неизвестный код → ok без upsert', async () => {
    codes.resolveByCode.mockResolvedValueOnce(null);
    await expect(svc.trackVisit('FAKE9999')).resolves.toEqual({ ok: true });
    expect(prisma.referralMfVisitDaily.upsert).not.toHaveBeenCalled();
  });

  it('trackVisit: ошибка БД → всё равно ok', async () => {
    prisma.runInRlsTransaction.mockRejectedValue(new Error('db down'));
    await expect(svc.trackVisit('ANNA1')).resolves.toEqual({ ok: true });
  });

  it('getFunnel: totals + rates + top', async () => {
    // groupBy called twice: top codes + series visits
    prisma.referralMfVisitDaily.groupBy
      .mockResolvedValueOnce([
        { code: 'ANNA1', _sum: { visits: 10 } },
      ])
      .mockResolvedValueOnce([]);

    const out = await svc.getFunnel({ period: 'today' });
    expect(out.totals).toEqual({
      visits: 12,
      sticky: 3,
      orders: 5,
      paid: 4,
    });
    expect(out.rates.visitToSticky).toBe(25);
    expect(out.topCodes[0]).toEqual(
      expect.objectContaining({
        code: 'ANNA1',
        referrerEmail: 'a@b.c',
        visits: 10,
        sticky: 2,
        orders: 2,
        paid: 1,
      }),
    );
  });
});
