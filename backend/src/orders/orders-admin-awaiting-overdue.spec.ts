import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus } from '@prisma/client';
import { OrdersAdminService } from './orders-admin.service';
import { ORDER_AWAITING_TTL_DEFAULT_MINUTES } from './order-awaiting-payment-schedule';

describe('OrdersAdminService awaiting overdue list/count', () => {
  const orderCount = vi.fn();
  const orderFindMany = vi.fn();
  const orderEventFindMany = vi.fn();
  const unreadOrderChatCountsForStaff = vi.fn(async () => ({}));
  const orderChatMessageCountsForOrders = vi.fn(async () => ({}));

  const prisma = {
    $transaction: vi.fn(async (ops: unknown) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      throw new Error('unexpected $transaction shape');
    }),
    order: {
      count: orderCount,
      findMany: orderFindMany,
    },
    orderEvent: {
      findMany: orderEventFindMany,
    },
  };

  const config = {
    get: vi.fn((key: string) => {
      if (key === 'ORDER_AWAITING_TTL_MINUTES') return String(ORDER_AWAITING_TTL_DEFAULT_MINUTES);
      return undefined;
    }),
  };

  let service: OrdersAdminService;

  beforeEach(() => {
    vi.clearAllMocks();
    orderCount.mockResolvedValue(0);
    orderFindMany.mockResolvedValue([]);
    orderEventFindMany.mockResolvedValue([]);
    unreadOrderChatCountsForStaff.mockResolvedValue({});
    orderChatMessageCountsForOrders.mockResolvedValue({});
    service = new OrdersAdminService(
      prisma as never,
      { addEvent: vi.fn() } as never,
      {} as never,
      { isCdekConfigured: () => false } as never,
      config as never,
      {
        unreadOrderChatCountsForStaff,
        orderChatMessageCountsForOrders,
      } as never,
      { createAdmin: vi.fn() } as never,
      {
        isConfigured: () => false,
        cancelOrdersBestEffort: async () => undefined,
        createRefund: vi.fn(),
      } as never,
    );
  });

  it('awaitingPaymentOverdueCount: AWAITING/NEW старше TTL', async () => {
    orderCount.mockResolvedValue(3);
    const before = Date.now();
    const res = await service.awaitingPaymentOverdueCount();
    const after = Date.now();
    expect(res).toEqual({ count: 3 });
    expect(orderCount).toHaveBeenCalledTimes(1);
    const where = orderCount.mock.calls[0]?.[0]?.where;
    expect(where.status).toEqual({
      in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.NEW],
    });
    const cutoff = where.createdAt.lte as Date;
    expect(cutoff).toBeInstanceOf(Date);
    const expectedMs = ORDER_AWAITING_TTL_DEFAULT_MINUTES * 60_000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - expectedMs - 50);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - expectedMs + 50);
  });

  it('list(overdueOnly): AND overdue where + awaitingPayment chips payload', async () => {
    const createdAt = new Date(
      Date.now() - (ORDER_AWAITING_TTL_DEFAULT_MINUTES + 60) * 60_000,
    );
    orderCount.mockResolvedValue(1);
    orderFindMany.mockResolvedValue([
      {
        id: 'o-over',
        number: 'MF-OVER',
        status: OrderStatus.AWAITING_PAYMENT,
        email: 'a@b.c',
        phone: '+7900',
        customerName: 'Ann',
        total: 1000,
        refundedAmount: 0,
        userId: null,
        createdAt,
        awaitingPaymentRemindStage: 2,
        shippingMethod: null,
        adminViewedAt: null,
        shipments: [],
      },
    ]);
    orderEventFindMany.mockResolvedValue([
      {
        orderId: 'o-over',
        meta: { stage: 1, mailStatus: 'sent' },
      },
      {
        orderId: 'o-over',
        meta: { stage: 2, mailStatus: 'failed' },
      },
    ]);

    const res = await service.list({ overdueOnly: true, page: 1, limit: 20 });

    expect(orderFindMany).toHaveBeenCalled();
    const findWhere = orderFindMany.mock.calls[0]?.[0]?.where;
    expect(findWhere).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            status: {
              in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.NEW],
            },
            createdAt: expect.objectContaining({ lte: expect.any(Date) }),
          }),
        ]),
      }),
    );

    expect(orderEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orderId: { in: ['o-over'] },
          type: 'PAYMENT_REMIND',
        },
      }),
    );

    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
    const ap = res.items[0].awaitingPayment;
    expect(ap).not.toBeNull();
    expect(ap?.overdue).toBe(true);
    expect(ap?.chips.find((c) => c.key === 'ttl')?.tone).toBe('overdue');
    expect(ap?.chips.find((c) => c.key === 'remind1')).toEqual(
      expect.objectContaining({ mailed: true, tone: 'done' }),
    );
    expect(ap?.chips.find((c) => c.key === 'remind2')).toEqual(
      expect.objectContaining({ mailed: false, tone: 'failed' }),
    );
    expect(ap?.chips.find((c) => c.key === 'remind3')?.mailed).toBe(false);
  });

  it('list без overdueOnly не режет по TTL cutoff', async () => {
    orderCount.mockResolvedValue(0);
    orderFindMany.mockResolvedValue([]);
    await service.list({ page: 1, limit: 20 });
    const findWhere = orderFindMany.mock.calls[0]?.[0]?.where;
    expect(findWhere).not.toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            createdAt: expect.objectContaining({ lte: expect.any(Date) }),
          }),
        ]),
      }),
    );
  });
});
