/**
 * Своя тарифная сетка Ozon Доставки (у приложения нет метода расчёта цены).
 * Единый источник: публичная оценка на checkout, серверный quote и сверка с биллингом Ozon.
 * Регламент обновления — docs/ozon-delivery.md, раздел «Тарифная сетка».
 */
import { buildParcel, type ParcelLine, type Parcel } from './ozon-package';

export type OzonDropoff = 'pvz' | 'courier';

export type OzonTariffLine = ParcelLine;

/** [верхняя граница кг включительно, ₽] для ПВЗ; дальше — maxRub. */
export type OzonTariffTable = {
  version: string;
  pvzTiers: ReadonlyArray<readonly [number, number]>;
  pvzMaxRub: number;
  courierMultiplier: number;
  /** Объёмный вес: литры / divisor. */
  volumetricDivisor: number;
};

export type OzonTariffResult = {
  cost: number;
  daysMin: number;
  daysMax: number;
  billableKg: number;
  tariffVersion: string;
  parcel: Parcel;
};

export const DEFAULT_OZON_TARIFF: OzonTariffTable = {
  version: '2026-09-local-v1',
  pvzTiers: [
    [0.4, 49],
    [1, 79],
    [2, 99],
    [3, 129],
    [5, 169],
    [10, 249],
    [20, 399],
    [35, 599],
  ],
  pvzMaxRub: 799,
  courierMultiplier: 1.8,
  volumetricDivisor: 5,
};

/**
 * «0.4:49,1:79,…,max:799» → ступени. Возвращает null при любой ошибке
 * (невалидная сетка из env не должна ломать checkout — берём дефолт).
 */
export function parseOzonTiers(
  raw: string,
): { pvzTiers: Array<[number, number]>; pvzMaxRub: number } | null {
  const tiers: Array<[number, number]> = [];
  let max: number | null = null;
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [k, v] = part.split(':').map((s) => s.trim());
    const rub = Number(v);
    if (!Number.isFinite(rub) || rub <= 0) return null;
    if (k === 'max') {
      max = Math.round(rub);
      continue;
    }
    const kg = Number(k);
    if (!Number.isFinite(kg) || kg <= 0) return null;
    tiers.push([kg, Math.round(rub)]);
  }
  if (!tiers.length || max == null) return null;
  tiers.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i][0] === tiers[i - 1][0] || tiers[i][1] < tiers[i - 1][1]) return null;
  }
  if (max < tiers[tiers.length - 1][1]) return null;
  return { pvzTiers: tiers, pvzMaxRub: max };
}

let envCache: { key: string; table: OzonTariffTable } | null = null;

/** Действующая сетка: дефолт из кода или override из OZON_TARIFF_PVZ_TIERS / OZON_TARIFF_COURIER_MULTIPLIER. */
export function currentOzonTariff(env: NodeJS.ProcessEnv = process.env): OzonTariffTable {
  const tiersRaw = env.OZON_TARIFF_PVZ_TIERS?.trim() || '';
  const multRaw = env.OZON_TARIFF_COURIER_MULTIPLIER?.trim() || '';
  const versionRaw = env.OZON_TARIFF_VERSION?.trim() || '';
  if (!tiersRaw && !multRaw) return DEFAULT_OZON_TARIFF;
  const key = `${tiersRaw}|${multRaw}|${versionRaw}`;
  if (envCache?.key === key) return envCache.table;

  const parsed = tiersRaw ? parseOzonTiers(tiersRaw) : null;
  const mult = Number(multRaw);
  const table: OzonTariffTable = {
    ...DEFAULT_OZON_TARIFF,
    ...(parsed ?? {}),
    courierMultiplier: Number.isFinite(mult) && mult >= 1 && mult <= 5 ? mult : DEFAULT_OZON_TARIFF.courierMultiplier,
    version: parsed || multRaw ? versionRaw || 'env-override' : DEFAULT_OZON_TARIFF.version,
  };
  envCache = { key, table };
  return table;
}

export function ozonBillableKg(
  lines: OzonTariffLine[],
  table: OzonTariffTable = currentOzonTariff(),
): number {
  const parcel = buildParcel(lines);
  return billableKgOf(parcel, table);
}

function billableKgOf(parcel: Parcel, table: OzonTariffTable): number {
  return Math.max(parcel.weightGrams / 1000, parcel.volumeLiters / table.volumetricDivisor);
}

export function ozonPvzTariffRub(
  billableKg: number,
  table: OzonTariffTable = currentOzonTariff(),
): number {
  for (const [maxKg, rub] of table.pvzTiers) {
    if (billableKg <= maxKg) return rub;
  }
  return table.pvzMaxRub;
}

/** Номер ступени (0…n; n — «сверх последней») — для сверки по ступеням. */
export function ozonTierIndex(billableKg: number, table: OzonTariffTable = currentOzonTariff()): number {
  const i = table.pvzTiers.findIndex(([maxKg]) => billableKg <= maxKg);
  return i === -1 ? table.pvzTiers.length : i;
}

export function estimateOzonDelivery(
  lines: OzonTariffLine[],
  dropoff: OzonDropoff,
  table: OzonTariffTable = currentOzonTariff(),
): OzonTariffResult | null {
  if (!lines.length) return null;
  const parcel = buildParcel(lines);
  const billableKg = billableKgOf(parcel, table);
  const pvz = ozonPvzTariffRub(billableKg, table);
  const base = { billableKg, tariffVersion: table.version, parcel };
  if (dropoff === 'courier') {
    return { ...base, cost: Math.round(pvz * table.courierMultiplier), daysMin: 2, daysMax: 4 };
  }
  return { ...base, cost: pvz, daysMin: 3, daysMax: 6 };
}
