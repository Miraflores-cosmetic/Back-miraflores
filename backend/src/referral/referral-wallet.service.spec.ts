import {
  OrderStatus,
  ReferralEarnMode,
  ReferralLedgerKind,
  ReferralLedgerStatus,
  ReferralQuarantineMode,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeAvailableAt,
  earnMetaFromRow,
  ReferralWalletService,
  resolveLedgerSource,
} from './referral-wallet.service';

describe('earnMetaFromRow / resolveLedgerSource', () => {
  it('колонки важнее note', () => {
    expect(
      earnMetaFromRow({
        note: 'base=1;pct=1;qMode=DAYS_AFTER_PAID;qDays=1',
        earnBase: 5000,
        earnPct: 10,
        qMode: ReferralQuarantineMode.DELIVERED,
        qDays: 7,
      }),
    ).toEqual({
      base: 5000,
      pct: 10,
      qMode: ReferralQuarantineMode.DELIVERED,
      qDays: 7,
    });
  });

  it('source column важнее note prefix', () => {
    expect(resolveLedgerSource('invitee', 'clawback earn; x')).toBe('invitee');
    expect(resolveLedgerSource(null, 'clawback invitee; x')).toBe('invitee');
  });
});

function makeSettings(over: Record<string, unknown> = {}) {
  return {
    id: 'default',
    enabled: true,
    enabledAt: new Date('2020-01-01T00:00:00.000Z'),
    earnPercent: 10,
    earnMode: ReferralEarnMode.EVERY,
    earnWindowMaxOrders: 0,
    earnWindowDays: 90,
    linkTtlDays: 60,
    minOrderRub: 0,
    quarantineMode: ReferralQuarantineMode.DELIVERED,
    quarantineDays: 7,
    inviteeBonusEnabled: false,
    inviteeBonusRub: 0,
    spendCapPercent: 100,
    monthlyEarnCapRub: 0,
    shareText: 'x',
    updatedAt: new Date(),
    ...over,
  };
}

describe('computeAvailableAt', () => {
  it('DAYS_AFTER_PAID → paidAt + qDays', () => {
    const paidAt = new Date('2026-01-01T00:00:00.000Z');
    expect(
      computeAvailableAt(
        ReferralQuarantineMode.DAYS_AFTER_PAID,
        7,
        paidAt,
      )?.toISOString(),
    ).toBe('2026-01-08T00:00:00.000Z');
  });

  it('DELIVERED → null', () => {
    expect(
      computeAvailableAt(
        ReferralQuarantineMode.DELIVERED,
        7,
        new Date('2026-01-01T00:00:00.000Z'),
      ),
    ).toBeNull();
  });

  it('DELIVERED_PLUS_DAYS → null at create (старт на touch DELIVERED)', () => {
    expect(
      computeAvailableAt(
        ReferralQuarantineMode.DELIVERED_PLUS_DAYS,
        14,
        new Date('2026-01-01T00:00:00.000Z'),
      ),
    ).toBeNull();
  });
});

