import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { OrdersPublicService } from './orders.public.service';
import { OrderPayTokenService } from './order-pay-token.service';
import { ShippingQuoteService } from './shipping-quote.service';
import { ADDRESS_CLARIFICATION_MARKER } from './address-clarification';
import {
  claimAwaitingPaymentRemindCandidates,
  countDueAwaitingPaymentReminders,
} from './order-lock';
import { OrdersAdminService } from './orders-admin.service';

vi.mock('./order-stock', () => ({
  reserveStockForLines: vi.fn(async () => undefined),
  releaseStockReserve: vi.fn(async () => undefined),
  commitStockOnPaid: vi.fn(async () => undefined),
}));

vi.mock('../gift-certificates/gift-certificate-hold.util', () => ({
  holdGiftCertificateForOrder: vi.fn(async () => undefined),
  releaseGiftCertificateForOrder: vi.fn(async () => false),
  findUsableGiftCertificate: vi.fn(),
  computeGiftApplyAmount: vi.fn(),
}));

const order = {
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  count: vi.fn(),
};
const cartSettings = {
  findUnique: vi.fn().mockResolvedValue({ freeShippingThresholdRub: 10_000 }),
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
const orderEvent = {
  create: vi.fn(),
  findMany: vi.fn().mockResolvedValue([]),
};
const orderAffiliateLead = {
  create: vi.fn().mockResolvedValue({ id: 'al1' }),
};
const tx = {
  order,
  payment,
  promoCodeRedemption,
  orderEvent,
  orderAffiliateLead,
  $executeRaw: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn().mockResolvedValue([{ max_n: 1 }, { id: 'o1' }]),
};
const prisma = {
  order,
  payment,
  promoCodeRedemption,
  orderEvent,
  cartSettings,
  productVariant: {
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => {
    if (typeof fn === 'function') return fn(tx);
    if (Array.isArray(fn)) return Promise.all(fn);
    throw new Error('unexpected $transaction');
  }),
  runInRlsTransaction: vi.fn(async (_ctx: unknown, fn: () => unknown) => fn()),
  runIsolatedRlsTransaction: vi.fn(async (_ctx: unknown, fn: () => unknown) =>
    fn(),
  ),
};

const catalogPublic = {
  syncCartLines: vi.fn(),
};
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
const config = {
  get: vi.fn((key: string) => {
    if (key === 'ORDER_AWAITING_TTL_MINUTES') return '60';
    if (key === 'ORDER_PAY_SECRET') return 'test-pay-secret';
    if (key === 'FRONTEND_PUBLIC_URL') return 'http://localhost:3000';
    return undefined;
  }),
};

function makePublicService() {
  const payTokens = new OrderPayTokenService(config as never);
  const shippingQuotes = new ShippingQuoteService(config as never);
  const lifecycle = {
    addEvent: vi.fn(async () => ({})),
    notifyCustomer: vi.fn(async () => undefined),
    notifyOrderAwaitingPayment: vi.fn(async () => undefined),
    notifyOrderCancelled: vi.fn(async () => undefined),
    notifyOrderPaid: vi.fn(async () => undefined),
    notifyAdminOrderCreated: vi.fn(async () => undefined),
    notifyGiftPurchasePaid: vi.fn(async () => undefined),
    notifyGiftBuyerCopy: vi.fn(async () => undefined),
    notifyOrderRefund: vi.fn(async () => undefined),
    notifyOrderUpdated: vi.fn(async () => undefined),
  };
  return {
    service: new OrdersPublicService(
      prisma as never,
      catalogPublic as never,
      promoPublic as never,
      giftsPublic as never,
      settingsPublic as never,
      yookassa as never,
      config as never,
      payTokens,
      shippingQuotes,
      { estimate: vi.fn() } as never,
      lifecycle as never,
      {
        seedCustomerNoteFromOrder: vi.fn(),
        applyRetentionForOrder: vi.fn(async () => undefined),
      } as never,
    ),
    payTokens,
    lifecycle,
  };
}

describe('address clarification flow', () => {
  let service: OrdersPublicService;
  let payTokens: OrderPayTokenService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (fn: ((t: typeof tx) => unknown) | unknown[]) => {
        if (typeof fn === 'function') return fn(tx);
        if (Array.isArray(fn)) return Promise.all(fn);
        throw new Error('unexpected $transaction');
      },
    );
    cartSettings.findUnique.mockResolvedValue({ freeShippingThresholdRub: 10_000 });
    catalogPublic.syncCartLines.mockResolvedValue({
      items: [
        {
          variantId: 'v1',
          shadeId: null,
          shadeName: null,
          name: 'Товар',
          variantName: '50 мл',
          sku: 'SKU-1',
          price: 1000,
          qty: 1,
        },
      ],
      pricing: null,
    });
    settingsPublic.getApplicableGift.mockResolvedValue({ applicable: false });
    order.findUnique.mockResolvedValue(null);
    order.findMany.mockResolvedValue([]);
    payment.findMany.mockResolvedValue([]);
    const made = makePublicService();
    service = made.service;
    payTokens = made.payTokens;
  });

  describe('public create', () => {
    it('flag + marker → needsAddressClarification, shippingCost=0, без quote', async () => {
      order.create.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'ord-clar',
          number: 'MF-CLAR',
          status: OrderStatus.AWAITING_PAYMENT,
          email: 'a@b.co',
          phone: '+79001234567',
          subtotal: 1000,
          discountTotal: 0,
          giftCertificateAmount: 0,
          giftCertificateCode: null,
          total: 1000,
          promoCode: null,
          guestId: 'guest-123456',
          needsAddressClarification: data.needsAddressClarification,
          shippingCost: data.shippingCost,
          shippingMethod: data.shippingMethod,
          shippingAddress: data.shippingAddress,
          items: [],
        }),
      );

      const res = await service.create({
        email: 'a@b.co',
        phone: '+79001234567',
        customerName: 'Иван',
        guestId: 'guest-123456',
        idempotencyKey: 'idem-clar-1',
        lines: [{ variantId: 'v1', qty: 1 }],
        needsAddressClarification: true,
        shippingAddress: {
          city: '—',
          address: 'Адрес уточнит оператор',
          comment: `Тип доставки: Уточнит оператор.\n${ADDRESS_CLARIFICATION_MARKER}`,
        },
      } as never);

      expect(res.id).toBe('ord-clar');
      expect(res.needsAddressClarification).toBe(true);
      expect(res.payToken).toBeNull();
      expect(order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            needsAddressClarification: true,
            shippingCost: 0,
            shippingMethod: null,
            shippingAddress: expect.objectContaining({
              comment: expect.stringContaining(ADDRESS_CLARIFICATION_MARKER),
            }),
          }),
        }),
      );
    });

    it('spoof boolean без marker/синтетики → 400', async () => {
      await expect(
        service.create({
          email: 'a@b.co',
          phone: '+79001234567',
          customerName: 'Иван',
          guestId: 'guest-123456',
          idempotencyKey: 'idem-spoof',
          lines: [{ variantId: 'v1', qty: 1 }],
          needsAddressClarification: true,
          shippingAddress: {
            city: 'Москва',
            address: 'Тверская 1',
            comment: 'Тип доставки: СДЭК ПВЗ',
          },
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(order.create).not.toHaveBeenCalled();
    });
  });

  describe('createPayment', () => {
    it('блокирует оплату пока flag true', async () => {
      const token = payTokens.issue('ord1', 'guest-1');
      order.findUnique.mockResolvedValue({
        id: 'ord1',
        number: 'MF-1',
        guestId: 'guest-1',
        userId: null,
        email: 'a@b.co',
        status: OrderStatus.AWAITING_PAYMENT,
        total: 1000,
        needsAddressClarification: true,
        giftPurchaseDenominationId: null,
        items: [{ title: 'Item', qty: 1, unitPrice: 1000 }],
        payments: [],
      });

      await expect(
        service.createPayment('ord1', { payToken: token }),
      ).rejects.toThrow(/Оператор уточняет адрес/);
      expect(yookassa.createEmbeddedPayment).not.toHaveBeenCalled();
    });
  });
});

