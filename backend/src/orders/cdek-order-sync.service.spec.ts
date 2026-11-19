import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, ShipmentProvider } from '@prisma/client';
import { CdekOrderSyncService } from './cdek-order-sync.service';

const carrier = {
  isCdekConfigured: vi.fn(() => true),
  fetchCdekOrderByUuid: vi.fn(),
};

const ordersAdmin = {
  reserveCdekSyncTrackingMailOutbox: vi.fn(),
  finalizeCdekSyncTrackingMailOutbox: vi.fn(),
  claimCdekSyncDelivered: vi.fn(),
  finalizeCdekSyncDeliveredMailOutbox: vi.fn(),
};

const lifecycle = {
  notifyOrderShippedWithResult: vi.fn(),
  notifyOrderDeliveredWithResult: vi.fn(),
};

const shipmentUpdate = vi.fn();
const prisma = {
  runInRlsTransaction: vi.fn(async (_ctx: unknown, fn: () => unknown) => fn()),
  shipment: { findMany: vi.fn() },
  $queryRaw: vi.fn(async () => [] as unknown[]),
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
    fn({ shipment: { update: shipmentUpdate } }),
  ),
};

const config = {
  get: vi.fn((key: string) => {
    if (key === 'CDEK_SYNC_ENABLED') return '1';
    if (key === 'CDEK_SYNC_BATCH_SIZE') return '10';
    return undefined;
  }),
};

