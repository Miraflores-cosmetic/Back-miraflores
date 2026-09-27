import { OrderStatus, ShipmentProvider } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ozonFlagWhere, ozonRowFlags, parseOzonFlagFilter } from './order-ozon-flags';

const ozonShipment = (p: { tracking?: string | null; carrierCostRub?: number | null } = {}) => ({
  provider: ShipmentProvider.OZON,
  tracking: p.tracking ?? null,
  carrierCostRub: p.carrierCostRub ?? null,
});

describe('order-ozon-flags', () => {
  it('parses only known filters', () => {
    expect(parseOzonFlagFilter('ozon_no_track')).toBe('ozon_no_track');
    expect(parseOzonFlagFilter(' OZON_NO_COST ')).toBe('ozon_no_cost');
    expect(parseOzonFlagFilter('other')).toBeNull();
    expect(parseOzonFlagFilter(undefined)).toBeNull();
  });

  it('is null for non-Ozon orders', () => {
    expect(
      ozonRowFlags({ status: OrderStatus.PAID, shippingMethod: ShipmentProvider.CDEK, shipments: [] }),
    ).toBeNull();
  });

  it('paid Ozon order without shipment needs a track, not a cost', () => {
    expect(
      ozonRowFlags({ status: OrderStatus.PAID, shippingMethod: ShipmentProvider.OZON, shipments: [] }),
    ).toEqual({ noTrack: true, noCost: false });
  });

  it('unpaid or cancelled Ozon orders are not flagged', () => {
    for (const status of [OrderStatus.AWAITING_PAYMENT, OrderStatus.CANCELLED, OrderStatus.REFUNDED]) {
      expect(ozonRowFlags({ status, shippingMethod: ShipmentProvider.OZON, shipments: [] })).toEqual({
        noTrack: false,
        noCost: false,
      });
    }
  });

  it('shipped with track but without cost → noCost; with cost → clean', () => {
    expect(
      ozonRowFlags({
        status: OrderStatus.SHIPPED,
        shippingMethod: ShipmentProvider.OZON,
        shipments: [ozonShipment({ tracking: '123' })],
      }),
    ).toEqual({ noTrack: false, noCost: true });
    expect(
      ozonRowFlags({
        status: OrderStatus.DELIVERED,
        shippingMethod: ShipmentProvider.OZON,
        shipments: [ozonShipment({ tracking: '123', carrierCostRub: 64 })],
      }),
    ).toEqual({ noTrack: false, noCost: false });
  });

  it('blank tracking counts as missing', () => {
    expect(
      ozonRowFlags({
        status: OrderStatus.PACKING,
        shippingMethod: ShipmentProvider.OZON,
        shipments: [ozonShipment({ tracking: '  ' })],
      })?.noTrack,
    ).toBe(true);
  });

  it('builds distinct Prisma filters', () => {
    expect(JSON.stringify(ozonFlagWhere('ozon_no_track'))).toContain('"none"');
    expect(JSON.stringify(ozonFlagWhere('ozon_no_cost'))).toContain('carrierCostRub');
  });
});
