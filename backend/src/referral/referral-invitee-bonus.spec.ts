import {
  OrderStatus,
  ReferralLedgerKind,
  ReferralLedgerStatus,
  ReferralQuarantineMode,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReferralWalletService } from './referral-wallet.service';

describe('ReferralWalletService invitee bonus + ledger history', () => {
  let prisma: {
    referralWalletLedger: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      aggregate: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    order: { findUnique: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
    $executeRaw: ReturnType<typeof vi.fn>;
    runInRlsTransaction: ReturnType<typeof vi.fn>;
  };
  let settings: { ensureDefaults: ReturnType<typeof vi.fn> };
  let svc: ReferralWalletService;

  const baseSettings = {
    enabled: true,
    enabledAt: new Date('2026-01-01'),
    earnPercent: 5,
    earnMode: 'EVERY',
    earnWindowMaxOrders: 0,
    earnWindowDays: 90,
    minOrderRub: 0,
    quarantineMode: ReferralQuarantineMode.DELIVERED,
    quarantineDays: 7,
    inviteeBonusEnabled: true,
    inviteeBonusRub: 300,
    spendCapPercent: 100,
    monthlyEarnCapRub: 0,
    shareText: 'Hi {link}',
  };

  beforeEach(() => {
    prisma = {
      referralWalletLedger: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        update: vi.fn(),
      },
      order: {
        findUnique: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      runInRlsTransaction: vi.fn(async (_ctx: unknown, fn: () => unknown) => fn()),
    };
    settings = {
      ensureDefaults: vi.fn().mockResolvedValue(baseSettings),
    };
    svc = new ReferralWalletService(prisma as never, settings as never);
  });

  it('listLedgerHistory: EARN без номера заказа друга; SPEND — свой номер', async () => {
    prisma.referralWalletLedger.findMany.mockResolvedValue([
      {
        id: 'l1',
        createdAt: new Date('2026-06-01T12:00:00.000Z'),
        kind: ReferralLedgerKind.EARN,
        status: ReferralLedgerStatus.POSTED,
        amount: 250,
        order: { number: 'AA-000123' },
      },
      {
        id: 'l2',
        createdAt: new Date('2026-06-01T11:00:00.000Z'),
        kind: ReferralLedgerKind.SPEND_HOLD,
        status: ReferralLedgerStatus.POSTED,
        amount: -100,
        order: { number: 'AA-OWN-1' },
      },
    ]);
    const page = await svc.listLedgerHistory('u1', { limit: 10 });
    expect(page.items).toEqual([
      {
        id: 'l1',
        createdAt: '2026-06-01T12:00:00.000Z',
        kind: ReferralLedgerKind.EARN,
        status: ReferralLedgerStatus.POSTED,
        amount: 250,
        orderNumber: null,
      },
      {
        id: 'l2',
        createdAt: '2026-06-01T11:00:00.000Z',
        kind: ReferralLedgerKind.SPEND_HOLD,
        status: ReferralLedgerStatus.POSTED,
        amount: -100,
        orderNumber: 'AA-OWN-1',
      },
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('touch: invitee bonus PENDING на первом qualifying заказе', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord1',
      number: 'AA-1',
      status: OrderStatus.PAID,
      email: 'invitee@x.co',
      phone: '+79001112233',
      userId: 'invitee-1',
      subtotal: 5000,
      discountTotal: 0,
      giftCertificateAmount: 0,
      referralWalletAmount: 0,
      refundedAmount: 0,
      giftPurchaseDenominationId: null,
      referralAttribution: {
        code: 'ABCD',
        referrerUserId: 'ref-1',
        addressMatchSuspect: false,
        createdAt: new Date('2026-02-01'),
      },
    });
    const created = new Set<string>();
    prisma.referralWalletLedger.findUnique.mockImplementation(
      async (args: {
        where: { userId_idempotencyKey: { idempotencyKey: string } };
      }) => {
        const key = args.where.userId_idempotencyKey.idempotencyKey;
        if (!created.has(key)) return null;
        if (key.startsWith('earn:')) {
          return {
            id: 'earn1',
            status: ReferralLedgerStatus.PENDING,
            amount: 250,
            note: 'base=5000;pct=5;qMode=DELIVERED;qDays=7',
            userId: 'ref-1',
          };
        }
        if (key.startsWith('invitee_bonus:')) {
          return {
            id: 'bon1',
            status: ReferralLedgerStatus.PENDING,
            amount: 300,
            note: 'base=300;pct=100;qMode=DELIVERED;qDays=7',
            userId: 'invitee-1',
          };
        }
        return null;
      },
    );
    prisma.referralWalletLedger.create.mockImplementation(
      async (args: { data: { idempotencyKey: string } }) => {
        created.add(args.data.idempotencyKey);
        return { id: 'x' };
      },
    );

    await svc.touch('ord1');

    expect(prisma.referralWalletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'invitee-1',
          kind: ReferralLedgerKind.INVITEE_BONUS,
          status: ReferralLedgerStatus.PENDING,
          amount: 300,
          idempotencyKey: 'invitee_bonus:ord1',
        }),
      }),
    );
  });

  it('touch: earn skip (targetAmount=0) не блокирует invitee bonus', async () => {
    settings.ensureDefaults.mockResolvedValue({
      ...baseSettings,
      earnPercent: 0, // referrer earn = 0, bonus всё равно
    });
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-zero-earn',
      number: 'AA-0',
      status: OrderStatus.PAID,
      email: 'invitee@x.co',
      phone: '+79001112233',
      userId: 'invitee-1',
      subtotal: 5000,
      discountTotal: 0,
      giftCertificateAmount: 0,
      referralWalletAmount: 0,
      refundedAmount: 0,
      giftPurchaseDenominationId: null,
      referralAttribution: {
        code: 'ABCD',
        referrerUserId: 'ref-1',
        addressMatchSuspect: false,
        createdAt: new Date('2026-02-01'),
      },
    });
    const created = new Set<string>();
    prisma.referralWalletLedger.findUnique.mockImplementation(
      async (args: {
        where: { userId_idempotencyKey: { idempotencyKey: string } };
      }) => {
        const key = args.where.userId_idempotencyKey.idempotencyKey;
        if (!created.has(key)) return null;
        if (key.startsWith('invitee_bonus:')) {
          return {
            id: 'bon1',
            status: ReferralLedgerStatus.PENDING,
            amount: 300,
            note: 'base=300;pct=100;qMode=DELIVERED;qDays=7',
            userId: 'invitee-1',
          };
        }
        return null;
      },
    );
    prisma.referralWalletLedger.create.mockImplementation(
      async (args: { data: { idempotencyKey: string } }) => {
        created.add(args.data.idempotencyKey);
        return { id: 'x' };
      },
    );

    await svc.touch('ord-zero-earn');

    const kinds = prisma.referralWalletLedger.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { data: { kind: string } }).data.kind,
    );
    expect(kinds).not.toContain(ReferralLedgerKind.EARN);
    expect(kinds).toContain(ReferralLedgerKind.INVITEE_BONUS);
  });

  it('createPendingInviteeBonus: P2002 lifetime unique → silent', async () => {
    const { Prisma } = await import('@prisma/client');
    prisma.referralWalletLedger.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    // via touch path with lock + create
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-race',
      number: 'AA-R',
      status: OrderStatus.PAID,
      email: 'invitee@x.co',
      phone: '+79001112233',
      userId: 'invitee-1',
      subtotal: 5000,
      discountTotal: 0,
      giftCertificateAmount: 0,
      referralWalletAmount: 0,
      refundedAmount: 0,
      giftPurchaseDenominationId: null,
      referralAttribution: {
        code: 'ABCD',
        referrerUserId: 'ref-1',
        addressMatchSuspect: false,
        createdAt: new Date('2026-02-01'),
      },
    });
    prisma.referralWalletLedger.findUnique.mockResolvedValue(null);

    await expect(svc.touch('ord-race')).resolves.toBeUndefined();
  });

  it('touch: без userId (guest) — нет invitee bonus', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord2',
      number: 'AA-2',
      status: OrderStatus.PAID,
      email: 'g@x.co',
      phone: '+79001112233',
      userId: null,
      subtotal: 5000,
      discountTotal: 0,
      giftCertificateAmount: 0,
      referralWalletAmount: 0,
      refundedAmount: 0,
      giftPurchaseDenominationId: null,
      referralAttribution: {
        code: 'ABCD',
        referrerUserId: 'ref-1',
        addressMatchSuspect: false,
        createdAt: new Date('2026-02-01'),
      },
    });
    prisma.referralWalletLedger.findUnique.mockResolvedValue(null);

    await svc.touch('ord2');

    const bonusCreates = prisma.referralWalletLedger.create.mock.calls.filter(
      (c: unknown[]) =>
        (c[0] as { data?: { kind?: string } })?.data?.kind ===
        ReferralLedgerKind.INVITEE_BONUS,
    );
    expect(bonusCreates).toHaveLength(0);
  });

  it('cancel: PENDING invitee bonus → VOIDED', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-cancel-p',
      number: 'AA-CP',
      status: OrderStatus.CANCELLED,
      email: 'invitee@x.co',
      phone: '+79001112233',
      userId: 'invitee-1',
      subtotal: 5000,
      discountTotal: 0,
      giftCertificateAmount: 0,
      referralWalletAmount: 0,
      refundedAmount: 0,
      giftPurchaseDenominationId: null,
      referralAttribution: {
        code: 'ABCD',
        referrerUserId: 'ref-1',
        addressMatchSuspect: false,
        createdAt: new Date('2026-02-01'),
      },
    });
    prisma.referralWalletLedger.findUnique.mockImplementation(
      async (args: {
        where: { userId_idempotencyKey: { idempotencyKey: string } };
      }) => {
        const key = args.where.userId_idempotencyKey.idempotencyKey;
        if (key.startsWith('earn:')) return null;
        if (key.startsWith('invitee_bonus:')) {
          return {
            id: 'bon-pend',
            status: ReferralLedgerStatus.PENDING,
            amount: 300,
            note: 'base=300;pct=100;qMode=DELIVERED;qDays=7',
            userId: 'invitee-1',
          };
        }
        return null;
      },
    );

    await svc.touch('ord-cancel-p');

    expect(prisma.referralWalletLedger.update).toHaveBeenCalledWith({
      where: { id: 'bon-pend' },
      data: { status: ReferralLedgerStatus.VOIDED, availableAt: null },
    });
    expect(prisma.referralWalletLedger.create).not.toHaveBeenCalled();
  });

  it('cancel: POSTED invitee bonus → CLAWBACK invitee', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-cancel-c',
      number: 'AA-CC',
      status: OrderStatus.CANCELLED,
      email: 'invitee@x.co',
      phone: '+79001112233',
      userId: 'invitee-1',
      subtotal: 5000,
      discountTotal: 0,
      giftCertificateAmount: 0,
      referralWalletAmount: 0,
      refundedAmount: 0,
      giftPurchaseDenominationId: null,
      referralAttribution: {
        code: 'ABCD',
        referrerUserId: 'ref-1',
        addressMatchSuspect: false,
        createdAt: new Date('2026-02-01'),
      },
    });
    prisma.referralWalletLedger.findUnique.mockImplementation(
      async (args: {
        where: { userId_idempotencyKey: { idempotencyKey: string } };
      }) => {
        const key = args.where.userId_idempotencyKey.idempotencyKey;
        if (key.startsWith('earn:')) return null;
        if (key.startsWith('invitee_bonus:')) {
          return {
            id: 'bon-post',
            status: ReferralLedgerStatus.POSTED,
            amount: 300,
            note: 'base=300;pct=100;qMode=DELIVERED;qDays=7',
            userId: 'invitee-1',
          };
        }
        return null;
      },
    );
    prisma.referralWalletLedger.findMany.mockResolvedValue([]);
    prisma.referralWalletLedger.aggregate.mockResolvedValue({
      _sum: { amount: 300 },
    });

    await svc.touch('ord-cancel-c');

    expect(prisma.referralWalletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'invitee-1',
          kind: ReferralLedgerKind.CLAWBACK,
          status: ReferralLedgerStatus.POSTED,
          amount: -300,
          idempotencyKey: 'clawback_invitee:ord-cancel-c:1',
          note: expect.stringMatching(/^clawback invitee;/),
        }),
      }),
    );
  });
});
