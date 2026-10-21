import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { OrderAwaitingPaymentService } from './order-awaiting-payment.service';
import { OrderPayTokenService } from './order-pay-token.service';

vi.mock('./order-stock', () => ({
  releaseStockReserve: vi.fn(async () => undefined),
}));

vi.mock('../gift-certificates/gift-certificate-hold.util', () => ({
  releaseGiftCertificateForOrder: vi.fn(async () => false),
}));

import { releaseStockReserve } from './order-stock';

const order = {
  findUnique: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  count: vi.fn().mockResolvedValue(0),
};
const payment = {
  findMany: vi.fn().mockResolvedValue([]),
  updateMany: vi.fn(),
};
const orderEvent = {
  create: vi.fn(),
  findMany: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockResolvedValue({}),
};
const promoCodeRedemption = {
  deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
};
const tx = {
  order,
  payment,
  orderEvent,
  promoCodeRedemption,
  $executeRaw: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn(),
};
const prisma = {
  order,
  payment,
  orderEvent,
  $queryRaw: vi.fn().mockResolvedValue([{ n: 0n }]),
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  runInRlsTransaction: vi.fn(async (_ctx: unknown, fn: () => unknown) => fn()),
};
const config = {
  get: vi.fn((key: string) => {
    if (key === 'ORDER_AWAITING_TTL_MINUTES') return '60';
    if (key === 'ORDER_PAY_SECRET') return 'test-pay-secret';
    return undefined;
  }),
};
const yookassa = {
  cancelPaymentsBestEffort: vi.fn(async () => undefined),
};

function makeService() {
  const payTokens = new OrderPayTokenService(config as never);
  const lifecycle = {
    addEvent: vi.fn(async (_tx: unknown, input: { orderId: string }) => ({
      id: `ev-${input.orderId}`,
    })),
    notifyOrderAwaitingPayment: vi.fn(async () => 'sent' as const),
    notifyOrderCancelled: vi.fn(async () => undefined),
    notifyCustomer: vi.fn(async () => undefined),
  };
  return {
    service: new OrderAwaitingPaymentService(
      prisma as never,
      config as never,
      lifecycle as never,
      payTokens,
      yookassa as never,
      { applyRetentionForOrder: vi.fn(async () => undefined) } as never,
    ),
    lifecycle,
  };
}

