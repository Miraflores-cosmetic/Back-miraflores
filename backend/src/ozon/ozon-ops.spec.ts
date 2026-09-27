import { describe, expect, it } from 'vitest';
import { variantDimsUpdateData } from './ozon-catalog-dims.service';
import { buildDimsAudit, type AuditVariant } from './ozon-dims-audit';
import {
  decideOzonAlert,
  OZON_ALERT_COOLDOWN_MS,
  ozonHealthIntervalMin,
} from './ozon-health.util';
import { buildParcel, resolveItemDims, variantDimsIssues } from './ozon-package';
import { buildReconciliationReport, type ReconciliationInput } from './ozon-reconciliation';
import { DEFAULT_OZON_TARIFF, estimateOzonDelivery } from './ozon-tariff';

describe('ozon-package', () => {
  it('uses catalog values when they are sane', () => {
    const r = resolveItemDims({ weightGrams: 95, lengthMm: 40, widthMm: 40, heightMm: 150, volumeMl: 50 });
    expect(r.weightSource).toBe('catalog');
    expect(r.sizeSource).toBe('catalog');
    expect(r.issues).toEqual([]);
  });

  it('replaces garbage weight with the volume ladder', () => {
    const r = resolveItemDims({ weightGrams: 70_000, lengthMm: 40, widthMm: 40, heightMm: 150, volumeMl: 30 });
    expect(r.weightSource).toBe('volume');
    expect(r.dims.weightGrams).toBe(90);
    expect(r.sizeSource).toBe('catalog');
    expect(r.issues[0]).toMatch(/вне диапазона/);
  });

  it('flags weight that does not match the volume', () => {
    expect(variantDimsIssues({ weightGrams: 500, volumeMl: 15, lengthMm: 40, widthMm: 40, heightMm: 110 })).toEqual([
      'вес 500 г не соответствует объёму 15 мл',
    ]);
  });

  it('falls back to package volume cube, then default', () => {
    expect(resolveItemDims({ packageVolume: 1 }).dims).toMatchObject({ lengthMm: 100, widthMm: 100, heightMm: 100 });
    expect(resolveItemDims({}).sizeSource).toBe('default');
  });

  it('adds packaging weight and void factor to the parcel', () => {
    const p = buildParcel([{ qty: 1 }]);
    expect(p.weightGrams).toBe(160);
    expect(p.volumeLiters).toBeCloseTo((45 * 45 * 140 * 1.25) / 1e6, 6);
    expect(p.sources).toEqual({ catalog: 0, estimated: 0, default: 1 });
    expect(estimateOzonDelivery([{ qty: 1 }], 'pvz', DEFAULT_OZON_TARIFF)?.cost).toBe(49);
  });
});

function variant(p: Partial<AuditVariant> & { id: string }): AuditVariant {
  return {
    productId: 'p1',
    productName: 'Крем',
    productType: null,
    variantName: '50 мл',
    sku: p.id,
    active: true,
    volumeMl: 50,
    packageVolume: null,
    weightGrams: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    ...p,
  };
}

describe('ozon-dims-audit', () => {
  const full = { weightGrams: 100, lengthMm: 40, widthMm: 40, heightMm: 150 };

  it('prefers a sibling variant of the same product and volume', () => {
    const audit = buildDimsAudit([variant({ id: 'a', ...full }), variant({ id: 'b' })]);
    expect(audit.summary).toMatchObject({ active: 2, complete: 1, missing: 1, withSuggestion: 1 });
    expect(audit.rows[0].suggestion).toEqual({ ...full, source: 'sibling' });
  });

  it('uses the most common catalog tuple for the volume, then the ladder', () => {
    const audit = buildDimsAudit([
      variant({ id: 'x', productId: 'p2', ...full }),
      variant({ id: 'y', productId: 'p3', ...full }),
      variant({ id: 'z', productId: 'p4', weightGrams: 120, lengthMm: 45, widthMm: 45, heightMm: 160 }),
      variant({ id: 'b' }),
      variant({ id: 'c', volumeMl: 15 }),
    ]);
    const byId = new Map(audit.rows.map((r) => [r.id, r]));
    expect(byId.get('b')?.suggestion).toEqual({ ...full, source: 'catalog' });
    expect(byId.get('c')?.suggestion).toMatchObject({ weightGrams: 60, source: 'ladder' });
  });

  it('keeps valid fields and only suggests the broken ones', () => {
    const audit = buildDimsAudit([
      variant({ id: 'a', ...full }),
      variant({ id: 'b', weightGrams: 70_000, lengthMm: 41, widthMm: 41, heightMm: 151 }),
    ]);
    expect(audit.summary.suspicious).toBe(1);
    expect(audit.rows[0].suggestion).toEqual({
      weightGrams: 100,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      source: 'sibling',
    });
  });

  it('suggests weight from variants with the same box when own size is valid', () => {
    const small = { weightGrams: 70, lengthMm: 39, widthMm: 39, heightMm: 110 };
    const premium = { weightGrams: 170, lengthMm: 49, widthMm: 49, heightMm: 170 };
    const audit = buildDimsAudit([
      variant({ id: 's1', productId: 'p2', ...small }),
      variant({ id: 'p1', productId: 'p3', ...premium }),
      variant({ id: 'p2', productId: 'p4', ...premium }),
      variant({ id: 'bad', productId: 'p5', weightGrams: 5000, lengthMm: 39, widthMm: 39, heightMm: 110 }),
      variant({ id: 'empty', productId: 'p6' }),
    ]);
    const byId = new Map(audit.rows.map((r) => [r.id, r]));
    expect(byId.get('bad')?.suggestion).toMatchObject({ weightGrams: 70, lengthMm: null, source: 'catalog' });
    expect(byId.get('empty')?.suggestion).toMatchObject({ ...premium, source: 'catalog' });
  });

  it('ignores inactive variants and gives no suggestion without volume', () => {
    const audit = buildDimsAudit([variant({ id: 'off', active: false }), variant({ id: 'nv', volumeMl: null })]);
    expect(audit.summary).toMatchObject({ active: 1, missing: 1, withSuggestion: 0 });
    expect(audit.rows[0].suggestion).toBeNull();
  });

  it('manual edit: sides only as a triple, something must change', () => {
    expect(variantDimsUpdateData({ weightGrams: 95 })).toEqual({ weightGrams: 95 });
    expect(variantDimsUpdateData({ lengthMm: 40, widthMm: 40, heightMm: 150 })).toEqual({
      lengthMm: 40,
      widthMm: 40,
      heightMm: 150,
    });
    expect(() => variantDimsUpdateData({ lengthMm: 40, widthMm: 40 })).toThrow(/все три габарита/);
    expect(() => variantDimsUpdateData({})).toThrow(/Нечего сохранять/);
  });
});

