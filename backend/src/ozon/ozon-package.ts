/**
 * Габариты посылки Ozon из каталога. Цепочка на строку корзины:
 * 1) вес/габариты варианта (после проверки на мусор: 0 г, 70 000 г у 30 мл, мм вне диапазона);
 * 2) типоразмер по объёму (volumeMl) — лесенка откалибрована по заполненным вариантам каталога;
 * 3) объём упаковки (packageVolume, л) — куб;
 * 4) дефолт «средняя баночка» (раньше 300 г / 3 л — завышал оплачиваемый вес в ~4 раза).
 */

export type VariantDimsInput = {
  weightGrams?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  volumeMl?: number | null;
  /** Объём упаковки, литры. */
  packageVolume?: number | null;
};

export type ItemDims = {
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
};

/** catalog — всё из варианта; volume/package/default — чем заполнены недостающие поля. */
export type DimsSource = 'catalog' | 'volume' | 'package' | 'default';

export type ResolvedItemDims = {
  dims: ItemDims;
  weightSource: DimsSource;
  sizeSource: DimsSource;
  issues: string[];
};

export const WEIGHT_MIN_G = 5;
export const WEIGHT_MAX_G = 30_000;
export const SIDE_MIN_MM = 5;
export const SIDE_MAX_MM = 1_500;

/** Упаковка посылки: пакет/коробка + плёнка. */
export const PACKAGING_WEIGHT_G = 40;
/** Пустоты в коробке при нескольких товарах. */
export const PACKING_VOLUME_FACTOR = 1.25;

export const DEFAULT_ITEM_DIMS: ItemDims = {
  weightGrams: 120,
  lengthMm: 45,
  widthMm: 45,
  heightMm: 140,
};

/** [до мл включительно, типоразмер] — медианы заполненных вариантов каталога (сентябрь 2026). */
const VOLUME_LADDER: ReadonlyArray<readonly [number, ItemDims]> = [
  [15, { weightGrams: 60, lengthMm: 39, widthMm: 39, heightMm: 110 }],
  [50, { weightGrams: 90, lengthMm: 39, widthMm: 39, heightMm: 152 }],
  [100, { weightGrams: 140, lengthMm: 49, widthMm: 49, heightMm: 170 }],
  [150, { weightGrams: 180, lengthMm: 49, widthMm: 49, heightMm: 170 }],
];

function finitePositive(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

export function dimsFromVolumeMl(volumeMl: number | null | undefined): ItemDims | null {
  if (!finitePositive(volumeMl)) return null;
  for (const [maxMl, dims] of VOLUME_LADDER) {
    if (volumeMl <= maxMl) return dims;
  }
  return {
    weightGrams: Math.round(volumeMl * 1.1 + 40),
    lengthMm: 60,
    widthMm: 60,
    heightMm: 200,
  };
}

function dimsFromPackageVolume(liters: number | null | undefined): Omit<ItemDims, 'weightGrams'> | null {
  if (!finitePositive(liters) || liters < 0.02 || liters > 60) return null;
  const side = Math.round(Math.cbrt(liters * 1_000_000));
  return { lengthMm: side, widthMm: side, heightMm: side };
}

/**
 * Проблемы с весом/габаритами варианта. Вес «подозрительный», если он не лезет
 * в физику банки: больше 5 г на мл + 400 г на стекло и коробку.
 */
export function variantDimsIssues(v: VariantDimsInput): string[] {
  const issues: string[] = [];
  const w = v.weightGrams;
  if (w == null) {
    issues.push('нет веса');
  } else if (!Number.isFinite(w) || w < WEIGHT_MIN_G || w > WEIGHT_MAX_G) {
    issues.push(`вес ${w} г вне диапазона ${WEIGHT_MIN_G}–${WEIGHT_MAX_G}`);
  } else if (finitePositive(v.volumeMl) && w > v.volumeMl * 5 + 400) {
    issues.push(`вес ${w} г не соответствует объёму ${v.volumeMl} мл`);
  }
  const sides = [v.lengthMm, v.widthMm, v.heightMm];
  if (sides.some((s) => s == null)) {
    issues.push('нет габаритов');
  } else if (sides.some((s) => !Number.isFinite(s!) || s! < SIDE_MIN_MM || s! > SIDE_MAX_MM)) {
    issues.push(`габариты вне диапазона ${SIDE_MIN_MM}–${SIDE_MAX_MM} мм`);
  }
  return issues;
}

function weightValid(v: VariantDimsInput): boolean {
  const w = v.weightGrams;
  if (!finitePositive(w) || w < WEIGHT_MIN_G || w > WEIGHT_MAX_G) return false;
  return !(finitePositive(v.volumeMl) && w > v.volumeMl * 5 + 400);
}

function sidesValid(v: VariantDimsInput): boolean {
  return [v.lengthMm, v.widthMm, v.heightMm].every(
    (s) => finitePositive(s) && s >= SIDE_MIN_MM && s <= SIDE_MAX_MM,
  );
}

export function resolveItemDims(v: VariantDimsInput): ResolvedItemDims {
  const issues = variantDimsIssues(v);
  const byVolume = dimsFromVolumeMl(v.volumeMl);
  const byPackage = dimsFromPackageVolume(v.packageVolume);

  let weightGrams = DEFAULT_ITEM_DIMS.weightGrams;
  let weightSource: DimsSource = 'default';
  if (weightValid(v)) {
    weightGrams = v.weightGrams!;
    weightSource = 'catalog';
  } else if (byVolume) {
    weightGrams = byVolume.weightGrams;
    weightSource = 'volume';
  }

  let size: Omit<ItemDims, 'weightGrams'> = DEFAULT_ITEM_DIMS;
  let sizeSource: DimsSource = 'default';
  if (sidesValid(v)) {
    size = { lengthMm: v.lengthMm!, widthMm: v.widthMm!, heightMm: v.heightMm! };
    sizeSource = 'catalog';
  } else if (byVolume) {
    size = byVolume;
    sizeSource = 'volume';
  } else if (byPackage) {
    size = byPackage;
    sizeSource = 'package';
  }

  return {
    dims: { weightGrams, lengthMm: size.lengthMm, widthMm: size.widthMm, heightMm: size.heightMm },
    weightSource,
    sizeSource,
    issues,
  };
}

export type ParcelLine = VariantDimsInput & { qty: number };

export type Parcel = {
  weightGrams: number;
  volumeLiters: number;
  /** Сколько штук посчитано по каталогу целиком, а сколько — с подстановкой. */
  sources: { catalog: number; estimated: number; default: number };
};

export function buildParcel(lines: ParcelLine[]): Parcel {
  let weightGrams = 0;
  let volumeMm3 = 0;
  const sources = { catalog: 0, estimated: 0, default: 0 };
  for (const line of lines) {
    const q = Math.max(1, Math.floor(line.qty || 1));
    const r = resolveItemDims(line);
    weightGrams += r.dims.weightGrams * q;
    volumeMm3 += r.dims.lengthMm * r.dims.widthMm * r.dims.heightMm * q;
    if (r.weightSource === 'catalog' && r.sizeSource === 'catalog') sources.catalog += q;
    else if (r.weightSource === 'default' && r.sizeSource === 'default') sources.default += q;
    else sources.estimated += q;
  }
  if (!lines.length) return { weightGrams: 0, volumeLiters: 0, sources };
  return {
    weightGrams: weightGrams + PACKAGING_WEIGHT_G,
    volumeLiters: (volumeMm3 * PACKING_VOLUME_FACTOR) / 1_000_000,
    sources,
  };
}