describe('DELIVERED_PLUS_DAYS touch', () => {
  it('на DELIVERED ставит availableAt, не POSTED', async () => {
    const { ReferralWalletService, computeDeliveredPlusAvailableAt } =
      await import('./referral-wallet.service');
    const settings = {
      ensureDefaults: vi.fn().mockResolvedValue(
        makeSettings({
          quarantineMode: ReferralQuarantineMode.DELIVERED_PLUS_DAYS,
          quarantineDays: 14,
        }),
      ),
    };
    const prisma = {
      order: { findUnique: vi.fn(), count: vi.fn() },
      referralWalletLedger: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      runInRlsTransaction: vi.fn(async (_c: unknown, fn: () => unknown) => fn()),
    };
    const svc = new ReferralWalletService(prisma as never, settings as never);
    const pending = {
      id: 'e1',
      status: ReferralLedgerStatus.PENDING,
      amount: 500,
      note: 'base=5000;pct=10;qMode=DELIVERED_PLUS_DAYS;qDays=14',
      availableAt: null as Date | null,
      userId: 'ref1',
    };
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord1',
      number: 'AA-1',
      status: OrderStatus.DELIVERED,
      email: 'buyer@ex.com',
      phone: '+79001112233',
      userId: 'buyer1',
      subtotal: 5000,
      discountTotal: 0,
      giftCertificateAmount: 0,
      refundedAmount: 0,
      giftPurchaseDenominationId: null,
      paidAt: new Date('2024-06-01T12:00:00.000Z'),
      referralAttribution: {
        code: 'ANNA1',
        referrerUserId: 'ref1',
        addressMatchSuspect: false,
        createdAt: new Date('2024-06-01T00:00:00.000Z'),
      },
    });
    prisma.referralWalletLedger.findUnique
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending);

    await svc.touchInTx(prisma as never, 'ord1');

    expect(prisma.referralWalletLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'e1' },
        data: expect.objectContaining({
          availableAt: expect.any(Date),
        }),
      }),
    );
    const setAt = prisma.referralWalletLedger.update.mock.calls[0][0].data
      .availableAt as Date;
    const expected = computeDeliveredPlusAvailableAt(14, new Date());
    expect(Math.abs(setAt.getTime() - expected.getTime())).toBeLessThan(5000);
    expect(prisma.referralWalletLedger.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ReferralLedgerStatus.POSTED }),
      }),
    );
  });
});

