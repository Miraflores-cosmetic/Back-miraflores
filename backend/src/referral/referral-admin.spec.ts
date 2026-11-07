import {
  ReferralLedgerKind,
  ReferralLedgerStatus,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  buildAdjustIdempotencyKey,
  orderLedgerWalletRole,
  ReferralWalletService,
} from './referral-wallet.service';

describe('orderLedgerWalletRole', () => {
  it('CLAWBACK: earn vs invitee по note', () => {
    expect(orderLedgerWalletRole(ReferralLedgerKind.CLAWBACK, 'clawback earn; x')).toBe(
      'referrer_earn',
    );
    expect(
      orderLedgerWalletRole(ReferralLedgerKind.CLAWBACK, 'clawback invitee; x'),
    ).toBe('invitee_bonus');
    expect(orderLedgerWalletRole(ReferralLedgerKind.CLAWBACK, null)).toBe(
      'referrer_earn',
    );
  });
});

describe('buildAdjustIdempotencyKey', () => {
  it('uses client key when provided', () => {
    expect(
      buildAdjustIdempotencyKey({
        userId: 'u1',
        actorUserId: 'a1',
        amount: 100,
        note: 'x',
        clientKey: 'adj-abc-123',
      }),
    ).toBe('adjust:client:u1:adj-abc-123');
  });

  it('same hash within 60s bucket; changes after', () => {
    const base = {
      userId: 'u1',
      actorUserId: 'a1',
      amount: 100,
      note: 'тест',
    };
    const t0 = 1_700_000_000_000;
    const k1 = buildAdjustIdempotencyKey({ ...base, nowMs: t0 });
    const k2 = buildAdjustIdempotencyKey({
      ...base,
      nowMs: t0 + 30_000,
    });
    const k3 = buildAdjustIdempotencyKey({
      ...base,
      nowMs: t0 + 60_000,
    });
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k1.startsWith('adjust:h:')).toBe(true);
  });
});