function shipment(p: Partial<ReconciliationInput>): ReconciliationInput {
  return {
    orderId: 'o',
    orderNumber: 'M-1',
    shippedAt: '2026-09-01T10:00:00.000Z',
    dropoff: 'pvz',
    billableGrams: 300,
    estimatedCostRub: 49,
    carrierCostRub: 49,
    tariffVersion: DEFAULT_OZON_TARIFF.version,
    ...p,
  };
}

describe('ozon-reconciliation', () => {
  it('flags a tier when the median actual deviates ≥ 10% with enough samples', () => {
    const rows = [
      ...Array.from({ length: 5 }, () => shipment({ carrierCostRub: 60 })),
      ...Array.from({ length: 2 }, () => shipment({ billableGrams: 800, estimatedCostRub: 79, carrierCostRub: 120 })),
    ];
    const r = buildReconciliationReport(rows, { days: 90, table: DEFAULT_OZON_TARIFF });
    expect(r.pvzTiers[0]).toMatchObject({ n: 5, medianActualRub: 60, suggestedRub: 60, needsReview: true });
    expect(r.pvzTiers[0].deltaPct).toBeCloseTo(22.4, 1);
    expect(r.pvzTiers[1]).toMatchObject({ n: 2, needsReview: false });
    expect(r.summary.shipments).toBe(7);
    expect(r.summary.biasPct).toBeGreaterThan(0);
  });

  it('estimates the courier multiplier from courier shipments', () => {
    const rows = Array.from({ length: 5 }, () =>
      shipment({ dropoff: 'courier', estimatedCostRub: 88, carrierCostRub: 98 }),
    );
    const r = buildReconciliationReport(rows, { days: 30, table: DEFAULT_OZON_TARIFF });
    expect(r.courier).toMatchObject({ n: 5, medianMultiplier: 2, needsReview: true });
    expect(r.pvzTiers.every((t) => t.n === 0)).toBe(true);
  });
});

describe('ozon-health alerts', () => {
  const t0 = new Date('2026-09-26T10:00:00Z');
  const ok = { alertState: 'ok', consecutiveFailures: 0, lastAlertAt: null };

  it('alerts only after two consecutive failures', () => {
    const first = decideOzonAlert(ok, false, t0);
    expect(first).toMatchObject({ alert: null, consecutiveFailures: 1, alertState: 'ok' });
    const second = decideOzonAlert(first, false, t0);
    expect(second).toMatchObject({ alert: 'failing', consecutiveFailures: 2, alertState: 'failing' });
  });

  it('repeats the alert only after the cooldown and sends recovery', () => {
    const failing = { alertState: 'failing', consecutiveFailures: 3, lastAlertAt: t0 };
    expect(decideOzonAlert(failing, false, new Date(t0.getTime() + 60_000)).alert).toBeNull();
    expect(decideOzonAlert(failing, false, new Date(t0.getTime() + OZON_ALERT_COOLDOWN_MS)).alert).toBe('failing');
    expect(decideOzonAlert(failing, true, t0)).toMatchObject({ alert: 'recovered', consecutiveFailures: 0, alertState: 'ok' });
    expect(decideOzonAlert(ok, true, t0).alert).toBeNull();
  });

  it('parses the interval env', () => {
    expect(ozonHealthIntervalMin(undefined)).toBe(30);
    expect(ozonHealthIntervalMin('0')).toBe(0);
    expect(ozonHealthIntervalMin('1')).toBe(5);
    expect(ozonHealthIntervalMin('abc')).toBe(0);
  });
});