describe('claimAwaitingPaymentRemindCandidates — exclude clarification', () => {
  it('SQL WHERE содержит needsAddressClarification = false', async () => {
    const queryRaw = vi.fn(async () => []);
    await claimAwaitingPaymentRemindCandidates(
      { $queryRaw: queryRaw } as never,
      {
        now: new Date('2026-11-03T12:00:00Z'),
        remind1Minutes: 5,
        remind2Minutes: 24 * 60,
        remind3Minutes: 48 * 60,
      },
    );
    expect(queryRaw).toHaveBeenCalled();
    const strings = queryRaw.mock.calls[0]?.[0] as TemplateStringsArray;
    const sql = Array.from(strings).join('');
    expect(sql).toMatch(/needsAddressClarification"\s*=\s*false/);
  });

  it('countDueAwaitingPaymentReminders тоже исключает clarification', async () => {
    const queryRaw = vi.fn(async () => [{ n: 0n }]);
    await countDueAwaitingPaymentReminders(
      { $queryRaw: queryRaw },
      {
        now: new Date('2026-11-03T12:00:00Z'),
        remind1Minutes: 5,
        remind2Minutes: 24 * 60,
        remind3Minutes: 48 * 60,
      },
    );
    const strings = queryRaw.mock.calls[0]?.[0] as TemplateStringsArray;
    const sql = Array.from(strings).join('');
    expect(sql).toMatch(/needsAddressClarification"\s*=\s*false/);
  });
});

describe('OrdersAdminService clarification clear + list filter', () => {
  const orderCount = vi.fn();
  const orderFindMany = vi.fn();
  const orderFindUnique = vi.fn();
  const orderUpdate = vi.fn();
  const paymentFindMany = vi.fn();
  const paymentUpdateMany = vi.fn();
  const orderEventFindMany = vi.fn();
  const orderEventCreate = vi.fn();
  const queryRaw = vi.fn();

  const adminPrisma = {
    $transaction: vi.fn(async (ops: unknown) => {
      if (Array.isArray(ops)) return Promise.all(ops as Promise<unknown>[]);
      if (typeof ops === 'function') {
        return (ops as (t: unknown) => unknown)({
          order: {
            findUnique: orderFindUnique,
            update: orderUpdate,
          },
          payment: {
            findMany: paymentFindMany,
            updateMany: paymentUpdateMany,
          },
          orderEvent: { create: orderEventCreate },
          $queryRaw: queryRaw,
        });
      }
      throw new Error('unexpected $transaction');
    }),
    order: {
      count: orderCount,
      findMany: orderFindMany,
      findUnique: orderFindUnique,
    },
    orderEvent: { findMany: orderEventFindMany },
  };

  const lifecycle = {
    addEvent: vi.fn(async () => ({})),
    notifyOrderUpdated: vi.fn(async () => undefined),
  };

  let admin: OrdersAdminService;

  beforeEach(() => {
    vi.clearAllMocks();
    orderCount.mockResolvedValue(0);
    orderFindMany.mockResolvedValue([]);
    orderEventFindMany.mockResolvedValue([]);
    paymentFindMany.mockResolvedValue([]);
    paymentUpdateMany.mockResolvedValue({ count: 0 });
    queryRaw.mockResolvedValue([{ id: 'o1' }]);
    orderUpdate.mockResolvedValue({});
    admin = new OrdersAdminService(
      adminPrisma as never,
      lifecycle as never,
      {
        isConfigured: () => true,
        cancelPaymentsBestEffort: vi.fn(async () => undefined),
      } as never,
      { isCdekConfigured: () => false } as never,
      { get: vi.fn().mockReturnValue('http://localhost:5173') } as never,
      {
        unreadOrderChatCountsForStaff: vi.fn(async () => ({})),
        orderChatMessageCountsForOrders: vi.fn(async () => ({})),
      } as never,
      { createAdmin: vi.fn() } as never,
    );
    // getById after update — minimal stub via findUnique on prisma.order
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      number: 'MF-1',
      status: OrderStatus.AWAITING_PAYMENT,
      email: 'a@b.c',
      phone: '+7900',
      customerName: 'Ann',
      customerNote: null,
      shippingAddress: {},
      shippingMethod: 'CDEK',
      shippingCost: 350,
      needsAddressClarification: false,
      subtotal: 1000,
      discountTotal: 0,
      giftCertificateAmount: 0,
      giftCertificateCode: null,
      giftPurchaseDenominationId: null,
      giftPurchaseRecipientEmail: null,
      total: 1350,
      refundedAmount: 0,
      promoCode: null,
      pricingGroupId: null,
      pricingGroupName: null,
      pricingContext: null,
      guestId: 'g1',
      userId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      awaitingPaymentRemindStage: 0,
      user: null,
      items: [],
      payments: [],
      shipments: [],
      checklistMarks: [],
      events: [],
      promoRedemption: null,
      affiliateLead: null,
    });
  });

  it('updateShippingAddress: снимает flag и возвращает addressClarificationCleared', async () => {
    orderFindUnique
      .mockResolvedValueOnce({
        id: 'o1',
        number: 'MF-1',
        status: OrderStatus.AWAITING_PAYMENT,
        email: 'a@b.c',
        phone: '+7900',
        giftPurchaseDenominationId: null,
        shippingCost: 0,
        subtotal: 1000,
        discountTotal: 0,
        giftCertificateAmount: 0,
        total: 1000,
        shippingMethod: null,
        needsAddressClarification: true,
        shippingAddress: {
          city: '—',
          address: 'Адрес уточнит оператор',
          comment: `Тип доставки: Уточнит оператор.\n${ADDRESS_CLARIFICATION_MARKER}`,
        },
        payments: [],
        shipments: [],
      })
      // getById after tx
      .mockResolvedValueOnce({
        id: 'o1',
        number: 'MF-1',
        status: OrderStatus.AWAITING_PAYMENT,
        email: 'a@b.c',
        phone: '+7900',
        customerName: 'Ann',
        customerNote: null,
        shippingAddress: {
          city: 'Москва',
          address: 'Тверская 1',
          comment: '__JCOS:carrier=cdek|dropoff=pvz|pvz=MSK1__',
          pvzCode: 'MSK1',
        },
        shippingMethod: 'CDEK',
        shippingCost: 350,
        needsAddressClarification: false,
        subtotal: 1000,
        discountTotal: 0,
        giftCertificateAmount: 0,
        giftCertificateCode: null,
        giftPurchaseDenominationId: null,
        giftPurchaseRecipientEmail: null,
        total: 1350,
        refundedAmount: 0,
        promoCode: null,
        pricingGroupId: null,
        pricingGroupName: null,
        pricingContext: null,
        guestId: 'g1',
        userId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        awaitingPaymentRemindStage: 0,
        user: null,
        items: [],
        payments: [],
        shipments: [],
        checklistMarks: [],
        events: [],
        promoRedemption: null,
        affiliateLead: null,
      });

    const res = await admin.updateShippingAddress('o1', 'admin1', {
      city: 'Москва',
      address: 'Тверская 1',
      comment: '__JCOS:carrier=cdek|dropoff=pvz|pvz=MSK1__',
      pvzCode: 'MSK1',
      shippingMethod: 'CDEK',
      shippingCost: 350,
    });

    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          needsAddressClarification: false,
          shippingMethod: 'CDEK',
          shippingCost: 350,
        }),
      }),
    );
    expect(res.addressClarificationCleared).toBe(true);
    expect(res.needsAddressClarification).toBe(false);
  });

  it('markPaid: soft-block пока needsAddressClarification', async () => {
    orderFindUnique.mockResolvedValueOnce({
      needsAddressClarification: true,
      status: OrderStatus.AWAITING_PAYMENT,
    });
    await expect(admin.markPaid('o1', 'admin1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(adminPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('createCheckoutPayment: soft-block пока needsAddressClarification', async () => {
    orderFindUnique.mockResolvedValueOnce({
      id: 'o1',
      needsAddressClarification: true,
      status: OrderStatus.AWAITING_PAYMENT,
      giftPurchaseDenominationId: null,
      total: 1000,
      payments: [],
    });
    await expect(
      admin.createCheckoutPayment('o1', 'admin1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('list(clarificationOnly) + addressClarificationCount', async () => {
    orderCount.mockResolvedValue(2);
    orderFindMany.mockResolvedValue([
      {
        id: 'o-clar',
        number: 'MF-C',
        status: OrderStatus.AWAITING_PAYMENT,
        email: 'a@b.c',
        phone: '+7900',
        customerName: 'Ann',
        total: 1000,
        refundedAmount: 0,
        userId: null,
        createdAt: new Date(),
        awaitingPaymentRemindStage: 0,
        shippingMethod: null,
        needsAddressClarification: true,
        adminViewedAt: null,
        shipments: [],
      },
    ]);

    const list = await admin.list({ clarificationOnly: true, page: 1, limit: 20 });
    const findWhere = orderFindMany.mock.calls[0]?.[0]?.where;
    expect(findWhere).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            needsAddressClarification: true,
            status: {
              in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.NEW],
            },
          }),
        ]),
      }),
    );
    expect(list.items[0].needsAddressClarification).toBe(true);

    orderCount.mockResolvedValue(4);
    const counted = await admin.addressClarificationCount();
    expect(counted).toEqual({ count: 4 });
    expect(orderCount).toHaveBeenLastCalledWith({
      where: {
        needsAddressClarification: true,
        status: { in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.NEW] },
      },
    });
  });
});
