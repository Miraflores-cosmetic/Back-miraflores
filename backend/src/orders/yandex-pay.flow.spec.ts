import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { OrdersPublicService } from './orders.public.service';
import { OrderPayTokenService } from './order-pay-token.service';
import { ShippingQuoteService } from './shipping-quote.service';

vi.mock('./order-stock', () => ({
  reserveStockForLines: vi.fn(async () => undefined),
  releaseStockReserve: vi.fn(async () => undefined),
  commitStockOnPaid: vi.fn(async () => undefined),
}));

vi.mock('./mark-order-paid', () => ({
  applyPaidInTx: vi.fn(),
}));

vi.mock('../gift-certificates/gift-certificate-hold.util', () => ({
  holdGiftCertificateForOrder: vi.fn(async () => undefined),
  releaseGiftCertificateForOrder: vi.fn(async () => false),
  findUsableGiftCertificate: vi.fn(),
  computeGiftApplyAmount: vi.fn(),
}));

import { applyPaidInTx } from './mark-order-paid';

const order = {
  findUnique: vi.fn(),
  update: vi.fn(),
};
const payment = {
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  upsert: vi.fn(),
};

const prisma = {
  order,
  payment,
  $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(prisma)),
  runInRlsTransaction: vi.fn(async (_c: unknown, fn: () => unknown) => fn()),
  runIsolatedRlsTransaction: vi.fn(async (_c: unknown, fn: () => unknown) =>
    fn(),
  ),
};

const yookassa = {
  isConfigured: vi.fn(() => true),
  cancelPaymentsBestEffort: vi.fn(async () => undefined),
  createEmbeddedPayment: vi.fn(),
  createRefund: vi.fn(),
  getPayment: vi.fn(),
};

const yandexPay = {
  isConfigured: vi.fn(() => true),
  isSandbox: vi.fn(() => false),
  merchantId: vi.fn(() => 'mid-test'),
  createOrder: vi.fn(),
  cancelOrdersBestEffort: vi.fn(async () => undefined),
  getOrder: vi.fn(),
  verifyWebhookJwt: vi.fn(),
  createRefund: vi.fn(),
};

const config = {
  get: vi.fn((key: string) => {
    if (key === 'ORDER_PAY_SECRET') return 'test-pay-secret';
    if (key === 'FRONTEND_PUBLIC_URL') return 'http://localhost:3000';
    return undefined;
  }),
};

function baseOrder(over: Record<string, unknown> = {}) {
  return {
    id: 'ord1',
    number: 'MF-1',
    email: 'a@b.co',
    total: 1000,
    status: OrderStatus.AWAITING_PAYMENT,
    guestId: 'guest-1',
    userId: null,
    needsAddressClarification: false,
    giftPurchaseDenominationId: null,
    items: [
      {
        id: 'i1',
        variantId: 'v1',
        sku: 'SKU',
        title: 'Крем',
        qty: 1,
        unitPrice: 1000,
        isGratitudeGift: false,
      },
    ],
    payments: [] as Array<Record<string, unknown>>,
    ...over,
  };
}

function makeService() {
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
  };
  const service = new OrdersPublicService(
    prisma as never,
    { syncCartLines: vi.fn() } as never,
    { applyForCheckout: vi.fn() } as never,
    { applyForCheckout: vi.fn() } as never,
    { getApplicableGift: vi.fn(async () => ({ applicable: false })) } as never,
    yookassa as never,
    yandexPay as never,
    config as never,
    payTokens,
    shippingQuotes,
    { estimate: vi.fn() } as never,
    lifecycle as never,
    {
      seedCustomerNoteFromOrder: vi.fn(),
      applyRetentionForOrder: vi.fn(async () => undefined),
    } as never,
  );
  return { service, payTokens, lifecycle };
}