describe('ReferralWalletService admin (Phase 5)', () => {
  let prisma: {
    user: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
    referralWalletLedger: {
      groupBy: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      aggregate: ReturnType<typeof vi.fn>;
    };
    order: { findUnique: ReturnType<typeof vi.fn> };
    orderReferralAttribution: { findUnique: ReturnType<typeof vi.fn> };
    $executeRaw: ReturnType<typeof vi.fn>;
    runInRlsTransaction: ReturnType<typeof vi.fn>;
  };
  let svc: ReferralWalletService;

  beforeEach(() => {
    prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
      },
      referralWalletLedger: {
        groupBy: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 1000 } }),
      },
      order: { findUnique: vi.fn().mockResolvedValue({ referralWalletAmount: 0 }) },
      orderReferralAttribution: { findUnique: vi.fn().mockResolvedValue(null) },
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      runInRlsTransaction: vi.fn(async (_ctx: unknown, fn: () => unknown) => fn()),
    };
    svc = new ReferralWalletService(prisma as never, {
      ensureDefaults: vi.fn(),
    } as never);
  });

  it('listReferrers: earnedNet только earn clawback; invitee отдельно', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'u1',
        email: 'a@b.c',
        displayName: 'Ann',
        referralCode: 'ABCD2345',
        referralCodeActive: true,
      },
    ]);
    prisma.referralWalletLedger.groupBy
      .mockResolvedValueOnce([{ userId: 'u1', _sum: { amount: 800 } }]) // posted
      .mockResolvedValueOnce([{ userId: 'u1', _sum: { amount: 200 } }]) // pending
      .mockResolvedValueOnce([{ userId: 'u1', _sum: { amount: 1200 } }]) // earned gross
      .mockResolvedValueOnce([{ userId: 'u1', _sum: { amount: -300 } }]) // earn clawback
      .mockResolvedValueOnce([{ userId: 'u1', _sum: { amount: -150 } }]); // invitee clawback

    const page = await svc.listReferrers({ limit: 10 });
    expect(page.items).toEqual([
      {
        userId: 'u1',
        email: 'a@b.c',
        displayName: 'Ann',
        referralCode: 'ABCD2345',
        referralCodeActive: true,
        available: 800,
        pending: 200,
        earnedGross: 1200,
        earnedNet: 900,
        inviteeClawback: 150,
      },
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('adminAdjust: +amount with stable idempotencyKey', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    prisma.referralWalletLedger.aggregate.mockResolvedValue({
      _sum: { amount: 500 },
    });

    const res = await svc.adminAdjust({
      userId: 'u1',
      amount: 100,
      actorUserId: 'admin1',
      note: 'тест',
      clientIdempotencyKey: 'adj-fixed-1',
    });

    expect(res).toEqual({ available: 600, amount: 100, replayed: false });
    expect(prisma.referralWalletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          kind: ReferralLedgerKind.ADJUST,
          status: ReferralLedgerStatus.POSTED,
          amount: 100,
          balanceAfter: 600,
          actorUserId: 'admin1',
          note: 'тест',
          idempotencyKey: 'adjust:client:u1:adj-fixed-1',
        }),
      }),
    );
  });

  it('adminAdjust: retry with same key replays (no double create)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    prisma.referralWalletLedger.findUnique.mockResolvedValue({
      amount: 100,
      kind: ReferralLedgerKind.ADJUST,
    });
    prisma.referralWalletLedger.aggregate.mockResolvedValue({
      _sum: { amount: 600 },
    });

    const res = await svc.adminAdjust({
      userId: 'u1',
      amount: 100,
      actorUserId: 'admin1',
      note: 'тест',
      clientIdempotencyKey: 'adj-fixed-1',
    });

    expect(res).toEqual({ available: 600, amount: 100, replayed: true });
    expect(prisma.referralWalletLedger.create).not.toHaveBeenCalled();
  });

  it('adminAdjust: не уходит ниже 0', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    prisma.referralWalletLedger.aggregate.mockResolvedValue({
      _sum: { amount: 50 },
    });
    await expect(
      svc.adminAdjust({
        userId: 'u1',
        amount: -100,
        actorUserId: 'admin1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adminAdjust: 404', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      svc.adminAdjust({
        userId: 'missing',
        amount: 10,
        actorUserId: 'admin1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getOrderReferralSummary: attribution + ledger totals + invitee bonus + roles', async () => {
    prisma.order.findUnique.mockResolvedValue({ referralWalletAmount: 700 });
    prisma.orderReferralAttribution.findUnique.mockResolvedValue({
      code: 'ABCD',
      referrerUserId: 'ref1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      referrer: { email: 'ref@x.co', referralCode: 'ABCD' },
    });
    prisma.referralWalletLedger.findMany.mockResolvedValue([
      {
        id: 'e1',
        kind: ReferralLedgerKind.EARN,
        status: ReferralLedgerStatus.PENDING,
        amount: 250,
        userId: 'ref1',
        createdAt: new Date('2026-03-01T01:00:00.000Z'),
        user: { email: 'ref@x.co', displayName: 'Ref' },
      },
      {
        id: 'b1',
        kind: ReferralLedgerKind.INVITEE_BONUS,
        status: ReferralLedgerStatus.POSTED,
        amount: 300,
        userId: 'buyer1',
        createdAt: new Date('2026-03-01T01:30:00.000Z'),
        user: { email: 'buyer@x.co', displayName: null },
      },
      {
        id: 'c1',
        kind: ReferralLedgerKind.CLAWBACK,
        status: ReferralLedgerStatus.POSTED,
        amount: -50,
        userId: 'buyer1',
        note: 'clawback invitee; target=0; original=300; owed=300; seq=1',
        createdAt: new Date('2026-03-01T01:45:00.000Z'),
        user: { email: 'buyer@x.co', displayName: null },
      },
      {
        id: 'h1',
        kind: ReferralLedgerKind.SPEND_HOLD,
        status: ReferralLedgerStatus.POSTED,
        amount: -700,
        userId: 'buyer1',
        note: null,
        createdAt: new Date('2026-03-01T02:00:00.000Z'),
        user: { email: 'buyer@x.co', displayName: null },
      },
    ]);

    const s = await svc.getOrderReferralSummary('ord1');
    expect(s.attribution?.code).toBe('ABCD');
    expect(s.walletSpent).toBe(700);
    expect(s.pending).toBe(250);
    expect(s.earned).toBe(0);
    expect(s.inviteeBonus).toBe(300);
    expect(s.inviteeBonusPending).toBe(0);
    expect(s.inviteeBonusClawback).toBe(50);
    expect(s.clawback).toBe(0);
    expect(s.spentHold).toBe(700);
    expect(s.entries).toHaveLength(4);
    expect(s.entries[0]).toMatchObject({
      walletRole: 'referrer_earn',
      userEmail: 'ref@x.co',
      userDisplayName: 'Ref',
    });
    expect(s.entries[1]).toMatchObject({
      walletRole: 'invitee_bonus',
      userEmail: 'buyer@x.co',
    });
    expect(s.entries[2]).toMatchObject({
      walletRole: 'invitee_bonus',
      kind: ReferralLedgerKind.CLAWBACK,
    });
    expect(s.entries[3]).toMatchObject({
      walletRole: 'buyer_spend',
      userId: 'buyer1',
    });
  });
});
