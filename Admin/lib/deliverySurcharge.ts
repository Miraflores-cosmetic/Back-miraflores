import type { JcosShippingCarrier } from '@/lib/shipping/addressShippingMeta';

export type DeliverySurchargeKind = 'FIXED' | 'PERCENT';

export type CarrierSurcharge = {
  kind: DeliverySurchargeKind;
  value: number;
};

export type DeliverySurcharges = {
  cdek: CarrierSurcharge;
  ozon: CarrierSurcharge;
  yandex: CarrierSurcharge;
};

export const DELIVERY_SURCHARGE_DEFAULTS: DeliverySurcharges = {
  cdek: { kind: 'FIXED', value: 0 },
  ozon: { kind: 'FIXED', value: 0 },
  yandex: { kind: 'FIXED', value: 0 },
};

function normalizeKind(raw: unknown): DeliverySurchargeKind {
  return raw === 'PERCENT' ? 'PERCENT' : 'FIXED';
}

function normalizeCarrier(kindRaw: unknown, valueRaw: unknown, legacyRub?: unknown): CarrierSurcharge {
  const kind = normalizeKind(kindRaw);
  const n = Math.floor(Number(valueRaw ?? legacyRub ?? 0) || 0);
  if (kind === 'PERCENT') return { kind, value: Math.max(0, Math.min(100, n)) };
  return { kind, value: Math.max(0, Math.min(500_000, n)) };
}

/** API / legacy flat keys. */
export function normalizeDeliverySurcharges(
  data: Partial<{
    cdekSurchargeKind: unknown;
    cdekSurchargeValue: unknown;
    ozonSurchargeKind: unknown;
    ozonSurchargeValue: unknown;
    yandexSurchargeKind: unknown;
    yandexSurchargeValue: unknown;
    cdekSurchargeRub: unknown;
    ozonSurchargeRub: unknown;
    yandexSurchargeRub: unknown;
  }> | null | undefined,
): DeliverySurcharges {
  return {
    cdek: normalizeCarrier(data?.cdekSurchargeKind, data?.cdekSurchargeValue, data?.cdekSurchargeRub),
    ozon: normalizeCarrier(data?.ozonSurchargeKind, data?.ozonSurchargeValue, data?.ozonSurchargeRub),
    yandex: normalizeCarrier(
      data?.yandexSurchargeKind,
      data?.yandexSurchargeValue,
      data?.yandexSurchargeRub,
    ),
  };
}

export function deliverySurchargesToApiPayload(s: DeliverySurcharges) {
  return {
    cdekSurchargeKind: s.cdek.kind,
    cdekSurchargeValue: s.cdek.value,
    ozonSurchargeKind: s.ozon.kind,
    ozonSurchargeValue: s.ozon.value,
    yandexSurchargeKind: s.yandex.kind,
    yandexSurchargeValue: s.yandex.value,
  };
}

function settingForCarrier(carrier: JcosShippingCarrier, surcharges: DeliverySurcharges): CarrierSurcharge {
  if (carrier === 'cdek') return surcharges.cdek;
  if (carrier === 'ozon') return surcharges.ozon;
  return surcharges.yandex;
}

export function surchargeRubForCarrier(
  carrier: JcosShippingCarrier,
  surcharges: DeliverySurcharges,
  baseTariffRub: number,
): number {
  const setting = settingForCarrier(carrier, surcharges);
  const base = Math.max(0, Math.floor(baseTariffRub));
  if (setting.kind === 'PERCENT') {
    const p = Math.max(0, Math.min(100, Math.floor(setting.value)));
    return Math.round((base * p) / 100);
  }
  return Math.max(0, Math.min(500_000, Math.floor(setting.value)));
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
  return base + surchargeRubForCarrier(carrier, surcharges, base);
}

/** База без добавки — для clientEstimate в shipping-quote. */
export function clientEstimateBaseRub(
  displayedRub: number,
  carrier: JcosShippingCarrier,
  surcharges: DeliverySurcharges,
): number {
  const displayed = Math.max(0, Math.floor(displayedRub));
  const setting = settingForCarrier(carrier, surcharges);
  if (setting.kind === 'FIXED') {
    return Math.max(0, displayed - surchargeRubForCarrier(carrier, surcharges, displayed));
  }
  let lo = 0;
  let hi = displayed;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const withS = mid + surchargeRubForCarrier(carrier, surcharges, mid);
    if (withS > displayed) hi = mid - 1;
    else lo = mid;
  }
  return lo;
}
