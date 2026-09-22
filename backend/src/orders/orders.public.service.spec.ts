import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { OrdersPublicService } from './orders.public.service';
import { OrderPayTokenService } from './order-pay-token.service';
import {
  hashCartLines,
  hashShippingAddress,
  ShippingQuoteService,
} from './shipping-quote.service';

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

import { releaseStockReserve } from './order-stock';

const order = {
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
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
};

const tx = {
  order,
  payment,
  promoCodeRedemption,
  orderEvent,
  $queryRaw: vi.fn().mockResolvedValue([{ id: 'x' }]),
};

const prisma = {
  order,
  payment,
  promoCodeRedemption,
  orderEvent,
  cartSettings,
  productVariant: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
};

const catalogPublic = {
  syncCartLines: vi.fn(),
};
const promoPublic = {
  applyForCheckout: vi.fn(),
};
const giftsPublic = {
  applyForCheckout: vi.fn(),
};
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

function makeService() {
  const payTokens = new OrderPayTokenService(config as never);
  const shippingQuotes = new ShippingQuoteService(config as never);
  const lifecycle = {
    addEvent: vi.fn(async () => ({})),
    notifyCustomer: vi.fn(async () => undefined),
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
      lifecycle as never,
    ),
    lifecycle,
    payTokens,
  };
}