describe('ReferralWalletService.touchInTx', () => {
  let prisma: {
    order: { findUnique: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
    referralWalletLedger: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      aggregate: ReturnType<typeof vi.fn>;
    };
    $executeRaw: ReturnType<typeof vi.fn>;
    runInRlsTransaction: ReturnType<typeof vi.fn>;
  };
  let settings: { ensureDefaults: ReturnType<typeof vi.fn> };
  let svc: ReferralWalletService;

  beforeEach(() => {
    prisma = {
      order: { findUnique: vi.fn(), count: vi.fn() },
      referralWalletLedger: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      runInRlsTransaction: vi.fn(async (_c, fn) => fn()),
    };
    settings = { ensureDefaults: vi.fn().mockResolvedValue(makeSettings()) };
    svc = new ReferralWalletService(prisma as never, settings as never);
  });

  function orderBase(over: Record<string, unknown> = {}) {
    return {
      id: 'ord1',
      number: 'AA-1',
      status: OrderStatus.PAID,
      email: 'buyer@ex.com',
      phone: '+79001112233',
      userId: 'buyer1',
      subtotal: 5000,
      discountTotal: 0,
      giftCertificateAmount: 0,
      refundedAmount: 0,
      giftPurchaseDenominationId: null,
      paidAt: new Date('2024-06-01T12:00:00.000Z'),
      referralAttribution: {
        code: 'ANNA1',
        referrerUserId: 'ref1',
        addressMatchSuspect: false,
        createdAt: new Date('2024-06-01T00:00:00.000Z'),
      },
      ...over,
    };
  }

  it('создаёт PENDING earn на PAID (snapshot pct)', async () => {
    prisma.order.findUnique.mockResolvedValue(orderBase());
    prisma.referralWalletLedger.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'e1',
        status: ReferralLedgerStatus.PENDING,
        amount: 500,
      });

    await svc.touchInTx(prisma as never, 'ord1');

    expect(prisma.referralWalletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'ref1',
          kind: ReferralLedgerKind.EARN,
          status: ReferralLedgerStatus.PENDING,
          amount: 500,
          idempotencyKey: 'earn:ord1',
          note: 'base=5000;pct=10;qMode=DELIVERED;qDays=7',
          availableAt: null,
        }),
      }),
    );
  });

  it('DAYS_AFTER_PAID → availableAt = paidAt + qDays', async () => {
    settings.ensureDefaults.mockResolvedValue(
      makeSettings({ quarantineMode: ReferralQuarantineMode.DAYS_AFTER_PAID }),
    );
    const paidAt = new Date('2024-06-01T12:00:00.000Z');
    prisma.order.findUnique.mockResolvedValue(orderBase({ paidAt }));
    prisma.referralWalletLedger.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'e1',
        status: ReferralLedgerStatus.PENDING,
        amount: 500,
      });

    await svc.touchInTx(prisma as never, 'ord1');

    expect(prisma.referralWalletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          note: 'base=5000;pct=10;qMode=DAYS_AFTER_PAID;qDays=7',
          availableAt: new Date(paidAt.getTime() + 7 * 24 * 60 * 60_000),
        }),
      }),
    );
  });

  it('PENDING shrink использует meta.pct, не live settings', async () => {
    // Live settings теперь 50%, но snapshot был 10%
    settings.ensureDefaults.mockResolvedValue(makeSettings({ earnPercent: 50 }));
    prisma.order.findUnique.mockResolvedValue(
      orderBase({ refundedAmount: 2000 }), // base=3000
    );
    prisma.referralWalletLedger.findUnique.mockResolvedValue({
      id: 'e1',
      status: ReferralLedgerStatus.PENDING,
      amount: 500,
      note: 'base=5000;pct=10;qMode=DELIVERED;qDays=7',
    });

    await svc.touchInTx(prisma as never, 'ord1');

    // 3000 * 10% = 300, не 1500; q* + колонки сохранены
    expect(prisma.referralWalletLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          amount: 300,
          note: 'base=3000;pct=10;qMode=DELIVERED;qDays=7',
          earnBase: 3000,
          earnPct: 10,
          qMode: ReferralQuarantineMode.DELIVERED,
          qDays: 7,
        },
      }),
    );
  });

  it('идемпотентно: повторный touch не дублирует earn', async () => {
    prisma.order.findUnique.mockResolvedValue(orderBase());
    prisma.referralWalletLedger.findUnique.mockResolvedValue({
      id: 'e1',
      status: ReferralLedgerStatus.PENDING,
      amount: 500,
      note: 'base=5000;pct=10',
    });

    await svc.touchInTx(prisma as never, 'ord1');
    expect(prisma.referralWalletLedger.create).not.toHaveBeenCalled();
  });

  it('DELIVERED + snapshot qMode=DELIVERED → POSTED (под lock)', async () => {
    // Live quarantine сменили на DAYS — snapshot всё ещё DELIVERED.
    settings.ensureDefaults.mockResolvedValue(
      makeSettings({ quarantineMode: ReferralQuarantineMode.DAYS_AFTER_PAID }),
    );
    prisma.order.findUnique.mockResolvedValue(
      orderBase({ status: OrderStatus.DELIVERED }),
    );
    const pending = {
      id: 'e1',
      status: ReferralLedgerStatus.PENDING,
      amount: 500,
      note: 'base=5000;pct=10;qMode=DELIVERED;qDays=7',
      userId: 'ref1',
    };
    prisma.referralWalletLedger.findUnique.mockResolvedValue(pending);
    prisma.referralWalletLedger.aggregate.mockResolvedValue({
      _sum: { amount: 100 },
    });

    await svc.touchInTx(prisma as never, 'ord1');

    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.referralWalletLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'e1' },
        data: expect.objectContaining({
          status: ReferralLedgerStatus.POSTED,
          balanceAfter: 600,
          availableAt: null,
        }),
      }),
    );
  });

  it('DELIVERED не POSTED если snapshot qMode=DAYS_AFTER_PAID (карантин ещё идёт)', async () => {
    settings.ensureDefaults.mockResolvedValue(
      makeSettings({ quarantineMode: ReferralQuarantineMode.DELIVERED }),
    );
    // paidAt свежий — availableAt в будущем; иначе due → POSTED (ок после approve).
    const paidAt = new Date(Date.now() - 2 * 24 * 60 * 60_000);
    prisma.order.findUnique.mockResolvedValue(
      orderBase({ status: OrderStatus.DELIVERED, paidAt }),
    );
    prisma.referralWalletLedger.findUnique.mockResolvedValue({
      id: 'e1',
      status: ReferralLedgerStatus.PENDING,
      amount: 500,
      note: 'base=5000;pct=10;qMode=DAYS_AFTER_PAID;qDays=14',
      availableAt: null,
      userId: 'ref1',
    });

    await svc.touchInTx(prisma as never, 'ord1');

    expect(prisma.referralWalletLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ availableAt: expect.any(Date) }),
      }),
    );
    expect(prisma.referralWalletLedger.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ReferralLedgerStatus.POSTED }),
      }),
    );
  });

  it('CANCELLED void PENDING', async () => {
    prisma.order.findUnique.mockResolvedValue(
      orderBase({ status: OrderStatus.CANCELLED }),
    );
    prisma.referralWalletLedger.findUnique.mockResolvedValue({
      id: 'e1',
      status: ReferralLedgerStatus.PENDING,
      amount: 500,
      note: 'base=5000;pct=10',
    });

    await svc.touchInTx(prisma as never, 'ord1');

    expect(prisma.referralWalletLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: ReferralLedgerStatus.VOIDED, availableAt: null },
      }),
    );
  });

  it('POSTED clawback: seq key + re-read balance under lock', async () => {
    prisma.order.findUnique.mockResolvedValue(
      orderBase({
        status: OrderStatus.PAID,
        refundedAmount: 2000,
      }),
    );
    const postedEarn = {
      id: 'e1',
      status: ReferralLedgerStatus.POSTED,
      amount: 500,
      note: 'base=5000;pct=10',
    };
    prisma.referralWalletLedger.findUnique
      .mockResolvedValueOnce(postedEarn)
      .mockResolvedValueOnce(null) // debt remaining
      .mockResolvedValueOnce(null) // debt upsert
      .mockResolvedValueOnce(postedEarn);
    prisma.referralWalletLedger.findMany.mockResolvedValue([]);
    prisma.referralWalletLedger.aggregate.mockResolvedValue({
      _sum: { amount: 500 },
    });

    await svc.touchInTx(prisma as never, 'ord1');

    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.referralWalletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: ReferralLedgerKind.CLAWBACK,
          status: ReferralLedgerStatus.POSTED,
          amount: -200,
          idempotencyKey: 'clawback:ord1:1',
        }),
      }),
    );
  });

  it('clawback: повтор при том же owed после частичного take → seq+1', async () => {
    prisma.order.findUnique.mockResolvedValue(
      orderBase({
        status: OrderStatus.PAID,
        refundedAmount: 5000, // base=0 → needed=500
      }),
    );
    const postedEarn = {
      id: 'e1',
      status: ReferralLedgerStatus.POSTED,
      amount: 500,
      note: 'base=5000;pct=10',
    };
    prisma.referralWalletLedger.findUnique
      .mockResolvedValueOnce(postedEarn)
      .mockResolvedValueOnce(null) // debt remaining
      .mockResolvedValueOnce(null) // debt upsert
      .mockResolvedValueOnce(postedEarn);
    // Уже сняли 200 (мало баланса раньше)
    prisma.referralWalletLedger.findMany.mockResolvedValue([{ amount: -200 }]);
    prisma.referralWalletLedger.aggregate.mockResolvedValue({
      _sum: { amount: 300 },
    });

    await svc.touchInTx(prisma as never, 'ord1');

    expect(prisma.referralWalletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: -300,
          idempotencyKey: 'clawback:ord1:2',
        }),
      }),
    );
  });

  it('clawback: нет баланса → DEBT (не теряем долг)', async () => {
    prisma.order.findUnique.mockResolvedValue(
      orderBase({
        status: OrderStatus.CANCELLED,
      }),
    );
    const postedEarn = {
      id: 'e1',
      status: ReferralLedgerStatus.POSTED,
      amount: 500,
      note: 'base=5000;pct=10',
    };
    prisma.referralWalletLedger.findUnique
      .mockResolvedValueOnce(postedEarn)
      .mockResolvedValueOnce(null) // debt remaining
      .mockResolvedValueOnce(null); // debt upsert
    prisma.referralWalletLedger.findMany.mockResolvedValue([]);
    prisma.referralWalletLedger.aggregate.mockResolvedValue({
      _sum: { amount: 0 },
    });

    await svc.touchInTx(prisma as never, 'ord1');

    expect(prisma.referralWalletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: ReferralLedgerKind.DEBT,
          status: ReferralLedgerStatus.POSTED,
          amount: 500,
          idempotencyKey: 'debt:ord1',
        }),
      }),
    );
  });

  it('clawback: DEBT VOIDED (погашен) → повторный touch не списывает снова', async () => {
    prisma.order.findUnique.mockResolvedValue(
      orderBase({ status: OrderStatus.CANCELLED }),
    );
    const postedEarn = {
      id: 'e1',
      status: ReferralLedgerStatus.POSTED,
      amount: 500,
      note: 'base=5000;pct=10',
    };
    prisma.referralWalletLedger.findUnique
      .mockResolvedValueOnce(postedEarn)
      .mockResolvedValueOnce({
        amount: 0,
        status: ReferralLedgerStatus.VOIDED,
      }); // debt closed
    // Частичный clawback earn раньше (остальное было DEBT → repay)
    prisma.referralWalletLedger.findMany.mockResolvedValue([{ amount: -200 }]);
    prisma.referralWalletLedger.aggregate.mockResolvedValue({
      _sum: { amount: 300 },
    });
    prisma.referralWalletLedger.create.mockClear();

    await svc.touchInTx(prisma as never, 'ord1');

    expect(prisma.referralWalletLedger.create).not.toHaveBeenCalled();
  });

  it('disabled settings → no create earn', async () => {
    settings.ensureDefaults.mockResolvedValue(makeSettings({ enabled: false }));
    prisma.order.findUnique.mockResolvedValue(orderBase());
    prisma.referralWalletLedger.findUnique.mockResolvedValue(null);
    await svc.touchInTx(prisma as never, 'ord1');
    expect(prisma.referralWalletLedger.create).not.toHaveBeenCalled();
  });

  it('disabled settings → всё равно void PENDING', async () => {
    settings.ensureDefaults.mockResolvedValue(makeSettings({ enabled: false }));
    prisma.order.findUnique.mockResolvedValue(
      orderBase({ status: OrderStatus.CANCELLED }),
    );
    prisma.referralWalletLedger.findUnique.mockResolvedValue({
      id: 'e1',
      status: ReferralLedgerStatus.PENDING,
      amount: 500,
      note: 'base=5000;pct=10',
    });
    await svc.touchInTx(prisma as never, 'ord1');
    expect(prisma.referralWalletLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: ReferralLedgerStatus.VOIDED, availableAt: null },
      }),
    );
  });

  it('minOrderRub отсекает мелкие заказы только на create', async () => {
    settings.ensureDefaults.mockResolvedValue(
      makeSettings({ minOrderRub: 10000 }),
    );
    prisma.order.findUnique.mockResolvedValue(orderBase());
    prisma.referralWalletLedger.findUnique.mockResolvedValue(null);
    await svc.touchInTx(prisma as never, 'ord1');
    expect(prisma.referralWalletLedger.create).not.toHaveBeenCalled();
  });

  it('FIRST_GOODS_ORDER: skip если был prior purchase', async () => {
    settings.ensureDefaults.mockResolvedValue(
      makeSettings({ earnMode: ReferralEarnMode.FIRST_GOODS_ORDER }),
    );
    prisma.order.findUnique.mockResolvedValue(orderBase());
    prisma.referralWalletLedger.findUnique.mockResolvedValue(null);
    prisma.order.count.mockResolvedValue(1);
    await svc.touchInTx(prisma as never, 'ord1');
    expect(prisma.referralWalletLedger.create).not.toHaveBeenCalled();
  });

  it('не earn если attribution.createdAt < enabledAt', async () => {
    settings.ensureDefaults.mockResolvedValue(
      makeSettings({ enabledAt: new Date('2025-01-01T00:00:00.000Z') }),
    );
    prisma.order.findUnique.mockResolvedValue(
      orderBase({
        referralAttribution: {
          code: 'ANNA1',
          referrerUserId: 'ref1',
        addressMatchSuspect: false,
          createdAt: new Date('2024-06-01T00:00:00.000Z'),
        },
      }),
    );
    prisma.referralWalletLedger.findUnique.mockResolvedValue(null);
    await svc.touchInTx(prisma as never, 'ord1');
    expect(prisma.referralWalletLedger.create).not.toHaveBeenCalled();
  });

  it('не earn если enabledAt=null (нет явного включения)', async () => {
    settings.ensureDefaults.mockResolvedValue(makeSettings({ enabledAt: null }));
    prisma.order.findUnique.mockResolvedValue(orderBase());
    prisma.referralWalletLedger.findUnique.mockResolvedValue(null);
    await svc.touchInTx(prisma as never, 'ord1');
    expect(prisma.referralWalletLedger.create).not.toHaveBeenCalled();
  });
});

