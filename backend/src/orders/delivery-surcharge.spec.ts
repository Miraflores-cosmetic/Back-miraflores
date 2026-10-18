import { describe, expect, it } from 'vitest';
import { buildQuoteCost } from './order-shipping.resolve';
import {
  DELIVERY_SURCHARGE_DEFAULTS,
  surchargeRubForCheckoutCarrier,
} from './delivery-surcharge';

describe('delivery surcharge', () => {
  const cdekPvz =
    '__VSP:carrier=cdek|lon=|lat=|pvz=MSK45|dropoff=pvz__\nТип доставки: СДЭК ПВЗ.';

  it('adds CDEK fixed surcharge after base tariff', () => {
    expect(
      buildQuoteCost({
        shippingMethod: 'CDEK',
        shippingComment: cdekPvz,
        pvzCode: 'MSK45',
        goodsSubtotal: 3000,
        freeShippingThresholdRub: 10_000,
        clientEstimate: 193,
        serverEstimate: 193,
        surcharges: {
          ...DELIVERY_SURCHARGE_DEFAULTS,
          cdek: { kind: 'FIXED', value: 100 },
        },
      }),
    ).toEqual({ cost: 293, method: 'CDEK', freePvz: false });
  });

  it('adds CDEK percent surcharge from base tariff', () => {
    expect(
      buildQuoteCost({
        shippingMethod: 'CDEK',
        shippingComment: cdekPvz,
        pvzCode: 'MSK45',
        goodsSubtotal: 3000,
        freeShippingThresholdRub: 10_000,
        clientEstimate: 200,
        serverEstimate: 200,
        surcharges: {
          ...DELIVERY_SURCHARGE_DEFAULTS,
          cdek: { kind: 'PERCENT', value: 10 },
        },
      }),
    ).toEqual({ cost: 220, method: 'CDEK', freePvz: false });
    expect(surchargeRubForCheckoutCarrier('CDEK', 200, DELIVERY_SURCHARGE_DEFAULTS)).toBe(0);
    expect(
      surchargeRubForCheckoutCarrier('CDEK', 200, {
        ...DELIVERY_SURCHARGE_DEFAULTS,
        cdek: { kind: 'PERCENT', value: 10 },
      }),
    ).toBe(20);
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
        surcharges: {
          ...DELIVERY_SURCHARGE_DEFAULTS,
          cdek: { kind: 'FIXED', value: 100 },
        },
      }),
    ).toEqual({ cost: 0, method: 'CDEK', freePvz: true });
  });
});
