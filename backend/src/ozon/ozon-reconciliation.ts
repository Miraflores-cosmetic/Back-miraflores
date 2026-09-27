import {
  currentOzonTariff,
  ozonPvzTariffRub,
  ozonTierIndex,
  type OzonDropoff,
  type OzonTariffTable,
} from './ozon-tariff';

export type ReconciliationInput = {
  orderId: string;
  orderNumber: string;
  shippedAt: string;
  dropoff: OzonDropoff;
  billableGrams: number | null;
  estimatedCostRub: number | null;
  carrierCostRub: number;
  tariffVersion: string | null;
};

export type TierReport = {
  index: number;
  label: string;
  currentRub: number;
  n: number;
  medianActualRub: number | null;
  deltaPct: number | null;
  suggestedRub: number | null;
  needsReview: boolean;
};

export type ReconciliationReport = {
  tariffVersion: string;
  days: number;
  minSamplesPerTier: number;
  thresholdPct: number;
  summary: {
    shipments: number;
    estimatedTotalRub: number;
    actualTotalRub: number;
    /** (факт − оценка) / оценка по сумме; + — Ozon берёт больше, чем мы закладываем. */
    biasPct: number | null;
    meanAbsPct: number | null;
  };
  pvzTiers: TierReport[];
  courier: {
    n: number;
    currentMultiplier: number;
    medianMultiplier: number | null;
    needsReview: boolean;
  };
  rows: ReconciliationInput[];
};

export const RECONCILIATION_MIN_SAMPLES = 5;
export const RECONCILIATION_THRESHOLD_PCT = 10;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pct(actual: number, estimated: number): number | null {
  return estimated > 0 ? ((actual - estimated) / estimated) * 100 : null;
}

function round1(n: number | null): number | null {
  return n == null ? null : Math.round(n * 10) / 10;
}

function tierLabel(table: OzonTariffTable, i: number): string {
  if (i >= table.pvzTiers.length) return `> ${table.pvzTiers[table.pvzTiers.length - 1][0]} кг`;
  const from = i === 0 ? 0 : table.pvzTiers[i - 1][0];
  return `${from}–${table.pvzTiers[i][0]} кг`;
}

/**
 * Сверка своей сетки с фактическим биллингом Ozon. Ступень «на пересмотр»,
 * если по ней ≥ minSamples отправлений и медиана факта отличается от цены ступени ≥ threshold %.
 */
export function buildReconciliationReport(
  input: ReconciliationInput[],
  opts: { days: number; table?: OzonTariffTable } ,
): ReconciliationReport {
  const table = opts.table ?? currentOzonTariff();
  const withEstimate = input.filter((r) => r.estimatedCostRub != null);
  const estimatedTotal = withEstimate.reduce((s, r) => s + r.estimatedCostRub!, 0);
  const actualTotalForEstimated = withEstimate.reduce((s, r) => s + r.carrierCostRub, 0);
  const absPcts = withEstimate
    .map((r) => pct(r.carrierCostRub, r.estimatedCostRub!))
    .filter((p): p is number => p != null)
    .map(Math.abs);

  const pvzByTier = new Map<number, number[]>();
  const courierRatios: number[] = [];
  for (const r of input) {
    if (r.billableGrams == null) continue;
    const kg = r.billableGrams / 1000;
    if (r.dropoff === 'pvz') {
      const i = ozonTierIndex(kg, table);
      pvzByTier.set(i, [...(pvzByTier.get(i) ?? []), r.carrierCostRub]);
    } else {
      const base = ozonPvzTariffRub(kg, table);
      if (base > 0) courierRatios.push(r.carrierCostRub / base);
    }
  }

  const pvzTiers: TierReport[] = [];
  for (let i = 0; i <= table.pvzTiers.length; i++) {
    const currentRub = i < table.pvzTiers.length ? table.pvzTiers[i][1] : table.pvzMaxRub;
    const actual = pvzByTier.get(i) ?? [];
    const med = median(actual);
    const delta = med == null ? null : pct(med, currentRub);
    pvzTiers.push({
      index: i,
      label: tierLabel(table, i),
      currentRub,
      n: actual.length,
      medianActualRub: med == null ? null : Math.round(med),
      deltaPct: round1(delta),
      suggestedRub: med == null ? null : Math.round(med),
      needsReview:
        actual.length >= RECONCILIATION_MIN_SAMPLES &&
        delta != null &&
        Math.abs(delta) >= RECONCILIATION_THRESHOLD_PCT,
    });
  }

  const medMult = median(courierRatios);
  return {
    tariffVersion: table.version,
    days: opts.days,
    minSamplesPerTier: RECONCILIATION_MIN_SAMPLES,
    thresholdPct: RECONCILIATION_THRESHOLD_PCT,
    summary: {
      shipments: input.length,
      estimatedTotalRub: estimatedTotal,
      actualTotalRub: input.reduce((s, r) => s + r.carrierCostRub, 0),
      biasPct: round1(estimatedTotal > 0 ? pct(actualTotalForEstimated, estimatedTotal) : null),
      meanAbsPct: round1(absPcts.length ? absPcts.reduce((s, p) => s + p, 0) / absPcts.length : null),
    },
    pvzTiers,
    courier: {
      n: courierRatios.length,
      currentMultiplier: table.courierMultiplier,
      medianMultiplier: medMult == null ? null : Math.round(medMult * 100) / 100,
      needsReview:
        courierRatios.length >= RECONCILIATION_MIN_SAMPLES &&
        medMult != null &&
        Math.abs(pct(medMult, table.courierMultiplier) ?? 0) >= RECONCILIATION_THRESHOLD_PCT,
    },
    rows: [...input].sort((a, b) => b.shippedAt.localeCompare(a.shippedAt)).slice(0, 50),
  };
}