describe('Yandex Pay flow (create / webhook / exclusive)', () => {
  let service: OrdersPublicService;
  let payTokens: OrderPayTokenService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) =>
      fn(prisma),
    );
    payment.findMany.mockResolvedValue([]);
    payment.findFirst.mockResolvedValue(null);
    payment.updateMany.mockResolvedValue({ count: 0 });
    payment.upsert.mockResolvedValue({ id: 'pay1' });
    yandexPay.isConfigured.mockReturnValue(true);
    yandexPay.createOrder.mockResolvedValue({
      paymentUrl: 'https://pay.yandex.ru/l/1',
      raw: {},
    });
    ({ service, payTokens } = makeService());
  });

  describe('createPayment exclusive YaPay', () => {
    it('гасит PENDING Яндекс Пэй перед create ЮKassa', async () => {
      order.findUnique.mockResolvedValue(
        baseOrder({
          payments: [
            {
              id: 'yp1',
              provider: 'yandexpay',
              status: PaymentStatus.PENDING,
              externalId: 'ord1:1',
              amount: 1000,
              confirmationUrl: 'https://pay.yandex/l/1',
              raw: null,
            },
          ],
        }),
      );
      payment.findMany.mockResolvedValue([
        { id: 'yp1', provider: 'yandexpay', externalId: 'ord1:1' },
      ]);
      yookassa.createEmbeddedPayment.mockResolvedValue({
        payment: {
          id: 'yk1',
          confirmation: { confirmation_token: 'tok', confirmation_url: null },
        },
        confirmationToken: 'tok',
      });
      const token = payTokens.issue('ord1', 'guest-1');
      await service.createPayment('ord1', { payToken: token });
      expect(yandexPay.cancelOrdersBestEffort).toHaveBeenCalledWith(['ord1:1']);
      expect(payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            provider: { not: 'yookassa' },
            status: PaymentStatus.PENDING,
          }),
        }),
      );
      expect(yookassa.createEmbeddedPayment).toHaveBeenCalled();
    });
  });

  describe('checkoutSuccessStatus YaPay', () => {
    it('CAPTURED pending → markOrderPaidYandex', async () => {
      const token = payTokens.issue('ord1', 'guest-1');
      order.findUnique
        .mockResolvedValueOnce(
          baseOrder({
            payments: [
              {
                id: 'p1',
                externalId: 'ord1:1',
                status: PaymentStatus.PENDING,
                provider: 'yandexpay',
              },
            ],
          }),
        )
        .mockResolvedValueOnce({
          id: 'ord1',
          number: 'MF-1',
          status: OrderStatus.PAID,
          total: 1000,
        });
      yandexPay.getOrder.mockResolvedValue({
        orderId: 'ord1:1',
        paymentStatus: 'CAPTURED',
        amountRub: 1000,
        raw: {},
      });
      vi.mocked(applyPaidInTx).mockResolvedValue({
        kind: 'paid',
        number: 'MF-1',
        email: 'a@b.co',
        orderId: 'ord1',
        isGiftPurchase: false,
      });

      const res = await service.checkoutSuccessStatus('ord1', {
        payToken: token,
      });

      expect(yandexPay.getOrder).toHaveBeenCalledWith('ord1:1');
      expect(applyPaidInTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'ord1',
        expect.objectContaining({
          kind: 'yandexpay',
          remote: expect.objectContaining({ id: 'ord1:1' }),
        }),
      );
      expect(yookassa.getPayment).not.toHaveBeenCalled();
      expect(res.paid).toBe(true);
      expect(res.total).toBe(1000);
    });
  });

  describe('createYandexPayPayment', () => {
    it('clarification → BadRequest, без createOrder', async () => {
      order.findUnique.mockResolvedValue(
        baseOrder({ needsAddressClarification: true }),
      );
      const token = payTokens.issue('ord1', 'guest-1');
      await expect(
        service.createYandexPayPayment('ord1', { payToken: token }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(yandexPay.createOrder).not.toHaveBeenCalled();
    });

    it('double-provider: гасит PENDING ЮKassa перед create', async () => {
      order.findUnique.mockResolvedValue(
        baseOrder({
          payments: [
            {
              id: 'yk1',
              provider: 'yookassa',
              status: PaymentStatus.PENDING,
              externalId: 'yk_ext',
              amount: 1000,
              confirmationUrl: 'https://yookassa',
            },
          ],
        }),
      );
      payment.findMany
        .mockResolvedValueOnce([
          {
            id: 'yk1',
            provider: 'yookassa',
            externalId: 'yk_ext',
          },
        ])
        .mockResolvedValueOnce([]); // priorYp for versioned id

      const token = payTokens.issue('ord1', 'guest-1');
      const res = await service.createYandexPayPayment('ord1', {
        payToken: token,
      });

      expect(yookassa.cancelPaymentsBestEffort).toHaveBeenCalledWith([
        'yk_ext',
      ]);
      expect(payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            provider: { not: 'yandexpay' },
            status: PaymentStatus.PENDING,
          }),
          data: { status: PaymentStatus.CANCELED },
        }),
      );
      expect(yandexPay.createOrder).toHaveBeenCalled();
      expect(res.paymentUrl).toBe('https://pay.yandex.ru/l/1');
      expect(payment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            orderId_externalId: { orderId: 'ord1', externalId: 'ord1:1' },
          },
          create: expect.objectContaining({
            provider: 'yandexpay',
            externalId: 'ord1:1',
          }),
        }),
      );
    });
  });

  describe('handleYandexPayWebhook', () => {
    it('JWT fail → 400 UNAUTHORIZED (не Nest envelope)', async () => {
      yandexPay.verifyWebhookJwt.mockRejectedValue(
        new UnauthorizedException({
          status: 'fail',
          reasonCode: 'UNAUTHORIZED',
          reason: 'bad sig',
        }),
      );
      const res = await service.handleYandexPayWebhook('bad.jwt');
      expect(res).toEqual({
        httpStatus: 400,
        body: {
          status: 'fail',
          reasonCode: 'UNAUTHORIZED',
          reason: 'bad sig',
        },
      });
    });

    it('FAILED → cancel PENDING payment + 200 success', async () => {
      yandexPay.verifyWebhookJwt.mockResolvedValue({
        merchantId: 'mid-test',
        event: 'ORDER_STATUS_UPDATED',
        order: { orderId: 'ord1:2', paymentStatus: 'FAILED' },
      });
      const res = await service.handleYandexPayWebhook('jwt');
      expect(payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            provider: 'yandexpay',
            externalId: 'ord1:2',
            status: PaymentStatus.PENDING,
          }),
          data: { status: PaymentStatus.CANCELED },
        }),
      );
      expect(res).toEqual({
        httpStatus: 200,
        body: { status: 'success' },
      });
    });

    it('CAPTURED → getOrder + markPaid', async () => {
      yandexPay.verifyWebhookJwt.mockResolvedValue({
        merchantId: 'mid-test',
        event: 'ORDER_STATUS_UPDATED',
        order: { orderId: 'ord1:1', paymentStatus: 'CAPTURED' },
      });
      yandexPay.getOrder.mockResolvedValue({
        orderId: 'ord1:1',
        paymentStatus: 'CAPTURED',
        amountRub: 1000,
        raw: {},
      });
      payment.findFirst.mockResolvedValue({ orderId: 'ord1' });
      vi.mocked(applyPaidInTx).mockResolvedValue({
        kind: 'paid',
        number: 'MF-1',
        email: 'a@b.co',
        orderId: 'ord1',
        isGiftPurchase: false,
      });

      const res = await service.handleYandexPayWebhook('jwt');
      expect(yandexPay.getOrder).toHaveBeenCalledWith('ord1:1');
      expect(applyPaidInTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'ord1',
        expect.objectContaining({
          kind: 'yandexpay',
          remote: expect.objectContaining({ id: 'ord1:1', amountRub: 1000 }),
        }),
      );
      expect(res.httpStatus).toBe(200);
      expect(res.body).toEqual({ status: 'success' });
    });

    it('второй CAPTURED после PAID → late refund path (не already без возврата)', async () => {
      yandexPay.verifyWebhookJwt.mockResolvedValue({
        merchantId: 'mid-test',
        event: 'ORDER_STATUS_UPDATED',
        order: { orderId: 'ord1:2', paymentStatus: 'CAPTURED' },
      });
      yandexPay.getOrder.mockResolvedValue({
        orderId: 'ord1:2',
        paymentStatus: 'CAPTURED',
        amountRub: 1000,
        raw: {},
      });
      payment.findFirst.mockResolvedValue({ orderId: 'ord1' });
      vi.mocked(applyPaidInTx).mockResolvedValue({
        kind: 'late',
        order: {
          id: 'ord1',
          number: 'MF-1',
          email: 'a@b.co',
          total: 1000,
          status: OrderStatus.PAID,
        },
      });
      yandexPay.createRefund.mockResolvedValue({
        id: 'rf1',
        status: 'SUCCESS',
      });

      const res = await service.handleYandexPayWebhook('jwt');
      expect(yandexPay.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({ merchantOrderId: 'ord1:2' }),
      );
      expect(res).toEqual({
        httpStatus: 200,
        body: { status: 'success' },
      });
    });

    it('CAPTURED late_failed → CONFLICT', async () => {
      yandexPay.verifyWebhookJwt.mockResolvedValue({
        merchantId: 'mid-test',
        event: 'ORDER_STATUS_UPDATED',
        order: { orderId: 'ord1:1', paymentStatus: 'CAPTURED' },
      });
      yandexPay.getOrder.mockResolvedValue({
        orderId: 'ord1:1',
        paymentStatus: 'CAPTURED',
        amountRub: 1000,
        raw: {},
      });
      payment.findFirst.mockResolvedValue({ orderId: 'ord1' });
      vi.mocked(applyPaidInTx).mockResolvedValue({
        kind: 'late',
        order: {
          id: 'ord1',
          number: 'MF-1',
          email: 'a@b.co',
          total: 1000,
          status: OrderStatus.CANCELLED,
        },
      });
      yandexPay.isConfigured.mockReturnValue(false); // refund → late_failed

      const res = await service.handleYandexPayWebhook('jwt');
      expect(res).toEqual({
        httpStatus: 400,
        body: {
          status: 'fail',
          reasonCode: 'CONFLICT',
          reason: 'late payment refund failed',
        },
      });
    });

    it('ORDER_NOT_FOUND если нет платежа/заказа', async () => {
      yandexPay.verifyWebhookJwt.mockResolvedValue({
        merchantId: 'mid-test',
        event: 'ORDER_STATUS_UPDATED',
        order: { orderId: 'ghost:1', paymentStatus: 'CAPTURED' },
      });
      yandexPay.getOrder.mockResolvedValue({
        orderId: 'ghost:1',
        paymentStatus: 'CAPTURED',
        amountRub: 100,
        raw: {},
      });
      payment.findFirst.mockResolvedValue(null);
      order.findUnique.mockResolvedValue(null);

      const res = await service.handleYandexPayWebhook('jwt');
      expect(res.body.reasonCode).toBe('ORDER_NOT_FOUND');
      expect(res.httpStatus).toBe(400);
    });
  });
});
