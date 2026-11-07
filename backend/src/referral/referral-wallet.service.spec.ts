import {
  OrderStatus,
  ReferralEarnMode,
  ReferralLedgerKind,
  ReferralLedgerStatus,
  ReferralQuarantineMode,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReferralWalletService } from './referral-wallet.service';

function makeSettings(over: Record<string, unknown> = {}) {
  return {
    id: 'default',
    enabled: true,
    enabledAt: new Date('2020-01-01T00:00:00.000Z'),
    earnPercent: 10,
    earnMode: ReferralEarnMode.EVERY,
    linkTtlDays: 60,
    minOrderRub: 0,
    quarantineMode: ReferralQuarantineMode.DELIVERED,
    quarantineDays: 7,
    inviteeBonusEnabled: false,
    inviteeBonusRub: 0,
    spendCapPercent: 100,
    shareText: 'x',
    updatedAt: new Date(),
    ...over,
  };
}

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
      referralAttribution: {
        code: 'ANNA1',
        referrerUserId: 'ref1',
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

    // 3000 * 10% = 300, не 1500; q* сохранены
    expect(prisma.referralWalletLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          amount: 300,
          note: 'base=3000;pct=10;qMode=DELIVERED;qDays=7',
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
        }),
      }),
    );
  });

  it('DELIVERED не POSTED если snapshot qMode=DAYS_AFTER_PAID', async () => {
    settings.ensureDefaults.mockResolvedValue(
      makeSettings({ quarantineMode: ReferralQuarantineMode.DELIVERED }),
    );
    prisma.order.findUnique.mockResolvedValue(
      orderBase({ status: OrderStatus.DELIVERED }),
    );
    prisma.referralWalletLedger.findUnique.mockResolvedValue({
      id: 'e1',
      status: ReferralLedgerStatus.PENDING,
      amount: 500,
      note: 'base=5000;pct=10;qMode=DAYS_AFTER_PAID;qDays=14',
      userId: 'ref1',
    });

    await svc.touchInTx(prisma as never, 'ord1');

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
        data: { status: ReferralLedgerStatus.VOIDED },
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

  it('disabled settings → no-op', async () => {
    settings.ensureDefaults.mockResolvedValue(makeSettings({ enabled: false }));
    prisma.order.findUnique.mockResolvedValue(orderBase());
    await svc.touchInTx(prisma as never, 'ord1');
    expect(prisma.referralWalletLedger.create).not.toHaveBeenCalled();
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

  it('POSTED по snapshot qDays от paidAt; live mode/days игнорируются', async () => {
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
        note: 'base=5000;pct=10;qMode=DAYS_AFTER_PAID;qDays=7',
        order: { status: OrderStatus.PAID, paidAt },
      },
    ]);

    const n = await svc.processDueQuarantine(50);
    expect(n).toBe(1);
    expect(prisma.referralWalletLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'e1' },
        data: expect.objectContaining({ status: ReferralLedgerStatus.POSTED }),
      }),
    );
  });

  it('не POSTED если snapshot qDays ещё не прошли', async () => {
    settings.ensureDefaults.mockResolvedValue(
      makeSettings({ quarantineMode: ReferralQuarantineMode.DAYS_AFTER_PAID }),
    );
    const paidAt = new Date(Date.now() - 3 * 24 * 60 * 60_000);
    prisma.referralWalletLedger.findMany.mockResolvedValue([
      {
        id: 'e1',
        userId: 'ref1',
        amount: 500,
        orderId: 'ord1',
        note: 'base=5000;pct=10;qMode=DAYS_AFTER_PAID;qDays=14',
        order: { status: OrderStatus.PAID, paidAt },
      },
    ]);

    const n = await svc.processDueQuarantine(50);
    expect(n).toBe(0);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
