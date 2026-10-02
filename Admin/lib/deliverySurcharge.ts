import type { JcosShippingCarrier } from '@/lib/shipping/addressShippingMeta';

export type DeliverySurcharges = {
  cdekSurchargeRub: number;
  ozonSurchargeRub: number;
  yandexSurchargeRub: number;
};

export const DELIVERY_SURCHARGE_DEFAULTS: DeliverySurcharges = {
  cdekSurchargeRub: 0,
  ozonSurchargeRub: 0,
  yandexSurchargeRub: 0,
};

export function normalizeDeliverySurcharges(
  data: Partial<DeliverySurcharges> | null | undefined,
): DeliverySurcharges {
  const clamp = (n: unknown) => {
    const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 0;
    return Math.max(0, Math.min(500_000, v));
  };
  return {
    cdekSurchargeRub: clamp(data?.cdekSurchargeRub),
    ozonSurchargeRub: clamp(data?.ozonSurchargeRub),
    yandexSurchargeRub: clamp(data?.yandexSurchargeRub),
  };
}

export function surchargeRubForCarrier(
  carrier: JcosShippingCarrier,
  surcharges: DeliverySurcharges,
): number {
  if (carrier === 'cdek') return surcharges.cdekSurchargeRub;
  if (carrier === 'ozon') return surcharges.ozonSurchargeRub;
  if (carrier === 'yandex') return surcharges.yandexSurchargeRub;
  return 0;
}

/** Тариф перевозчика + добавочная стоимость (для отображения на checkout). */
export function withDeliverySurcharge(
  baseRub: number | null,
  carrier: JcosShippingCarrier | null | undefined,
  surcharges: DeliverySurcharges,
): number | null {
  if (baseRub == null || !carrier) return baseRub;
  const base = Math.floor(baseRub);
  if (!Number.isFinite(base) || base < 1) return null;
  return base + surchargeRubForCarrier(carrier, surcharges);
}

/** База без добавки — для clientEstimate в shipping-quote. */
export function clientEstimateBaseRub(
  displayedRub: number,
  carrier: JcosShippingCarrier,
  surcharges: DeliverySurcharges,
): number {
  return Math.max(
    0,
    Math.floor(displayedRub) - surchargeRubForCarrier(carrier, surcharges),
  );
}
