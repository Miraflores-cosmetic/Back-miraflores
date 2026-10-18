import type { CheckoutCarrier } from './order-shipping.resolve';

export type DeliverySurchargeKind = 'FIXED' | 'PERCENT';

export type CarrierSurcharge = {
  kind: DeliverySurchargeKind;
  value: number;
};

export type DeliverySurchargesConfig = {
  cdek: CarrierSurcharge;
  ozon: CarrierSurcharge;
  yandex: CarrierSurcharge;
};

export const DELIVERY_SURCHARGE_DEFAULTS: DeliverySurchargesConfig = {
  cdek: { kind: 'FIXED', value: 0 },
  ozon: { kind: 'FIXED', value: 0 },
  yandex: { kind: 'FIXED', value: 0 },
};

function normalizeKind(raw: unknown): DeliverySurchargeKind {
  return raw === 'PERCENT' ? 'PERCENT' : 'FIXED';
}

function normalizeCarrier(raw: {
  kind?: unknown;
  value?: unknown;
  /** @deprecated legacy rub-only row */
  rub?: unknown;
}): CarrierSurcharge {
  const kind = normalizeKind(raw.kind);
  const source = raw.value ?? raw.rub ?? 0;
  const n = Math.floor(Number(source) || 0);
  if (kind === 'PERCENT') {
    return { kind, value: Math.max(0, Math.min(100, n)) };
  }
  return { kind, value: Math.max(0, Math.min(500_000, n)) };
}

export function normalizeDeliverySurchargeRow(row: {
  cdekSurchargeKind?: unknown;
  cdekSurchargeValue?: unknown;
  ozonSurchargeKind?: unknown;
  ozonSurchargeValue?: unknown;
  yandexSurchargeKind?: unknown;
  yandexSurchargeValue?: unknown;
  /** legacy columns (pre-migration) */
  cdekSurchargeRub?: unknown;
  ozonSurchargeRub?: unknown;
  yandexSurchargeRub?: unknown;
}): DeliverySurchargesConfig {
  return {
    cdek: normalizeCarrier({
      kind: row.cdekSurchargeKind,
      value: row.cdekSurchargeValue,
      rub: row.cdekSurchargeRub,
    }),
    ozon: normalizeCarrier({
      kind: row.ozonSurchargeKind,
      value: row.ozonSurchargeValue,
      rub: row.ozonSurchargeRub,
    }),
    yandex: normalizeCarrier({
      kind: row.yandexSurchargeKind,
      value: row.yandexSurchargeValue,
      rub: row.yandexSurchargeRub,
    }),
  };
}

export function surchargeRubFromCarrierSetting(
  setting: CarrierSurcharge,
  baseTariffRub: number,
): number {
  const base = Math.max(0, Math.floor(baseTariffRub));
  if (setting.kind === 'PERCENT') {
    const p = Math.max(0, Math.min(100, Math.floor(setting.value)));
    return Math.round((base * p) / 100);
  }
  return Math.max(0, Math.min(500_000, Math.floor(setting.value)));
}

export function surchargeRubForCheckoutCarrier(
  method: CheckoutCarrier,
  baseTariffRub: number,
  surcharges: DeliverySurchargesConfig = DELIVERY_SURCHARGE_DEFAULTS,
): number {
  const setting =
    method === 'CDEK'
      ? surcharges.cdek
      : method === 'OZON'
        ? surcharges.ozon
        : surcharges.yandex;
  return surchargeRubFromCarrierSetting(setting, baseTariffRub);
}

/** База тарифа до добавки (для clientEstimate с процентом). */
export function baseTariffBeforeSurcharge(
  displayedRub: number,
  method: CheckoutCarrier,
  surcharges: DeliverySurchargesConfig,
): number {
  const displayed = Math.max(0, Math.floor(displayedRub));
  const setting =
    method === 'CDEK'
      ? surcharges.cdek
      : method === 'OZON'
        ? surcharges.ozon
        : surcharges.yandex;
  if (setting.kind === 'FIXED') {
    return Math.max(0, displayed - surchargeRubFromCarrierSetting(setting, displayed));
  }
  let lo = 0;
  let hi = displayed;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const withS = mid + surchargeRubFromCarrierSetting(setting, mid);
    if (withS > displayed) hi = mid - 1;
    else lo = mid;
  }
  return lo;
}