describe('OrderAwaitingPaymentService', () => {
  let service: OrderAwaitingPaymentService;
  let lifecycle: {
    addEvent: ReturnType<typeof vi.fn>;
    notifyOrderAwaitingPayment: ReturnType<typeof vi.fn>;
    notifyOrderCancelled: ReturnType<typeof vi.fn>;
    notifyCustomer: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([{ n: 0n }]);
    order.count.mockResolvedValue(0);
    orderEvent.findMany.mockResolvedValue([]);
    orderEvent.update.mockResolvedValue({});
    prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) =>
      fn(tx),
    );
    const built = makeService();
    service = built.service;
    lifecycle = built.lifecycle;
  });

  describe('expireStaleAwaitingOrders', () => {
    it('отменяет просроченные и снимает резерв + письмо', async () => {
      order.findMany.mockResolvedValue([
        {
          id: 'old1',
          status: OrderStatus.AWAITING_PAYMENT,
          items: [{ variantId: 'v1', qty: 2 }],
        },
      ]);
      order.findUnique.mockResolvedValue({
        id: 'old1',
        number: 'MF-1',
        email: 'a@b.c',
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
      expect(lifecycle.notifyOrderCancelled).toHaveBeenCalledWith(
        'a@b.c',
        'MF-1',
        expect.stringContaining('автоматически отменён'),
      );
    });

    it('expire backlog > 50 → OPS_ALERT (throttle-aware)', async () => {
      order.count.mockResolvedValue(120);
      order.findMany.mockResolvedValue([]);
      config.get.mockImplementation((key: string) => {
        if (key === 'ORDER_AWAITING_TTL_MINUTES') return '60';
        if (key === 'ORDER_PAY_SECRET') return 'test-pay-secret';
        if (key === 'OPS_ALERT_EMAIL') return 'ops@test';
        return undefined;
      });

      await service.expireStaleAwaitingOrders(new Date('2026-08-03T12:00:00Z'));

      expect(lifecycle.notifyCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'ops@test',
          subject: expect.stringContaining('TTL expire backlog'),
        }),
      );
      expect(order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50, orderBy: { createdAt: 'asc' } }),
      );
    });
  });

  describe('processAwaitingPaymentReminders', () => {
    it('шлёт stage 1, pending→sent в meta; bump до SMTP (не send-before-bump)', async () => {
      const createdAt = new Date('2026-08-03T11:00:00Z');
      tx.$queryRaw.mockResolvedValueOnce([
        {
          id: 'o1',
          number: 'N1',
          email: 'c@d.e',
          total: 1000,
          guestId: 'g1',
          createdAt,
          awaitingPaymentRemindStage: 0,
          status: 'AWAITING_PAYMENT',
        },
      ]);
      order.update.mockResolvedValue({ id: 'o1', awaitingPaymentRemindStage: 1 });

      const n = await service.processAwaitingPaymentReminders(
        new Date('2026-08-03T11:06:00Z'),
      );

      expect(n).toBe(1);
      expect(lifecycle.addEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          orderId: 'o1',
          type: 'PAYMENT_REMIND',
          message: expect.stringContaining('5 мин'),
          meta: expect.objectContaining({ stage: 1, mailStatus: 'pending' }),
        }),
      );
      // Outbox invariant: bump/event в tx до SMTP (anti multi-instance dup).
      expect(order.update.mock.invocationCallOrder[0]!).toBeLessThan(
        lifecycle.notifyOrderAwaitingPayment.mock.invocationCallOrder[0]!,
      );
      expect(lifecycle.addEvent.mock.invocationCallOrder[0]!).toBeLessThan(
        lifecycle.notifyOrderAwaitingPayment.mock.invocationCallOrder[0]!,
      );
      expect(lifecycle.notifyOrderAwaitingPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'c@d.e',
          orderNumber: 'N1',
          stage: 1,
        }),
      );
      expect(orderEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ev-o1' },
          data: {
            meta: expect.objectContaining({
              stage: 1,
              mailStatus: 'sent',
              sentAt: expect.any(String),
            }),
          },
        }),
      );
    });

    it('SMTP fail → mailStatus=failed, stage уже bumped (retry later)', async () => {
      const createdAt = new Date('2026-08-03T11:00:00Z');
      tx.$queryRaw.mockResolvedValueOnce([
        {
          id: 'o1',
          number: 'N1',
          email: 'c@d.e',
          total: 1000,
          guestId: 'g1',
          createdAt,
          awaitingPaymentRemindStage: 0,
          status: 'AWAITING_PAYMENT',
        },
      ]);
      order.update.mockResolvedValue({ id: 'o1', awaitingPaymentRemindStage: 1 });
      lifecycle.notifyOrderAwaitingPayment.mockResolvedValue('failed');

      const n = await service.processAwaitingPaymentReminders(
        new Date('2026-08-03T11:06:00Z'),
      );

      expect(n).toBe(0);
      expect(order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { awaitingPaymentRemindStage: 1 },
        }),
      );
      expect(orderEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            meta: expect.objectContaining({ mailStatus: 'failed' }),
          },
        }),
      );
    });

    it('retry pending outbox без повторного bump', async () => {
      orderEvent.findMany.mockResolvedValueOnce([
        {
          id: 'ev-old',
          meta: { stage: 2, mailStatus: 'pending' },
          createdAt: new Date('2026-08-02T12:00:00Z'),
          order: {
            id: 'o9',
            number: 'N9',
            email: 'r@e.try',
            total: 200,
            guestId: 'g9',
            status: OrderStatus.AWAITING_PAYMENT,
            createdAt: new Date('2026-08-01T12:00:00Z'),
            awaitingPaymentRemindStage: 2,
          },
        },
      ]);
      tx.$queryRaw.mockResolvedValueOnce([]);

      const n = await service.processAwaitingPaymentReminders(
        new Date('2026-08-03T13:00:00Z'),
      );

      expect(n).toBe(1);
      expect(lifecycle.notifyOrderAwaitingPayment).toHaveBeenCalledWith(
        expect.objectContaining({ orderNumber: 'N9', stage: 2 }),
      );
      expect(lifecycle.addEvent).not.toHaveBeenCalled();
      expect(orderEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ev-old' },
          data: {
            meta: expect.objectContaining({ mailStatus: 'sent' }),
          },
        }),
      );
    });

    it('catch-up: age≥48ч при stage 0 → сразу stage 3 + skipped', async () => {
      const createdAt = new Date('2026-08-01T12:00:00Z');
      tx.$queryRaw.mockResolvedValueOnce([
        {
          id: 'o3',
          number: 'N3',
          email: 'c@d.e',
          total: 500,
          guestId: null,
          createdAt,
          awaitingPaymentRemindStage: 0,
          status: 'AWAITING_PAYMENT',
        },
      ]);
      order.update.mockResolvedValue({ id: 'o3', awaitingPaymentRemindStage: 3 });

      const n = await service.processAwaitingPaymentReminders(
        new Date('2026-08-03T13:00:00Z'),
      );

      expect(n).toBe(1);
      expect(lifecycle.addEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'PAYMENT_REMIND',
          message: expect.stringContaining('catch-up'),
          meta: expect.objectContaining({
            stage: 3,
            skipped: [1, 2],
            mailStatus: 'pending',
          }),
        }),
      );
      expect(lifecycle.notifyOrderAwaitingPayment).toHaveBeenCalledTimes(1);
    });
  });
});