describe('ReferralWalletService.processDueQuarantine', () => {
  let prisma: {
    referralWalletLedger: {
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      aggregate: ReturnType<typeof vi.fn>;
    };
    $executeRaw: ReturnType<typeof vi.fn>;
    runInRlsTransaction: ReturnType<typeof vi.fn>;
  };
  let settings: { ensureDefaults: ReturnType<typeof vi.fn> };
  let svc: ReferralWalletService;

  beforeEach(() => {
    prisma = {
      referralWalletLedger: {
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      runInRlsTransaction: vi.fn(async (_c, fn) => fn()),
    };
    settings = {
      ensureDefaults: vi.fn().mockResolvedValue(
        makeSettings({ quarantineMode: ReferralQuarantineMode.DAYS_AFTER_PAID }),
      ),
    };
    svc = new ReferralWalletService(prisma as never, settings as never);
  });

  it('фильтрует availableAt ≤ now (не голодает за DELIVERED PENDING)', async () => {
    // Live: DELIVERED / 30д — не должно блокировать snapshot DAYS/7.
    settings.ensureDefaults.mockResolvedValue(
      makeSettings({
        quarantineMode: ReferralQuarantineMode.DELIVERED,
        quarantineDays: 30,
      }),
    );
    const paidAt = new Date(Date.now() - 10 * 24 * 60 * 60_000);
    prisma.referralWalletLedger.findMany.mockResolvedValue([
      {
        id: 'e1',
        userId: 'ref1',
        amount: 500,
        orderId: 'ord1',
        kind: ReferralLedgerKind.EARN,
        note: 'base=5000;pct=10;qMode=DAYS_AFTER_PAID;qDays=7',
        order: { status: OrderStatus.PAID, paidAt },
      },
    ]);

    const n = await svc.processDueQuarantine(50);
    expect(n).toBe(1);
    expect(prisma.referralWalletLedger.updateMany).toHaveBeenCalled();
    expect(prisma.referralWalletLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: ReferralLedgerStatus.PENDING,
          availableAt: { lte: expect.any(Date) },
          NOT: {
            order: {
              referralAttribution: { addressMatchSuspect: true },
            },
          },
        }),
        orderBy: { availableAt: 'asc' },
      }),
    );
    expect(prisma.referralWalletLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'e1' },
        data: expect.objectContaining({ status: ReferralLedgerStatus.POSTED }),
      }),
    );
  });

  it('не POSTED если availableAt ещё в будущем — пустая SQL-выборка', async () => {
    settings.ensureDefaults.mockResolvedValue(
      makeSettings({ quarantineMode: ReferralQuarantineMode.DAYS_AFTER_PAID }),
    );
    prisma.referralWalletLedger.findMany.mockResolvedValue([]);

    const n = await svc.processDueQuarantine(50);
    expect(n).toBe(0);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('ReferralWalletService mail (created / posted / clawback)', () => {
  let prisma: {
    order: { findUnique: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
    user: { findUnique: ReturnType<typeof vi.fn> };
    referralWalletLedger: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      aggregate: ReturnType<typeof vi.fn>;
    };
    $executeRaw: ReturnType<typeof vi.fn>;
    runInRlsTransaction: ReturnType<typeof vi.fn>;
  };
  let settings: { ensureDefaults: ReturnType<typeof vi.fn> };
  let mail: {
    sendReferralEarnCreated: ReturnType<typeof vi.fn>;
    sendReferralEarnPosted: ReturnType<typeof vi.fn>;
    sendReferralClawback: ReturnType<typeof vi.fn>;
  };
  let svc: ReferralWalletService;

  async function flushAfterCommit() {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  }

  beforeEach(() => {
    prisma = {
      order: { findUnique: vi.fn(), count: vi.fn() },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          email: 'ref@ex.com',
          displayName: 'Реферер',
        }),
      },
      referralWalletLedger: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      runInRlsTransaction: vi.fn(async (_c, fn) => fn()),
    };
    settings = { ensureDefaults: vi.fn().mockResolvedValue(makeSettings()) };
    mail = {
      sendReferralEarnCreated: vi.fn().mockResolvedValue(undefined),
      sendReferralEarnPosted: vi.fn().mockResolvedValue(undefined),
      sendReferralClawback: vi.fn().mockResolvedValue(undefined),
    };
    svc = new ReferralWalletService(
      prisma as never,
      settings as never,
      mail as never,
    );
  });

  function orderBase(over: Record<string, unknown> = {}) {
    return {
      id: 'ord1',
      number: 'AA-1',
      status: OrderStatus.PAID,
      email: 'buyer@ex.com',
      phone: '+79001112233',
      userId: 'buyer1',
      subtotal: 5000,
      discountTotal: 0,
      giftCertificateAmount: 0,
      refundedAmount: 0,
      giftPurchaseDenominationId: null,
      paidAt: new Date('2024-06-01T12:00:00.000Z'),
      referralAttribution: {
        code: 'ANNA1',
        referrerUserId: 'ref1',
        addressMatchSuspect: false,
        createdAt: new Date('2024-06-01T00:00:00.000Z'),
      },
      ...over,
    };
  }

  it('create PENDING → referral_earn_created', async () => {
    prisma.order.findUnique
      .mockResolvedValueOnce(orderBase())
      .mockResolvedValue({ number: 'AA-1' });
    prisma.referralWalletLedger.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'e1',
        status: ReferralLedgerStatus.PENDING,
        amount: 500,
      });

    await svc.touchInTx(prisma as never, 'ord1');
    await flushAfterCommit();

    expect(mail.sendReferralEarnCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ref@ex.com',
        amount: 500,
        orderNumber: null,
        kindLabel: 'реферальное начисление',
      }),
    );
    expect(mail.sendReferralEarnPosted).not.toHaveBeenCalled();
  });

  it('POSTED на DELIVERED → referral_earn_posted', async () => {
    prisma.order.findUnique
      .mockResolvedValueOnce(orderBase({ status: OrderStatus.DELIVERED }))
      .mockResolvedValue({ number: 'AA-1' });
    prisma.referralWalletLedger.findUnique.mockResolvedValue({
      id: 'e1',
      status: ReferralLedgerStatus.PENDING,
      amount: 500,
      note: 'base=5000;pct=10;qMode=DELIVERED;qDays=7',
      userId: 'ref1',
    });
    prisma.referralWalletLedger.aggregate.mockResolvedValue({
      _sum: { amount: 0 },
    });

    await svc.touchInTx(prisma as never, 'ord1');
    await flushAfterCommit();

    expect(mail.sendReferralEarnPosted).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ref@ex.com',
        amount: 500,
        kindLabel: 'реферальное начисление',
      }),
    );
  });

  it('CLAWBACK take>0 → referral_clawback', async () => {
    prisma.order.findUnique
      .mockResolvedValueOnce(
        orderBase({ status: OrderStatus.PAID, refundedAmount: 2000 }),
      )
      .mockResolvedValue({ number: 'AA-1' });
    const postedEarn = {
      id: 'e1',
      status: ReferralLedgerStatus.POSTED,
      amount: 500,
      note: 'base=5000;pct=10',
    };
    prisma.referralWalletLedger.findUnique
      .mockResolvedValueOnce(postedEarn)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(postedEarn);
    prisma.referralWalletLedger.findMany.mockResolvedValue([]);
    prisma.referralWalletLedger.aggregate.mockResolvedValue({
      _sum: { amount: 500 },
    });

    await svc.touchInTx(prisma as never, 'ord1');
    await flushAfterCommit();

    expect(mail.sendReferralClawback).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ref@ex.com',
        amount: 200,
        orderNumber: null,
      }),
    );
  });

  it('P2002 create — без письма', async () => {
    const { Prisma } = await import('@prisma/client');
    prisma.order.findUnique.mockResolvedValue(orderBase());
    prisma.referralWalletLedger.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'e1',
        status: ReferralLedgerStatus.PENDING,
        amount: 500,
      });
    prisma.referralWalletLedger.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await svc.touchInTx(prisma as never, 'ord1');
    await flushAfterCommit();

    expect(mail.sendReferralEarnCreated).not.toHaveBeenCalled();
  });
});
