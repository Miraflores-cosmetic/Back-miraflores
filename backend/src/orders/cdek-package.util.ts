/** Сборка packages/items для API СДЭК (калькулятор и создание заказа). */

export type CdekOrderLineInput = {
  title: string;
  sku: string;
  qty: number;
  unitPrice: number;
  isGratitudeGift?: boolean;
  variantId?: string | null;
};

export type CdekVariantDims = {
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
};

const DEFAULT_WEIGHT_G = 300;
const DEFAULT_L_MM = 200;
const DEFAULT_W_MM = 150;
const DEFAULT_H_MM = 100;

export function packageDimsForQuantity(
  lengthCm: number,
  widthCm: number,
  heightCm: number,
  quantity: number,
): { length: number; width: number; height: number } {
  const q = Math.max(1, Math.floor(quantity) || 1);
  const l = Math.max(1, Math.round(lengthCm));
  const w = Math.max(1, Math.round(widthCm));
  const h = Math.max(1, Math.round(heightCm));
  if (q <= 1) return { length: l, width: w, height: h };
  const scale = Math.cbrt(q);
  return {
    length: Math.max(1, Math.round(l * scale)),
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

export function resolveCdekVariantDims(row?: CdekVariantDims | null): {
  weightG: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
} {
  return {
    weightG: Math.max(1, row?.weightGrams ?? DEFAULT_WEIGHT_G),
    lengthCm: Math.max(1, Math.round((row?.lengthMm ?? DEFAULT_L_MM) / 10)),
    widthCm: Math.max(1, Math.round((row?.widthMm ?? DEFAULT_W_MM) / 10)),
    heightCm: Math.max(1, Math.round((row?.heightMm ?? DEFAULT_H_MM) / 10)),
  };
}

export type CdekPackagePayload = {
  number: string;
  weight: number;
  length: number;
  width: number;
  height: number;
  items: Array<{
    name: string;
    ware_key: string;
    payment: { value: number };
    cost: number;
    amount: number;
    weight: number;
  }>;
};

/** Габариты одного места: суммарный объём линий, форма — по крупнейшей позиции. */
export function aggregateCdekPackageMetrics(
  lines: CdekOrderLineInput[],
  variantById: Map<string, CdekVariantDims> = new Map(),
): { weight: number; length: number; width: number; height: number } {
  let totalWeight = 0;
  let totalVolume = 0;
  let shapeLength = DEFAULT_L_MM / 10;
  let shapeWidth = DEFAULT_W_MM / 10;
  let shapeHeight = DEFAULT_H_MM / 10;
  let maxUnitVolume = 0;

  for (const l of lines) {
    const row = l.variantId ? variantById.get(l.variantId) : undefined;
    const { weightG, lengthCm, widthCm, heightCm } = resolveCdekVariantDims(row);
    const amount = Math.max(1, l.qty);
    totalWeight += weightG * amount;
    const unitVol = lengthCm * widthCm * heightCm;
    totalVolume += unitVol * amount;
    if (unitVol >= maxUnitVolume) {
      maxUnitVolume = unitVol;
      shapeLength = lengthCm;
      shapeWidth = widthCm;
      shapeHeight = heightCm;
    }
  }

  const templateVol = shapeLength * shapeWidth * shapeHeight;
  const dims =
    totalVolume > 0 && templateVol > 0
      ? (() => {
          const scale = Math.cbrt(totalVolume / templateVol);
          return {
            length: Math.max(1, Math.round(shapeLength * scale)),
            width: Math.max(1, Math.round(shapeWidth * scale)),
            height: Math.max(1, Math.round(shapeHeight * scale)),
          };
        })()
      : { length: shapeLength, width: shapeWidth, height: shapeHeight };

  return {
    weight: Math.max(1, totalWeight),
    ...dims,
  };
}

/** Одно место (package) на заказ; позиции — в items[], веса из ProductVariant. */
export function buildCdekPackagesFromOrderItems(
  lines: CdekOrderLineInput[],
  variantById: Map<string, CdekVariantDims> = new Map(),
): CdekPackagePayload[] {
  if (!lines.length) return [];

  const items = lines.map((l, idx) => {
    const row = l.variantId ? variantById.get(l.variantId) : undefined;
    const { weightG } = resolveCdekVariantDims(row);
    const amount = Math.max(1, l.qty);
    return {
      name: (l.title || 'Товар').slice(0, 255),
      ware_key: (l.sku || `sku-${idx + 1}`).slice(0, 50),
      payment: { value: 0 as const },
      cost: Math.max(0, l.unitPrice),
      amount,
      weight: weightG,
    };
  });

  const metrics = aggregateCdekPackageMetrics(lines, variantById);

  return [
    {
      number: '1',
      ...metrics,
      items,
    },
  ];
}
