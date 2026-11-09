/**
 * Integration specs: spend path XOR / guest / hold / release abandon / admin refund.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { OrdersPublicService } from '../orders/orders.public.service';
import { OrderPayTokenService } from '../orders/order-pay-token.service';
import {
  hashCartLines,
  hashShippingAddress,
  ShippingQuoteService,
} from '../orders/shipping-quote.service';
import { OrdersAdminService } from '../orders/orders-admin.service';
import { cancelUnpaidOrderInTx } from '../orders/cancel-unpaid-order';

vi.mock('../orders/order-stock', () => ({
  reserveStockForLines: vi.fn(async () => undefined),
  releaseStockReserve: vi.fn(async () => undefined),
  commitStockOnPaid: vi.fn(async () => undefined),
  restoreStockOnPaidCancel: vi.fn(async () => undefined),
}));

vi.mock('../gift-certificates/gift-certificate-hold.util', () => ({
  holdGiftCertificateForOrder: vi.fn(async () => undefined),
  releaseGiftCertificateForOrder: vi.fn(async () => false),
  findUsableGiftCertificate: vi.fn(),
  computeGiftApplyAmount: vi.fn(),
}));

describe('referral spend flow', () => {
  const referralWallet = {
    quoteSpend: vi.fn(),
    holdSpendInTx: vi.fn(async () => undefined),
    releaseSpendInTx: vi.fn(async () => true),
    replaceSpendHoldInTx: vi.fn(async () => undefined),
    touch: vi.fn(async () => undefined),
  };

  const order = {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  };
  const payment = {
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
  };
  const promoCodeRedemption = {
    count: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const orderEvent = { create: vi.fn() };
  const orderAffiliateLead = { create: vi.fn().mockResolvedValue({ id: 'al1' }) };
  const cartSettings = {
    findUnique: vi.fn().mockResolvedValue({ freeShippingThresholdRub: 10_000 }),
  };
  const productVariant = {
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  };
  const tx = {
    order,
    payment,
    promoCodeRedemption,
    orderEvent,
    orderAffiliateLead,
    productVariant,
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ max_n: 1 }]),
  };
  const prisma = {
    order,
    payment,
    promoCodeRedemption,
    orderEvent,
    cartSettings,
    productVariant,
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    runInRlsTransaction: vi.fn(async (_ctx: unknown, fn: () => unknown) => fn()),
    runIsolatedRlsTransaction: vi.fn(
      async (_ctx: unknown, fn: () => unknown) => fn(),
    ),
  };

  const catalogPublic = { syncCartLines: vi.fn() };
  const promoPublic = { applyForCheckout: vi.fn() };
  const giftsPublic = { applyForCheckout: vi.fn() };
  const settingsPublic = {
    getApplicableGift: vi.fn(async () => ({ applicable: false })),
  };
  const yookassa = {
    createEmbeddedPayment: vi.fn(),
    getPayment: vi.fn(),
    isConfigured: vi.fn(() => true),
    createRefund: vi.fn(),
    cancelPaymentsBestEffort: vi.fn(async () => undefined),
    cancelPayment: vi.fn(),
  };
  const yandexPay = {
    isConfigured: vi.fn(() => true),
    isSandbox: vi.fn(() => false),
    merchantId: vi.fn(() => 'mid-test'),
    cancelOrdersBestEffort: vi.fn(async () => undefined),
    getOrder: vi.fn(),
    createOrder: vi.fn(),
    createRefund: vi.fn(),
    verifyWebhookJwt: vi.fn(),
  };
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'ORDER_AWAITING_TTL_MINUTES') return '60';
      if (key === 'ORDER_PAY_SECRET') return 'test-pay-secret';
      if (key === 'FRONTEND_PUBLIC_URL') return 'http://localhost:3000';
      return undefined;
    }),
  };

  let publicService: OrdersPublicService;

  function makePublicService() {
    const payTokens = new OrderPayTokenService(config as never);
    const shippingQuotes = new ShippingQuoteService(config as never);
    return new OrdersPublicService(
      prisma as never,
      catalogPublic as never,
      promoPublic as never,
      giftsPublic as never,
      settingsPublic as never,
      yookassa as never,
      yandexPay as never,
      config as never,
      payTokens,
      shippingQuotes,
      { estimate: vi.fn() } as never,
      {
        addEvent: vi.fn(async () => ({})),
        notifyCustomer: vi.fn(async () => undefined),
        notifyOrderAwaitingPayment: vi.fn(async () => undefined),
        notifyOrderCancelled: vi.fn(async () => undefined),
        notifyOrderPaid: vi.fn(async () => undefined),
        notifyAdminOrderCreated: vi.fn(async () => undefined),
        notifyGiftPurchasePaid: vi.fn(async () => undefined),
        notifyGiftBuyerCopy: vi.fn(async () => undefined),
        notifyOrderRefund: vi.fn(async () => undefined),
      } as never,
      {
        seedCustomerNoteFromOrder: vi.fn(),
        applyRetentionForOrder: vi.fn(async () => undefined),
      } as never,
      undefined,
      undefined,
      undefined,
      referralWallet as never,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) =>
      fn(tx),
    );
    catalogPublic.syncCartLines.mockResolvedValue({
      items: [
        {
          variantId: 'v1',
          shadeId: null,
          shadeName: null,
          name: 'Товар',
          variantName: '50 мл',
          sku: 'SKU-1',
          price: 2000,
          qty: 1,
        },
      ],
      pricing: null,
    });
    order.findUnique.mockResolvedValue(null);
    order.findMany.mockResolvedValue([]);
    referralWallet.quoteSpend.mockResolvedValue({
      enabled: true,
      available: 1500,
      spendCapPercent: 50,
      amount: 1000,
    });
    publicService = makePublicService();
  });

  describe('create XOR / guest', () => {
    it('отклоняет wallet + promo', async () => {
      await expect(
        publicService.create(
          {
            email: 'a@b.co',
            phone: '+79001234567',
            customerName: 'Иван',
            guestId: 'guest-123456',
            idempotencyKey: 'idem-xor-promo',
            promoCode: 'SALE',
            useReferralWallet: true,
            lines: [{ variantId: 'v1', qty: 1 }],
            shippingMethod: 'CDEK',
            shippingAddress: {
              city: 'Москва',
              address: 'Тверская 1',
            },
          } as never,
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(referralWallet.holdSpendInTx).not.toHaveBeenCalled();
    });

    it('отклоняет wallet + gift', async () => {
      await expect(
        publicService.create(
          {
            email: 'a@b.co',
            phone: '+79001234567',
            customerName: 'Иван',
            guestId: 'guest-123456',
            idempotencyKey: 'idem-xor-gift',
            giftCertificateCode: 'GIFT-1',
            useReferralWallet: true,
            lines: [{ variantId: 'v1', qty: 1 }],
            shippingMethod: 'CDEK',
            shippingAddress: {
              city: 'Москва',
              address: 'Тверская 1',
            },
          } as never,
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('отклоняет wallet без JWT (guest)', async () => {
      await expect(
        publicService.create({
          email: 'a@b.co',
          phone: '+79001234567',
          customerName: 'Иван',
          guestId: 'guest-123456',
          idempotencyKey: 'idem-guest-wallet',
          useReferralWallet: true,
          lines: [{ variantId: 'v1', qty: 1 }],
          shippingMethod: 'CDEK',
          shippingAddress: {
            city: 'Москва',
            address: 'Тверская 1',
          },
        } as never),
      ).rejects.toMatchObject({
        message: expect.stringMatching(/войдите/i),
      });
    });

    it('create + useReferralWallet → holdSpendInTx', async () => {
      const lines = [{ variantId: 'v1', shadeId: null as string | null, qty: 1 }];
      const shippingAddress = {
        city: 'Москва',
        address: 'Тверская 1',
        comment:
          '__VSP:carrier=cdek|lon=|lat=|pvz=MSK45|dropoff=pvz__\nТип доставки: СДЭК ПВЗ.',
        pvzCode: 'MSK45',
      };
      const shippingQuotes = new ShippingQuoteService(config as never);
      const { quote } = shippingQuotes.issue({
        cost: 350,
        method: 'CDEK',
        addrHash: hashShippingAddress(shippingAddress, 'CDEK'),
        linesHash: hashCartLines(lines),
        goodsSubtotal: 2000,
        freePvz: false,
      });

      order.create.mockImplementation(
        async ({ data }: { data: { items: { create: unknown[] } } }) => ({
          id: 'ord-hold-1',
          number: 'MF-HOLD-1',
          status: OrderStatus.AWAITING_PAYMENT,
          email: 'a@b.co',
          phone: '+79001234567',
          subtotal: 2000,
          discountTotal: 0,
          giftCertificateAmount: 0,
          giftCertificateCode: null,
          referralWalletAmount: 1000,
          total: 1000,
          promoCode: null,
          guestId: 'guest-123456',
          items: data.items.create,
        }),
      );

      await publicService.create(
        {
          email: 'a@b.co',
          phone: '+79001234567',
          customerName: 'Иван',
          guestId: 'guest-123456',
          idempotencyKey: 'idem-wallet-hold',
          useReferralWallet: true,
          lines,
          shippingMethod: 'CDEK',
          shippingAddress,
          shippingQuote: quote,
        } as never,
        'user-1',
      );

      expect(referralWallet.quoteSpend).toHaveBeenCalledWith('user-1', expect.any(Number));
      expect(referralWallet.holdSpendInTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: 'user-1',
          orderId: 'ord-hold-1',
          amount: 1000,
        }),
      );
    });
  });

  describe('hold + release abandon', () => {
    it('cancelUnpaid → RELEASE wallet hold', async () => {
      const cancelTx = {
        payment: {
          findMany: vi.fn().mockResolvedValue([]),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        promoCodeRedemption: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        order: {
          update: vi.fn().mockResolvedValue({
            id: 'ord-w',
            status: OrderStatus.CANCELLED,
          }),
        },
        orderEvent: { create: vi.fn().mockResolvedValue({}) },
        $executeRaw: vi.fn(),
        $queryRaw: vi.fn(),
        productVariant: { update: vi.fn() },
      };

      await cancelUnpaidOrderInTx(cancelTx as never, {
        orderId: 'ord-w',
        fromStatus: OrderStatus.AWAITING_PAYMENT,
        items: [{ variantId: 'v1', qty: 1 }],
        reason: 'abandon',
        referralWallet: referralWallet as never,
      });

      expect(referralWallet.releaseSpendInTx).toHaveBeenCalledWith(
        cancelTx,
        'ord-w',
        expect.objectContaining({ note: expect.stringMatching(/реф/i) }),
      );
    });
  });

  describe('admin refund wallet', () => {
    const adminOrder = {
      findUnique: vi.fn(),
      update: vi.fn(),
    };
    const adminTx = {
      order: adminOrder,
      payment: { updateMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      orderEvent: { create: vi.fn() },
      productVariant: { update: vi.fn() },
      giftCertificate: { findMany: vi.fn().mockResolvedValue([]) },
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'o1' }]),
    };
    const adminPrisma = {
      order: adminOrder,
      $transaction: vi.fn(async (fn: (t: typeof adminTx) => unknown) =>
        fn(adminTx),
      ),
      runInRlsTransaction: vi.fn(async (_ctx: unknown, fn: () => unknown) =>
        fn(),
      ),
    };
    const lifecycle = {
      addEvent: vi.fn(async () => ({})),
      notifyCustomer: vi.fn(),
      notifyOrderRefund: vi.fn(),
    };

    function makeAdmin() {
      return new OrdersAdminService(
        adminPrisma as never,
        lifecycle as never,
        yookassa as never,
        { isCdekConfigured: () => false, register: vi.fn() } as never,
        { get: vi.fn().mockReturnValue('http://localhost:5173') } as never,
        {
          applyRetentionForOrder: vi.fn(),
          seedCustomerNoteFromOrder: vi.fn(),
        } as never,
        { createAdmin: vi.fn() } as never,
        {
          isConfigured: () => false,
          cancelOrdersBestEffort: async () => undefined,
          createRefund: vi.fn(),
        } as never,
        undefined,
        referralWallet as never,
      );
    }

    beforeEach(() => {
      adminPrisma.$transaction.mockImplementation(
        async (fn: (t: typeof adminTx) => unknown) => fn(adminTx),
      );
      adminOrder.update.mockResolvedValue({});
      adminPrisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        number: 'MF-1',
        status: OrderStatus.REFUNDED,
        email: 'a@b.com',
        promoCode: null,
        promoRedemption: null,
        items: [],
        payments: [],
        events: [],
        referralWalletAmount: 1000,
      });
      referralWallet.releaseSpendInTx.mockResolvedValue(true);
    });

    it('частичный card refund при wallet → запрет', async () => {
      adminOrder.findUnique.mockResolvedValue({
        id: 'o1',
        number: 'MF-1',
        status: OrderStatus.PAID,
        email: 'a@b.com',
        total: 3000,
        refundedAmount: 0,
        giftCertificateAmount: 0,
        referralWalletAmount: 1000,
        giftPurchaseDenominationId: null,
        items: [{ variantId: 'v1', qty: 1 }],
        payments: [
          {
            id: 'p1',
            amount: 2000,
            status: PaymentStatus.SUCCEEDED,
            provider: 'yookassa',
          },
        ],
      });

      const admin = makeAdmin();
      await expect(
        admin.refund('o1', 'admin1', { amount: 500 }),
      ).rejects.toMatchObject({
        message: expect.stringMatching(/реферальн|только полный/i),
      });
      expect(referralWallet.releaseSpendInTx).not.toHaveBeenCalled();
    });

    it('полный refund → RELEASE wallet', async () => {
      adminOrder.findUnique.mockResolvedValue({
        id: 'o1',
        number: 'MF-1',
        status: OrderStatus.PAID,
        email: 'a@b.com',
        total: 3000,
        refundedAmount: 0,
        giftCertificateAmount: 0,
        referralWalletAmount: 1000,
        giftPurchaseDenominationId: null,
        items: [{ variantId: 'v1', qty: 1 }],
        payments: [
          {
            id: 'p1',
            amount: 2000,
            status: PaymentStatus.SUCCEEDED,
            provider: 'yookassa',
          },
        ],
      });

      const admin = makeAdmin();
      // getById after refund — slim mock ok for this assert
      vi.spyOn(admin, 'getById').mockResolvedValue({ id: 'o1' } as never);

      await admin.refund('o1', 'admin1', { amount: 2000 });

      expect(referralWallet.releaseSpendInTx).toHaveBeenCalledWith(
        adminTx,
        'o1',
        expect.objectContaining({ note: expect.stringMatching(/refund|возврат/i) }),
      );
    });
  });
});