describe('OrdersPublicService', () => {
  let service: OrdersPublicService;
  let payTokens: OrderPayTokenService;
  let lifecycle: {
    addEvent: ReturnType<typeof vi.fn>;
    notifyCustomer: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) =>
      fn(tx),
    );
    config.get.mockImplementation((key: string) => {
      if (key === 'ORDER_AWAITING_TTL_MINUTES') return '60';
      if (key === 'ORDER_PAY_SECRET') return 'test-pay-secret';
      if (key === 'FRONTEND_PUBLIC_URL') return 'http://localhost:3000';
      return undefined;
    });
    order.findMany.mockResolvedValue([]);
    yookassa.isConfigured.mockReturnValue(true);
    const made = makeService();
    service = made.service;
    payTokens = made.payTokens;
    lifecycle = made.lifecycle;
  });

  describe('create', () => {
    it('отклоняет некорректный телефон', async () => {
      await expect(
        service.create({
          email: 'a@b.co',
          phone: '123',
          customerName: 'Иван',
          guestId: 'guest-123456',
          idempotencyKey: 'idem-key-1',
          lines: [{ variantId: 'v1', qty: 1 }],
          shippingAddress: { city: 'Москва', address: 'Тверская 1' },
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('требует город и адрес', async () => {
      await expect(
        service.create({
          email: 'a@b.co',
          phone: '+79001234567',
          customerName: 'Иван',
          guestId: 'guest-123456',
          idempotencyKey: 'idem-key-1',
          lines: [{ variantId: 'v1', qty: 1 }],
          shippingAddress: { city: '', address: '' },
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('идемпотентен: возвращает существующий заказ с payToken', async () => {
      const existing = {
        id: 'ord1',
        number: 'JCOS-1',
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
        items: [],
      };
      order.findUnique.mockResolvedValue(existing);

      const result = await service.create({
        email: 'a@b.co',
        phone: '+79001234567',
        customerName: 'Иван',
        guestId: 'guest-123456',
        idempotencyKey: 'idem-same',
        lines: [{ variantId: 'v1', qty: 1 }],
        shippingAddress: { city: 'Москва', address: 'Тверская 1' },
      } as never);

      expect(result.id).toBe('ord1');
      expect(result.payToken).toBeTruthy();
      expect(catalogPublic.syncCartLines).not.toHaveBeenCalled();
    });

    it('идемпотентен: чужой guestId не получает payToken', async () => {
      order.findUnique.mockResolvedValue({
        id: 'ord1',
        number: 'JCOS-1',
        status: OrderStatus.AWAITING_PAYMENT,
        email: 'a@b.co',
        phone: '+79001234567',
        subtotal: 1000,
        discountTotal: 0,
        giftCertificateAmount: 0,
        giftCertificateCode: null,
        total: 1000,
        promoCode: null,
        guestId: 'guest-owner',
        items: [],
      });

      await expect(
        service.create({
          email: 'a@b.co',
          phone: '+79001234567',
          customerName: 'Иван',
          guestId: 'guest-attacker',
          idempotencyKey: 'idem-stolen',
          lines: [{ variantId: 'v1', qty: 1 }],
          shippingAddress: { city: 'Москва', address: 'Тверская 1' },
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('аттачит gratitude gift как isGratitudeGift линию с ценой 0', async () => {
      order.findUnique.mockResolvedValue(null);
      catalogPublic.syncCartLines.mockResolvedValue({
        items: [
          {
            variantId: 'v1',
            shadeId: null,
            shadeName: null,
            name: 'Крем',
            variantName: '50 мл',
            sku: 'sku-1',
            price: 16000,
            qty: 1,
          },
        ],
      });
      settingsPublic.getApplicableGift.mockResolvedValue({
        applicable: true,
        variantId: 'gift-v1',
        quantity: 1,
      });
      prisma.productVariant.findFirst.mockResolvedValue({
        id: 'gift-v1',
        name: '10 мл',
        sku: '4694872410287',
        stock: 100,
        stockReserve: 0,
        product: { name: 'Капли-активатор «Защита Рук»' },
      });

      const shippingQuotes = new ShippingQuoteService(config as never);
      const lines = [{ variantId: 'v1', shadeId: null as string | null, qty: 1 }];
      const shippingAddress = {
        city: 'Москва',
        address: 'Тверская 1',
        comment:
          '__VSP:carrier=cdek|lon=|lat=|pvz=MSK45|dropoff=pvz__\nТип доставки: СДЭК ПВЗ. Детали: x',
        pvzCode: 'MSK45',
      };
      const { quote } = shippingQuotes.issue({
        cost: 0,
        method: 'CDEK',
        addrHash: hashShippingAddress(shippingAddress, 'CDEK'),
        linesHash: hashCartLines(lines),
        goodsSubtotal: 16000,
        freePvz: true,
      });

      order.create.mockImplementation(async ({ data }: { data: { items: { create: unknown[] } } }) => ({
        id: 'ord-new',
        number: 'JCOS-NEW',
        status: OrderStatus.AWAITING_PAYMENT,
        email: 'a@b.co',
        phone: '+79001234567',
        subtotal: 16000,
        discountTotal: 0,
        giftCertificateAmount: 0,
        giftCertificateCode: null,
        total: 16000,
        promoCode: null,
        guestId: 'guest-123456',
        items: data.items.create,
      }));

      await service.create({
        email: 'a@b.co',
        phone: '+79001234567',
        customerName: 'Иван',
        guestId: 'guest-123456',
        idempotencyKey: 'idem-gift-1',
        lines,
        shippingMethod: 'CDEK',
        shippingAddress,
        shippingQuote: quote,
      } as never);

      expect(settingsPublic.getApplicableGift).toHaveBeenCalledWith(16000);
      expect(order.create).toHaveBeenCalled();
      const created = order.create.mock.calls[0]?.[0] as {
        data: { items: { create: Array<{ variantId: string; unitPrice: number; isGratitudeGift?: boolean }> } };
      };
      const giftLine = created.data.items.create.find((l) => l.variantId === 'gift-v1');
      expect(giftLine).toMatchObject({
        variantId: 'gift-v1',
        unitPrice: 0,
        isGratitudeGift: true,
        qty: 1,
      });
    });
  });

  describe('createPayment', () => {
    it('требует валидный payToken', async () => {
      order.findUnique.mockResolvedValue({
        id: 'ord1',
        guestId: 'guest-aaa',
        status: OrderStatus.AWAITING_PAYMENT,
        total: 100,
        items: [],
        payments: [],
      });

      await expect(
        service.createPayment('ord1', { payToken: 'bogus' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404 если заказ не найден', async () => {
      order.findUnique.mockResolvedValue(null);
      const token = payTokens.issue('missing', 'guest-123456');
      await expect(
        service.createPayment('missing', { payToken: token }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('return_url ЮKassa без payToken (только orderId)', async () => {
      const token = payTokens.issue('ord1', 'guest-1');
      order.findUnique.mockResolvedValue({
        id: 'ord1',
        number: 'JCOS-1',
        guestId: 'guest-1',
        userId: null,
        email: 'a@b.co',
        status: OrderStatus.AWAITING_PAYMENT,
        total: 500,
        giftPurchaseDenominationId: null,
        items: [
          {
            title: 'Item',
            qty: 1,
            unitPrice: 500,
          },
        ],
        payments: [],
      });
      payment.create.mockResolvedValue({});
      yookassa.createEmbeddedPayment.mockResolvedValue({
        payment: {
          id: 'yk_pay_1',
          confirmation: { confirmation_token: 'conf-tok', confirmation_url: null },
        },
        confirmationToken: 'conf-tok',
      });

      await service.createPayment('ord1', { payToken: token });

      expect(yookassa.createEmbeddedPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          returnUrl: expect.stringMatching(/\/order\/success\?.*orderId=ord1/),
        }),
      );
      const call = yookassa.createEmbeddedPayment.mock.calls[0]?.[0] as {
        returnUrl: string;
      };
      const url = new URL(call.returnUrl);
      expect(url.searchParams.get('orderId')).toBe('ord1');
      expect(url.searchParams.get('payToken')).toBeNull();
    });

    it('JWT владелец может платить без payToken', async () => {
      order.findUnique.mockResolvedValue({
        id: 'ord1',
        number: 'JCOS-1',
        guestId: 'guest-1',
        userId: 'buyer-1',
        email: 'a@b.co',
        status: OrderStatus.AWAITING_PAYMENT,
        total: 500,
        giftPurchaseDenominationId: null,
        items: [{ title: 'Item', qty: 1, unitPrice: 500 }],
        payments: [],
      });
      payment.create.mockResolvedValue({});
      yookassa.createEmbeddedPayment.mockResolvedValue({
        payment: {
          id: 'yk_pay_1',
          confirmation: { confirmation_token: 'conf-tok', confirmation_url: null },
        },
        confirmationToken: 'conf-tok',
      });

      const res = await service.createPayment('ord1', { buyerUserId: 'buyer-1' });
      expect(res).toEqual(
        expect.objectContaining({
          confirmationToken: 'conf-tok',
          paymentId: 'yk_pay_1',
          payToken: expect.any(String),
        }),
      );
    });

    it('чужой JWT → 403', async () => {
      order.findUnique.mockResolvedValue({
        id: 'ord1',
        guestId: 'guest-1',
        userId: 'buyer-1',
        status: OrderStatus.AWAITING_PAYMENT,
        total: 100,
        items: [],
        payments: [],
      });

      await expect(
        service.createPayment('ord1', { buyerUserId: 'other' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('expireStaleAwaitingOrders', () => {
    it('отменяет просроченные и снимает резерв', async () => {
      order.findMany.mockResolvedValue([
        {
          id: 'old1',
          status: OrderStatus.AWAITING_PAYMENT,
          items: [{ variantId: 'v1', qty: 2 }],
        },
      ]);
      order.findUnique.mockResolvedValue({
        id: 'old1',
        status: OrderStatus.AWAITING_PAYMENT,
        items: [{ variantId: 'v1', qty: 2 }],
      });
      order.update.mockResolvedValue({
        id: 'old1',
        status: OrderStatus.CANCELLED,
      });
      payment.findMany.mockResolvedValue([]);
      payment.updateMany.mockResolvedValue({ count: 1 });
      orderEvent.create.mockResolvedValue({});

      const n = await service.expireStaleAwaitingOrders(
        new Date('2026-08-03T12:00:00Z'),
      );

      expect(n).toBe(1);
      expect(releaseStockReserve).toHaveBeenCalled();
      expect(order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old1' },
          data: { status: OrderStatus.CANCELLED },
        }),
      );
      expect(payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: PaymentStatus.CANCELED },
        }),
      );
    });
  });

  describe('expire vs late pay', () => {
    it('после expire webhook late → автовозврат, заказ не PAID', async () => {
      const token = payTokens.issue('ord1', 'guest-1');

      payment.findFirst
        .mockResolvedValueOnce({
          id: 'pay1',
          orderId: 'ord1',
          status: PaymentStatus.PENDING,
          externalId: 'yk_1',
          order: {
            id: 'ord1',
            number: 'JCOS-1',
            status: OrderStatus.CANCELLED,
            guestId: 'guest-1',
          },
        })
        .mockResolvedValueOnce({ id: 'pay1', externalId: 'yk_1' });

      yookassa.getPayment.mockResolvedValue({
        id: 'yk_1',
        status: 'succeeded',
        paid: true,
        amount: { value: '500.00', currency: 'RUB' },
      });

      order.findUnique
        .mockResolvedValueOnce({
          id: 'ord1',
          number: 'JCOS-1',
          email: 'a@b.co',
          total: 500,
          status: OrderStatus.CANCELLED,
          promoCode: null,
          promoRedemption: null,
          items: [],
          userId: null,
          guestId: 'guest-1',
        })
        .mockResolvedValueOnce({
          id: 'ord1',
          number: 'JCOS-1',
          status: OrderStatus.CANCELLED,
          total: 500,
        });

      payment.update.mockResolvedValue({});
      yookassa.createRefund.mockResolvedValue({ id: 'rf1', status: 'succeeded' });
      payment.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.paymentStatus('yk_1', token);
      expect(res.paid).toBe(false);
      expect(res.orderStatus).toBe(OrderStatus.CANCELLED);
      expect(res.latePaymentRefunded).toBe(true);
    });
  });
});