describe('CdekOrderSyncService', () => {
  let service: CdekOrderSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    shipmentUpdate.mockReset();
    prisma.$queryRaw.mockResolvedValue([]);
    service = new CdekOrderSyncService(
      config as never,
      prisma as never,
      carrier as never,
      ordersAdmin as never,
      lifecycle as never,
    );
  });

  it('runTick: reserve → SMTP → finalize sent', async () => {
    prisma.shipment.findMany.mockResolvedValue([
      {
        id: 'sh1',
        orderId: 'ord1',
        tracking: null,
        raw: null,
        externalId: 'uuid-1',
        order: {
          id: 'ord1',
          number: 'AA-1',
          status: OrderStatus.SHIPPED,
        },
      },
    ]);
    carrier.fetchCdekOrderByUuid.mockResolvedValue({
      entity: {
        cdek_number: '1100998877',
        statuses: [{ code: 'ACCEPTED', date_time: '2026-01-01T10:00:00+03:00' }],
      },
      raw: { entity: {} },
    });
    ordersAdmin.reserveCdekSyncTrackingMailOutbox.mockResolvedValue({
      eventId: 'ev1',
      email: 'a@b.co',
      number: 'AA-1',
      tracking: '1100998877',
      meta: {
        tracking: '1100998877',
        source: 'cdek_sync',
        mailStatus: 'pending',
      },
    });
    lifecycle.notifyOrderShippedWithResult.mockResolvedValue('sent');
    ordersAdmin.finalizeCdekSyncTrackingMailOutbox.mockResolvedValue({
      exhausted: false,
      highAttempt: false,
    });

    const r = await service.runTick();
    expect(r.trackingEmailed).toBe(1);
    expect(lifecycle.notifyOrderShippedWithResult).toHaveBeenCalled();
    expect(ordersAdmin.finalizeCdekSyncTrackingMailOutbox).toHaveBeenCalledWith(
      'ev1',
      'sent',
      expect.objectContaining({ mailStatus: 'pending', tracking: '1100998877' }),
      {},
    );
  });

  it('runTick: claim deliver race → без errors', async () => {
    prisma.shipment.findMany.mockResolvedValue([
      {
        id: 'sh1',
        orderId: 'ord1',
        tracking: '1100998877',
        raw: { entity: { n: 1 } },
        externalId: 'uuid-1',
        order: {
          id: 'ord1',
          number: 'AA-1',
          status: OrderStatus.SHIPPED,
        },
      },
    ]);
    carrier.fetchCdekOrderByUuid.mockResolvedValue({
      entity: {
        cdek_number: '1100998877',
        statuses: [{ code: 'DELIVERED', date_time: '2026-01-02T10:00:00+03:00' }],
      },
      raw: { entity: { n: 1 } },
    });
    ordersAdmin.claimCdekSyncDelivered.mockRejectedValue(new Error('tx abort'));

    const r = await service.runTick();
    expect(r.errors).toBe(0);
    expect(r.delivered).toBe(0);
  });

  it('runTick: тот же raw — shipment.update не вызывается', async () => {
    const raw = { entity: { ok: true } };
    prisma.shipment.findMany.mockResolvedValue([
      {
        id: 'sh1',
        orderId: 'ord1',
        tracking: '1100998877',
        raw,
        externalId: 'uuid-1',
        order: {
          id: 'ord1',
          number: 'AA-1',
          status: OrderStatus.SHIPPED,
        },
      },
    ]);
    carrier.fetchCdekOrderByUuid.mockResolvedValue({
      entity: { cdek_number: '1100998877', statuses: [] },
      raw,
    });

    await service.runTick();
    expect(shipmentUpdate).not.toHaveBeenCalled();
  });

  it('runTick: POSTOMAT_RECEIVED → claim deliver', async () => {
    prisma.shipment.findMany.mockResolvedValue([
      {
        id: 'sh1',
        orderId: 'ord1',
        tracking: '1100998877',
        raw: null,
        externalId: 'uuid-1',
        order: {
          id: 'ord1',
          number: 'AA-2',
          status: OrderStatus.SHIPPED,
        },
      },
    ]);
    carrier.fetchCdekOrderByUuid.mockResolvedValue({
      entity: {
        cdek_number: '1100998877',
        statuses: [
          { code: 'POSTOMAT_RECEIVED', date_time: '2026-01-03T10:00:00+03:00' },
        ],
      },
      raw: { entity: {} },
    });
    ordersAdmin.claimCdekSyncDelivered.mockResolvedValue({
      email: 'a@b.co',
      number: 'AA-2',
      eventId: 'ev-del',
      meta: {
        source: 'cdek_sync',
        cdekStatus: 'POSTOMAT_RECEIVED',
        from: 'SHIPPED',
        to: 'DELIVERED',
        mailStatus: 'pending',
      },
    });
    lifecycle.notifyOrderDeliveredWithResult.mockResolvedValue('sent');
    ordersAdmin.finalizeCdekSyncDeliveredMailOutbox.mockResolvedValue({
      exhausted: false,
      highAttempt: false,
    });

    const r = await service.runTick();
    expect(ordersAdmin.claimCdekSyncDelivered).toHaveBeenCalledWith(
      'ord1',
      'POSTOMAT_RECEIVED',
    );
    expect(lifecycle.notifyOrderDeliveredWithResult).toHaveBeenCalledWith(
      'a@b.co',
      'AA-2',
    );
    expect(ordersAdmin.finalizeCdekSyncDeliveredMailOutbox).toHaveBeenCalledWith(
      'ev-del',
      'sent',
      expect.objectContaining({ mailStatus: 'pending' }),
      {},
    );
    expect(r.delivered).toBe(1);
  });

  it('runTick: delivered SMTP fail → finalize failed, ретрай через flush', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          eventId: 'ev-del-2',
          orderId: 'ord9',
          meta: {
            source: 'cdek_sync',
            cdekStatus: 'DELIVERED',
            from: 'SHIPPED',
            to: 'DELIVERED',
            mailStatus: 'failed',
          },
          number: 'AA-9',
          email: 'x@y.co',
          status: 'DELIVERED',
        },
      ]);
    prisma.shipment.findMany.mockResolvedValue([]);

    lifecycle.notifyOrderDeliveredWithResult.mockResolvedValue('sent');
    ordersAdmin.finalizeCdekSyncDeliveredMailOutbox.mockResolvedValue({
      exhausted: false,
      highAttempt: false,
    });

    const r = await service.runTick();
    expect(lifecycle.notifyOrderDeliveredWithResult).toHaveBeenCalledWith(
      'x@y.co',
      'AA-9',
    );
    expect(r.retriedMails).toBe(1);
  });

  it('runTick: SMTP failed → finalize failed, не counting emailed', async () => {
    prisma.shipment.findMany.mockResolvedValue([
      {
        id: 'sh1',
        orderId: 'ord1',
        tracking: '1100998877',
        raw: null,
        externalId: 'uuid-1',
        order: {
          id: 'ord1',
          number: 'AA-1',
          status: OrderStatus.SHIPPED,
        },
      },
    ]);
    carrier.fetchCdekOrderByUuid.mockResolvedValue({
      entity: { cdek_number: '1100998877', statuses: [] },
      raw: {},
    });
    ordersAdmin.reserveCdekSyncTrackingMailOutbox.mockResolvedValue({
      eventId: 'ev1',
      email: 'a@b.co',
      number: 'AA-1',
      tracking: '1100998877',
      meta: {
        tracking: '1100998877',
        source: 'cdek_sync',
        mailStatus: 'pending',
      },
    });
    lifecycle.notifyOrderShippedWithResult.mockResolvedValue('failed');

    const r = await service.runTick();
    expect(r.trackingEmailed).toBe(0);
    expect(ordersAdmin.finalizeCdekSyncTrackingMailOutbox).toHaveBeenCalledWith(
      'ev1',
      'failed',
      expect.anything(),
      { lastError: 'smtp failed' },
    );
  });

  it('runTick: SMTP fail + finalize throw → errors, sent не зафиксирован', async () => {
    prisma.shipment.findMany.mockResolvedValue([
      {
        id: 'sh1',
        orderId: 'ord1',
        tracking: '1100998877',
        raw: null,
        externalId: 'uuid-1',
        order: {
          id: 'ord1',
          number: 'AA-1',
          status: OrderStatus.SHIPPED,
        },
      },
    ]);
    carrier.fetchCdekOrderByUuid.mockResolvedValue({
      entity: { cdek_number: '1100998877', statuses: [] },
      raw: {},
    });
    ordersAdmin.reserveCdekSyncTrackingMailOutbox.mockResolvedValue({
      eventId: 'ev1',
      email: 'a@b.co',
      number: 'AA-1',
      tracking: '1100998877',
      meta: {
        tracking: '1100998877',
        source: 'cdek_sync',
        mailStatus: 'pending',
      },
    });
    lifecycle.notifyOrderShippedWithResult.mockResolvedValue('failed');
    ordersAdmin.finalizeCdekSyncTrackingMailOutbox.mockRejectedValue(
      new Error('db down'),
    );

    const r = await service.runTick();
    expect(r.trackingEmailed).toBe(0);
    expect(r.errors).toBe(1);
    expect(ordersAdmin.finalizeCdekSyncTrackingMailOutbox).toHaveBeenCalledWith(
      'ev1',
      'failed',
      expect.anything(),
      { lastError: 'smtp failed' },
    );
  });
});