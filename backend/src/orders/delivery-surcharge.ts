import type { CheckoutCarrier } from './order-shipping.resolve';

export type DeliverySurchargeRub = {
  cdek: number;
  ozon: number;
  yandex: number;
};

export const DELIVERY_SURCHARGE_DEFAULTS: DeliverySurchargeRub = {
  cdek: 0,
  ozon: 0,
  yandex: 0,
};

export function normalizeDeliverySurchargeRow(row: {
  cdekSurchargeRub: number;
  ozonSurchargeRub: number;
  yandexSurchargeRub: number;
}): DeliverySurchargeRub {
  const clamp = (n: number) =>
    Math.max(0, Math.min(500_000, Math.floor(Number(n) || 0)));
  return {
    cdek: clamp(row.cdekSurchargeRub),
    ozon: clamp(row.ozonSurchargeRub),
    yandex: clamp(row.yandexSurchargeRub),
  };
}

export function surchargeRubForCheckoutCarrier(
  method: CheckoutCarrier,
  surcharges: DeliverySurchargeRub = DELIVERY_SURCHARGE_DEFAULTS,
): number {
  const raw =
    method === 'CDEK'
      ? surcharges.cdek
      : method === 'OZON'
        ? surcharges.ozon
        : surcharges.yandex;
  return Math.max(0, Math.min(500_000, Math.floor(Number(raw) || 0)));
}
