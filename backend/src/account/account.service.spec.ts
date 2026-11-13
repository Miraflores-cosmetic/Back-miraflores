import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccountService } from './account.service';

function makeTx() {
  return {
    userAddress: {
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
  };
}

function makePrisma(tx: ReturnType<typeof makeTx>) {
  return {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    userAddress: tx.userAddress,
    order: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    orderReferralAttribution: {
      count: vi.fn(async () => 0),
    },
    referralWalletLedger: {
      count: vi.fn(async () => 0),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
}

describe('AccountService', () => {
  let tx: ReturnType<typeof makeTx>;
  let prisma: ReturnType<typeof makePrisma>;
  let payTokens: {
    issue: ReturnType<typeof vi.fn>;
  };
  let referralCodes: {
    ensureForUser: ReturnType<typeof vi.fn>;
  };
  let referralWallet: {
    availableBalance: ReturnType<typeof vi.fn>;
    pendingBalance: ReturnType<typeof vi.fn>;
    getSpendPolicy: ReturnType<typeof vi.fn>;
    getBuyerShare: ReturnType<typeof vi.fn>;
    listLedgerHistory: ReturnType<typeof vi.fn>;
    quoteSpend: ReturnType<typeof vi.fn>;
    releaseSpendInTx: ReturnType<typeof vi.fn>;
  };
  let svc: AccountService;

  beforeEach(() => {
    tx = makeTx();
    prisma = makePrisma(tx);
    payTokens = {
      issue: vi.fn().mockReturnValue('tok'),
    };
    referralCodes = {
      ensureForUser: vi.fn(async () => ({
        code: 'ABCD2345',
        active: true,
        created: false,
      })),
    };
    referralWallet = {
      availableBalance: vi.fn(async () => 0),
      pendingBalance: vi.fn(async () => 0),
      getSpendPolicy: vi.fn(async () => ({
        enabled: true,
        spendCapPercent: 50,
        linkTtlDays: 60,
        earnPercent: 5,
        quarantineMode: 'DELIVERED',
        quarantineDays: 7,
      })),
      getBuyerShare: vi.fn(async () => ({
        shareTextTemplate: 'Закажи: {link}',
        inviteeBonusEnabled: false,
        inviteeBonusRub: 0,
      })),
      listLedgerHistory: vi.fn(async () => ({ items: [], nextCursor: null })),
      quoteSpend: vi.fn(async () => ({
        enabled: true,
        available: 0,
        spendCapPercent: 50,
        amount: 0,
      })),
      releaseSpendInTx: vi.fn(async () => false),
    };
    svc = new AccountService(
      prisma as never,
      payTokens as never,
      {
        cancelPaymentsBestEffort: vi.fn(async () => undefined),
      } as never,
      {
        isConfigured: () => false,
        cancelOrdersBestEffort: vi.fn(async () => undefined),
      } as never,
      {} as never,
      { applyRetentionForOrder: vi.fn() } as never,
      referralCodes as never,
      referralWallet as never,
      { bindByCode: vi.fn(async () => ({ bound: false, referrerUserId: null })) } as never,
      {
        get: vi.fn((key: string) =>
          key === 'FRONTEND_PUBLIC_URL' ? 'https://shop.test' : undefined,
        ),
      } as never,
    );
  });

  it('updateProfile нормализует phone в E.164', async () => {
    prisma.user.update.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      displayName: null,
      phone: '+79001234567',
      marketingConsent: false,
      marketingConsentAt: null,
      createdAt: new Date(),
    });
    await svc.updateProfile('u1', { phone: '8 (900) 123-45-67' });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phone: '+79001234567' }),
      }),
    );
  });

  it('updateProfile отклоняет некорректный phone', async () => {
    await expect(
      svc.updateProfile('u1', { phone: '123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createAddress: первый адрес становится default', async () => {
    tx.userAddress.count.mockResolvedValue(0);
    tx.userAddress.create.mockResolvedValue({
      id: 'a1',
      isDefault: true,
      city: 'Москва',
      address: 'Тверская 1',
    });

    await svc.createAddress('u1', {
      city: 'Москва',
      address: 'Тверская 1',
      isDefault: false,
    });

    expect(tx.userAddress.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isDefault: true }),
      }),
    );
  });

  it('updateAddress isDefault:true снимает default с остальных', async () => {
    prisma.userAddress.findUnique.mockResolvedValue({
      id: 'a2',
      userId: 'u1',
      isDefault: false,
    });
    tx.userAddress.update.mockResolvedValue({
      id: 'a2',
      isDefault: true,
      city: 'Москва',
      address: 'Арбат 2',
    });

    await svc.updateAddress('u1', 'a2', {
      city: 'Москва',
      address: 'Арбат 2',
      isDefault: true,
    });

    expect(tx.userAddress.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', isDefault: true },
      data: { isDefault: false },
    });
    expect(tx.userAddress.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isDefault: true }),
      }),
    );
  });

  it('updateAddress isDefault:false снимает default и промоутит другой', async () => {
    prisma.userAddress.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'u1',
      isDefault: true,
    });
    tx.userAddress.update
      .mockResolvedValueOnce({
        id: 'a1',
        isDefault: false,
        city: 'Москва',
        address: 'Тверская 1',
      })
      .mockResolvedValueOnce({ id: 'a2', isDefault: true });
    tx.userAddress.findFirst.mockResolvedValue({ id: 'a2', userId: 'u1' });

    const res = await svc.updateAddress('u1', 'a1', {
      city: 'Москва',
      address: 'Тверская 1',
      isDefault: false,
    });

    expect(res.isDefault).toBe(false);
    expect(tx.userAddress.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({ isDefault: false }),
      }),
    );
    expect(tx.userAddress.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'a2' },
        data: { isDefault: true },
      }),
    );
  });

  it('updateAddress → NotFound для чужого адреса', async () => {
    prisma.userAddress.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'other',
      isDefault: true,
    });
    await expect(
      svc.updateAddress('u1', 'a1', { city: 'X', address: 'Y' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getOrder отдаёт payToken для AWAITING_PAYMENT', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'a@b.c' });
    prisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      userId: 'u1',
      number: 'J-1',
      status: 'AWAITING_PAYMENT',
      email: 'a@b.c',
      phone: '+79001112233',
      customerName: 'Ann',
      shippingAddress: { city: 'Москва', address: 'Тверская 1' },
      shippingCost: 0,
      subtotal: 1000,
      discountTotal: 0,
      total: 1000,
      refundedAmount: 0,
      promoCode: null,
      giftCertificateCode: null,
      giftCertificateAmount: 0,
      giftPurchaseDenominationId: null,
      guestId: 'guest-1',
      createdAt: new Date(),
      payments: [{ status: 'SUCCEEDED', amount: 1000 }],
      shipments: [],
      items: [],
    });

    const res = await svc.getOrder('u1', 'o1');
    expect(res.payToken).toBe('tok');
    expect(res.canCancel).toBe(true);
    expect(res.canPay).toBe(true);
    expect(res.payExpiresAt).toBeNull();
    expect(payTokens.issue).toHaveBeenCalledWith('o1', 'guest-1');
    expect(res.shippingAddress).toEqual(
      expect.objectContaining({ city: 'Москва', address: 'Тверская 1' }),
    );
  });

  it('listOrders: staff-заказ с тем же email виден и привязывается к userId', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'buyer@test.ru' });
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'o-staff',
        number: 'JCOS-139',
        status: 'AWAITING_PAYMENT',
        total: 10_200,
        subtotal: 10_200,
        shippingCost: 0,
        discountTotal: 0,
        giftCertificateAmount: 0,
        refundedAmount: 0,
        giftPurchaseDenominationId: null,
        createdAt: new Date(),
        userId: null,
        guestId: 'admin-guest',
        needsAddressClarification: false,
        payments: [],
        items: [],
        shipments: [],
      },
    ]);
    prisma.order.updateMany.mockResolvedValue({ count: 1 });

    const res = await svc.listOrders('u1');
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ userId: 'u1' }, { userId: null, email: 'buyer@test.ru' }],
        },
      }),
    );
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['o-staff'] }, userId: null },
      data: { userId: 'u1' },
    });
    expect(res).toHaveLength(1);
    expect(res[0].number).toBe('JCOS-139');
  });

  it('listOrders синтезирует guestId и отдаёт payToken', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'a@b.c' });
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'o1',
        number: 'J-1',
        status: 'AWAITING_PAYMENT',
        total: 500,
        subtotal: 500,
        shippingCost: 0,
        discountTotal: 0,
        giftCertificateAmount: 0,
        refundedAmount: 0,
        giftPurchaseDenominationId: null,
        needsAddressClarification: false,
        payments: [],
        createdAt: new Date(),
        guestId: null,
        items: [],
        shipments: [],
      },
    ]);
    prisma.order.update.mockResolvedValue({});

    const res = await svc.listOrders('u1');
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o1' },
        data: expect.objectContaining({ guestId: expect.any(String) }),
      }),
    );
    expect(res).toHaveLength(1);
    expect(res[0].canPay).toBe(true);
    expect(res[0].payToken).toBe('tok');
    expect(res[0].payExpiresAt).toBeNull();
    expect(payTokens.issue).toHaveBeenCalled();
  });

  it('getOrder canPay после «TTL» (старший заказ) — без payExpiresAt cutoff', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'a@b.c' });
    prisma.order.findFirst.mockResolvedValue({
      id: 'o-old',
      userId: 'u1',
      number: 'J-old',
      status: 'AWAITING_PAYMENT',
      email: 'a@b.c',
      phone: '+79001112233',
      customerName: 'Ann',
      shippingAddress: { city: 'Москва', address: 'Тверская 1' },
      shippingCost: 0,
      subtotal: 1000,
      discountTotal: 0,
      total: 1000,
      refundedAmount: 0,
      promoCode: null,
      giftCertificateCode: null,
      giftCertificateAmount: 0,
      guestId: 'guest-1',
      needsAddressClarification: false,
      giftPurchaseDenominationId: null,
      payments: [],
      shipments: [],
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60_000),
      items: [],
    });

    const res = await svc.getOrder('u1', 'o-old');
    expect(res.canPay).toBe(true);
    expect(res.payExpiresAt).toBeNull();
    expect(res.payToken).toBe('tok');
  });

  it('getOrder: needsAddressClarification → canPay=false, без payToken', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'a@b.c' });
    prisma.order.findFirst.mockResolvedValue({
      id: 'o-clar',
      userId: 'u1',
      number: 'J-clar',
      status: 'AWAITING_PAYMENT',
      email: 'a@b.c',
      phone: '+79001112233',
      customerName: 'Ann',
      shippingAddress: { city: '—', address: 'Адрес уточнит оператор' },
      shippingCost: 0,
      subtotal: 1000,
      discountTotal: 0,
      total: 1000,
      refundedAmount: 0,
      promoCode: null,
      giftCertificateCode: null,
      giftCertificateAmount: 0,
      guestId: 'guest-1',
      needsAddressClarification: true,
      giftPurchaseDenominationId: null,
      payments: [],
      shipments: [],
      createdAt: new Date(),
      items: [],
    });

    const res = await svc.getOrder('u1', 'o-clar');
    expect(res.needsAddressClarification).toBe(true);
    expect(res.canPay).toBe(false);
    expect(res.payToken).toBeNull();
    expect(res.canCancel).toBe(true);
    expect(payTokens.issue).not.toHaveBeenCalled();
  });

  it('getOrder → NotFound если заказ не найден', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'a@b.c' });
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(svc.getOrder('u1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('referral dashboard / ledger wiring', () => {
    it('getReferralDashboard: существующий код + dual balance + share', async () => {
      prisma.user.findUnique.mockResolvedValue({
        referralCode: 'MFCODE12',
        referralCodeActive: true,
      });
      referralWallet.availableBalance.mockResolvedValue(1500);
      referralWallet.pendingBalance.mockResolvedValue(400);
      referralWallet.getSpendPolicy.mockResolvedValue({
        enabled: true,
        spendCapPercent: 40,
        linkTtlDays: 45,
        earnPercent: 7,
        quarantineMode: 'DELIVERED_PLUS_DAYS',
        quarantineDays: 14,
      });
      referralWallet.getBuyerShare.mockResolvedValue({
        shareTextTemplate: 'Ссылка {link} код {code}',
        inviteeBonusEnabled: true,
        inviteeBonusRub: 300,
      });
      prisma.orderReferralAttribution.count.mockResolvedValue(3);
      prisma.referralWalletLedger.count.mockResolvedValue(2);

      const dash = await svc.getReferralDashboard('u1');

      expect(referralCodes.ensureForUser).not.toHaveBeenCalled();
      expect(referralWallet.availableBalance).toHaveBeenCalledWith('u1');
      expect(referralWallet.pendingBalance).toHaveBeenCalledWith('u1');
      expect(referralWallet.getSpendPolicy).toHaveBeenCalled();
      expect(referralWallet.getBuyerShare).toHaveBeenCalled();
      expect(dash).toEqual({
        enabled: true,
        code: 'MFCODE12',
        codeActive: true,
        linkPath: '/?mf=MFCODE12',
        shareTextTemplate: 'Ссылка {link} код {code}',
        available: 1500,
        pending: 400,
        spendCapPercent: 40,
        linkTtlDays: 45,
        earnPercent: 7,
        quarantineMode: 'DELIVERED_PLUS_DAYS',
        quarantineDays: 14,
        inviteeBonusEnabled: true,
        inviteeBonusRub: 300,
        friendsInvited: 3,
        friendsWithEarn: 2,
      });
    });

    it('getReferralDashboard: нет кода → ensureForUser, не реактивирует inactive', async () => {
      prisma.user.findUnique.mockResolvedValue({
        referralCode: null,
        referralCodeActive: false,
      });
      referralCodes.ensureForUser.mockResolvedValue({
        code: 'NEWcode1',
        active: true,
        created: true,
      });

      const dash = await svc.getReferralDashboard('u1');

      expect(referralCodes.ensureForUser).toHaveBeenCalledWith('u1');
      expect(dash.code).toBe('NEWcode1');
      expect(dash.codeActive).toBe(true);
      expect(dash.linkPath).toBe('/?mf=NEWcode1');
    });

    it('getReferralDashboard: inactive код без ensure', async () => {
      prisma.user.findUnique.mockResolvedValue({
        referralCode: 'OFFCODE1',
        referralCodeActive: false,
      });

      const dash = await svc.getReferralDashboard('u1');

      expect(referralCodes.ensureForUser).not.toHaveBeenCalled();
      expect(dash).toEqual(
        expect.objectContaining({
          code: 'OFFCODE1',
          codeActive: false,
          linkPath: '/?mf=OFFCODE1',
        }),
      );
    });

    it('getReferralDashboard → NotFound', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(svc.getReferralDashboard('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('listReferralLedger прокидывает limit/cursor в wallet', async () => {
      referralWallet.listLedgerHistory.mockResolvedValue({
        items: [
          {
            id: 'l1',
            createdAt: '2026-06-01T12:00:00.000Z',
            kind: 'EARN',
            status: 'POSTED',
            amount: 250,
            orderNumber: null,
          },
        ],
        nextCursor: 'c1',
      });

      const page = await svc.listReferralLedger('u1', {
        limit: 10,
        cursor: 'prev',
      });

      expect(referralWallet.listLedgerHistory).toHaveBeenCalledWith('u1', {
        limit: 10,
        cursor: 'prev',
      });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].orderNumber).toBeNull();
      expect(page.nextCursor).toBe('c1');
    });

    it('quoteReferralSpend → wallet.quoteSpend', async () => {
      referralWallet.quoteSpend.mockResolvedValue({
        enabled: true,
        available: 900,
        spendCapPercent: 50,
        amount: 500,
      });
      const q = await svc.quoteReferralSpend('u1', 1000);
      expect(referralWallet.quoteSpend).toHaveBeenCalledWith('u1', 1000);
      expect(q.amount).toBe(500);
    });
  });
});
