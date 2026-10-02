import { describe, expect, it } from 'vitest';
import { buildQuoteCost } from './order-shipping.resolve';

describe('delivery surcharge', () => {
  const cdekPvz =
    '__VSP:carrier=cdek|lon=|lat=|pvz=MSK45|dropoff=pvz__\nТип доставки: СДЭК ПВЗ.';

  it('adds CDEK surcharge after base tariff', () => {
    expect(
      buildQuoteCost({
        shippingMethod: 'CDEK',
        shippingComment: cdekPvz,
        pvzCode: 'MSK45',
        goodsSubtotal: 3000,
        freeShippingThresholdRub: 10_000,
        clientEstimate: 193,
        serverEstimate: 193,
        surcharges: { cdek: 100, ozon: 0, yandex: 0 },
      }),
    ).toEqual({ cost: 293, method: 'CDEK', freePvz: false });
  });

  it('does not add surcharge for free PVZ', () => {
    expect(
      buildQuoteCost({
        shippingMethod: 'CDEK',
        shippingComment: cdekPvz,
        pvzCode: 'MSK45',
        goodsSubtotal: 12_000,
        freeShippingThresholdRub: 10_000,
        clientEstimate: 193,
        surcharges: { cdek: 100, ozon: 0, yandex: 0 },
      }),
    ).toEqual({ cost: 0, method: 'CDEK', freePvz: true });
  });
});
