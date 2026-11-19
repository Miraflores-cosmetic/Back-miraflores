import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus } from '@prisma/client';
import { OrdersAdminService } from './orders-admin.service';

function makeAdminService(
  tx: Record<string, unknown>,
  lifecycle: {
    addEvent: ReturnType<typeof vi.fn>;
    notifyOrderDeliveredWithResult?: ReturnType<typeof vi.fn>;
  } = { addEvent: vi.fn(async () => ({ id: 'ev-new' })) },
) {
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    runInRlsTransaction: vi.fn(async (_ctx: unknown, fn: () => unknown) => fn()),
    order: { findUnique: vi.fn() },
    orderEvent: { update: vi.fn() },
  };
  return {
    service: new OrdersAdminService(
      prisma as never,
      {
        addEvent: lifecycle.addEvent,
        notifyOrderDeliveredWithResult:
          lifecycle.notifyOrderDeliveredWithResult ??
          vi.fn(async () => 'sent'),
      } as never,
      {} as never,
      { isCdekConfigured: () => true } as never,
      { get: vi.fn() } as never,
      { applyRetentionForOrder: vi.fn() } as never,
      {} as never,
      {} as never,
    ),
    prisma,
    lifecycle,
  };
}

describe('OrdersAdminService CDEK outbox', () => {
  const txQueryRaw = vi.fn();
  const txOrderUpdate = vi.fn();
  const txOrder = {
    findUnique: vi.fn(),
    update: txOrderUpdate,
  };
  const txOrderEvent = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  };
  const txShipment = { update: vi.fn() };

  const tx = {
    $queryRaw: txQueryRaw,
    order: txOrder,
    orderEvent: txOrderEvent,
    shipment: txShipment,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    txQueryRaw.mockResolvedValue(undefined);
  });

  it('reserveCdekSyncTrackingMailOutbox: создаёт pending', async () => {
    txOrderEvent.findMany.mockResolvedValue([]);
    txOrder.findUnique.mockResolvedValue({
      number: 'AA-1',
      email: 'a@b.co',
      status: OrderStatus.SHIPPED,
      shipments: [{ id: 'sh1', tracking: '1100' }],
    });

    const { service, lifecycle } = makeAdminService(tx);
    const r = await service.reserveCdekSyncTrackingMailOutbox('ord1', '1100');
    expect(r).toMatchObject({
      eventId: 'ev-new',
      tracking: '1100',
      meta: expect.objectContaining({
        source: 'cdek_sync',
        mailStatus: 'pending',
      }),
    });
    expect(lifecycle.addEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'TRACKING_SENT' }),
    );
  });

  it('reserveCdekSyncTrackingMailOutbox: settled → null', async () => {
    txOrderEvent.findMany.mockResolvedValue([
      {
        id: 'ev1',
        meta: {
          tracking: '1',
          source: 'cdek_sync',
          mailStatus: 'sent',
        },
      },
    ]);

    const { service } = makeAdminService(tx);
    expect(await service.reserveCdekSyncTrackingMailOutbox('ord1', '1100')).toBeNull();
  });

  it('reserveCdekSyncTrackingMailOutbox: failed не due → null', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    txOrderEvent.findMany.mockResolvedValue([
      {
        id: 'ev1',
        meta: {
          tracking: '1100',
          source: 'cdek_sync',
          mailStatus: 'failed',
          nextRetryAt: future,
        },
      },
    ]);

    const { service } = makeAdminService(tx);
    expect(await service.reserveCdekSyncTrackingMailOutbox('ord1', '1100')).toBeNull();
  });

  it('claimCdekSyncDelivered: SHIPPED → DELIVERED + pending mail', async () => {
    txOrder.findUnique.mockResolvedValue({
      id: 'ord1',
      status: OrderStatus.SHIPPED,
      number: 'AA-2',
      email: 'x@y.co',
    });
    txOrder.update.mockResolvedValue({});

    const { service, lifecycle } = makeAdminService(tx);
    const r = await service.claimCdekSyncDelivered('ord1', 'DELIVERED');
    expect(r).toMatchObject({
      email: 'x@y.co',
      eventId: 'ev-new',
      meta: expect.objectContaining({
        mailStatus: 'pending',
        cdekStatus: 'DELIVERED',
      }),
    });
    expect(txOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: OrderStatus.DELIVERED },
      }),
    );
    expect(lifecycle.addEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'DELIVERED' }),
    );
  });

  it('claimCdekSyncDelivered: уже DELIVERED → null', async () => {
    txOrder.findUnique.mockResolvedValue({
      id: 'ord1',
      status: OrderStatus.DELIVERED,
      number: 'AA-2',
      email: 'x@y.co',
    });

    const { service } = makeAdminService(tx);
    expect(await service.claimCdekSyncDelivered('ord1', 'DELIVERED')).toBeNull();
  });

  it('finalizeCdekSyncTrackingMailOutbox: failed → nextRetryAt', async () => {
    const orderEventUpdate = vi.fn();
    const prisma = {
      $transaction: vi.fn(),
      order: { findUnique: vi.fn() },
      orderEvent: { update: orderEventUpdate },
    };
    const service = new OrdersAdminService(
      prisma as never,
      { addEvent: vi.fn() } as never,
      {} as never,
      {} as never,
      { get: vi.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.finalizeCdekSyncTrackingMailOutbox(
      'ev1',
      'failed',
      {
        tracking: '1100',
        source: 'cdek_sync',
        mailStatus: 'pending',
        attempt: 0,
      },
      { lastError: 'smtp failed' },
    );

    const data = orderEventUpdate.mock.calls[0]?.[0]?.data;
    expect(data?.meta).toMatchObject({
      mailStatus: 'failed',
      attempt: 1,
      nextRetryAt: expect.any(String),
    });
  });

  it('claimAdminDeliveredWithOutbox: SHIPPED → DELIVERED + admin_manual pending', async () => {
    txOrderEvent.findFirst.mockResolvedValue(null);
    txOrder.findUnique.mockResolvedValue({
      id: 'ord1',
      status: OrderStatus.SHIPPED,
      number: 'AA-3',
      email: 'a@b.co',
    });
    txOrderUpdate.mockResolvedValue({});

    const { service, lifecycle } = makeAdminService(tx);
    const r = await service.claimAdminDeliveredWithOutbox('ord1', 'u1');
    expect(r.meta).toMatchObject({
      source: 'admin_manual',
      mailStatus: 'pending',
    });
    expect(lifecycle.addEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ type: 'DELIVERED', actorUserId: 'u1' }),
    );
  });
});