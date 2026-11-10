import {
  ReferralLedgerKind,
  ReferralLedgerStatus,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReferralWalletService } from './referral-wallet.service';

describe('ReferralWalletService spend', () => {
  let prisma: {
    referralWalletLedger: {
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      aggregate: ReturnType<typeof vi.fn>;
    };
    $executeRaw: ReturnType<typeof vi.fn>;
  };
  let settings: { ensureDefaults: ReturnType<typeof vi.fn> };
  let svc: ReferralWalletService;

  beforeEach(() => {
    prisma = {
      referralWalletLedger: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockImplementation(
          (args: { where?: { kind?: unknown } }) => {
            if (args?.where?.kind === ReferralLedgerKind.DEBT) {
              return Promise.resolve({ _sum: { amount: 0 } });
            }
            return Promise.resolve({ _sum: { amount: 2000 } });
          },
        ),
      },
      $executeRaw: vi.fn().mockResolvedValue(undefined),
    };
    settings = {
      ensureDefaults: vi.fn().mockResolvedValue({
        enabled: true,
        spendCapPercent: 50,
      }),
    };
    svc = new ReferralWalletService(prisma as never, settings as never);
  });

  it('computeSpendAmount: min(available, cap%, payable)', () => {
    expect(
      svc.computeSpendAmount({
        available: 5000,
        payableRub: 4000,
        spendCapPercent: 50,
      }),
    ).toBe(2000);
    expect(
      svc.computeSpendAmount({
        available: 100,
        payableRub: 4000,
        spendCapPercent: 100,
      }),
    ).toBe(100);
  });

  it('holdSpendInTx пишет SPEND_HOLD POSTED −amount', async () => {
    await svc.holdSpendInTx(prisma as never, {
      userId: 'u1',
      orderId: 'ord1',
      amount: 500,
    });
    expect(prisma.referralWalletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          kind: ReferralLedgerKind.SPEND_HOLD,
          status: ReferralLedgerStatus.POSTED,
          amount: -500,
          idempotencyKey: 'spend_hold:ord1',
          balanceAfter: 1500,
        }),
      }),
    );
  });

  it('releaseSpendInTx восстанавливает net hold', async () => {
    prisma.referralWalletLedger.findMany = vi.fn().mockImplementation(
      async (args: { where?: { kind?: unknown } }) => {
        if (args?.where?.kind === ReferralLedgerKind.DEBT) return [];
        return [
          {
            userId: 'u1',
            kind: ReferralLedgerKind.SPEND_HOLD,
            amount: -500,
          },
        ];
      },
    );
    prisma.referralWalletLedger.aggregate.mockImplementation(
      async (args: { where?: { kind?: unknown } }) => {
        if (args?.where?.kind === ReferralLedgerKind.DEBT) {
          return { _sum: { amount: 0 } };
        }
        return { _sum: { amount: 1500 } };
      },
    );

    const ok = await svc.releaseSpendInTx(prisma as never, 'ord1');
    expect(ok).toBe(500);
    expect(prisma.referralWalletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: ReferralLedgerKind.SPEND_RELEASE,
          amount: 500,
          idempotencyKey: 'spend_release:ord1',
          balanceAfter: 2000,
        }),
      }),
    );
  });

  it('quoteSpend учитывает cap; enabled=false не блокирует amount', async () => {
    const q = await svc.quoteSpend('u1', 4000);
    expect(q).toEqual({
      enabled: true,
      available: 2000,
      spendCapPercent: 50,
      amount: 2000,
      debt: 0,
    });

    settings.ensureDefaults.mockResolvedValue({
      enabled: false,
      spendCapPercent: 50,
    });
    const off = await svc.quoteSpend('u1', 4000);
    expect(off.enabled).toBe(false);
    expect(off.amount).toBe(2000);
  });

  it('quoteSpend / hold: debt > 0 блокирует spend', async () => {
    prisma.referralWalletLedger.aggregate.mockImplementation(
      (args: { where?: { kind?: unknown } }) => {
        if (args?.where?.kind === ReferralLedgerKind.DEBT) {
          return Promise.resolve({ _sum: { amount: 400 } });
        }
        return Promise.resolve({ _sum: { amount: 2000 } });
      },
    );
    const q = await svc.quoteSpend('u1', 4000);
    expect(q.amount).toBe(0);
    expect(q.debt).toBe(400);

    await expect(
      svc.holdSpendInTx(prisma as never, {
        userId: 'u1',
        orderId: 'ord-debt',
        amount: 100,
      }),
    ).rejects.toThrow(/долг/i);
  });

  it('hold P2002: silent return если |amount| совпадает', async () => {
    const { Prisma } = await import('@prisma/client');
    prisma.referralWalletLedger.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    prisma.referralWalletLedger.findUnique = vi.fn().mockResolvedValue({
      amount: -500,
    });

    await expect(
      svc.holdSpendInTx(prisma as never, {
        userId: 'u1',
        orderId: 'ord1',
        amount: 500,
      }),
    ).resolves.toBeUndefined();
  });

  it('hold P2002: throw если |amount| не совпадает', async () => {
    const { Prisma } = await import('@prisma/client');
    prisma.referralWalletLedger.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    prisma.referralWalletLedger.findUnique = vi.fn().mockResolvedValue({
      amount: -300,
    });

    await expect(
      svc.holdSpendInTx(prisma as never, {
        userId: 'u1',
        orderId: 'ord1',
        amount: 500,
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/не совпадает/i),
    });
  });
});
