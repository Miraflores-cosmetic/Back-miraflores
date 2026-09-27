import {
  dimsFromVolumeMl,
  resolveItemDims,
  variantDimsIssues,
  type ItemDims,
} from './ozon-package';

export type AuditVariant = {
  id: string;
  productId: string;
  productName: string;
  productType: string | null;
  variantName: string;
  sku: string;
  active: boolean;
  volumeMl: number | null;
  packageVolume: number | null;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
};

/** sibling — вариант того же товара с тем же объёмом; catalog — самый частый типоразмер этого объёма; ladder — лесенка по мл. */
export type SuggestionSource = 'sibling' | 'catalog' | 'ladder';

export type DimsSuggestion = {
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  source: SuggestionSource;
};

export type AuditRow = AuditVariant & {
  issues: string[];
  /** Только поля, которые нужно заменить; валидные значения варианта не трогаем. */
  suggestion: DimsSuggestion | null;
};

export type DimsAudit = {
  summary: {
    active: number;
    complete: number;
    missing: number;
    suspicious: number;
    withSuggestion: number;
  };
  rows: AuditRow[];
};

function tupleKey(d: ItemDims): string {
  return `${d.weightGrams}|${d.lengthMm}|${d.widthMm}|${d.heightMm}`;
}

function completeDims(v: AuditVariant): ItemDims | null {
  if (variantDimsIssues(v).length) return null;
  return {
    weightGrams: v.weightGrams!,
    lengthMm: v.lengthMm!,
    widthMm: v.widthMm!,
    heightMm: v.heightMm!,
  };
}

function mostCommon(dims: ItemDims[]): ItemDims | null {
  const counts = new Map<string, { dims: ItemDims; n: number }>();
  for (const d of dims) {
    const k = tupleKey(d);
    const hit = counts.get(k);
    if (hit) hit.n += 1;
    else counts.set(k, { dims: d, n: 1 });
  }
  let best: { dims: ItemDims; n: number } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best?.dims ?? null;
}

/** Если у варианта валидная коробка — вес берём у вариантов с той же коробкой (30 мл в 39×39×110 ≠ 30 мл в 49×49×170). */
function mostCommonForSize(dims: ItemDims[], size: Omit<ItemDims, 'weightGrams'> | null): ItemDims | null {
  if (size) {
    const same = dims.filter(
      (d) => d.lengthMm === size.lengthMm && d.widthMm === size.widthMm && d.heightMm === size.heightMm,
    );
    if (same.length) return mostCommon(same);
  }
  return mostCommon(dims);
}

/**
 * Аудит веса/габаритов для тарифа Ozon: какие активные варианты заполнены плохо
 * и чем их заполнить (по данным самого каталога, а не по дефолтам).
 */
export function buildDimsAudit(variants: AuditVariant[]): DimsAudit {
  const active = variants.filter((v) => v.active);
  const byVolume = new Map<number, ItemDims[]>();
  const byProductVolume = new Map<string, ItemDims[]>();
  for (const v of variants) {
    const d = completeDims(v);
    if (!d || v.volumeMl == null) continue;
    byVolume.set(v.volumeMl, [...(byVolume.get(v.volumeMl) ?? []), d]);
    const pk = `${v.productId}|${v.volumeMl}`;
    byProductVolume.set(pk, [...(byProductVolume.get(pk) ?? []), d]);
  }

  const summary = { active: active.length, complete: 0, missing: 0, suspicious: 0, withSuggestion: 0 };
  const rows: AuditRow[] = [];
  for (const v of active) {
    const issues = variantDimsIssues(v);
    if (!issues.length) {
      summary.complete += 1;
      continue;
    }
    if (issues.some((i) => i.startsWith('нет '))) summary.missing += 1;
    if (issues.some((i) => !i.startsWith('нет '))) summary.suspicious += 1;

    const resolved = resolveItemDims(v);
    const keepWeight = resolved.weightSource === 'catalog';
    const keepSize = resolved.sizeSource === 'catalog';
    const ownSize = keepSize ? { lengthMm: v.lengthMm!, widthMm: v.widthMm!, heightMm: v.heightMm! } : null;

    let base: ItemDims | null = null;
    let source: SuggestionSource = 'ladder';
    if (v.volumeMl != null) {
      base = mostCommonForSize(byProductVolume.get(`${v.productId}|${v.volumeMl}`) ?? [], ownSize);
      if (base) source = 'sibling';
      else {
        base = mostCommonForSize(byVolume.get(v.volumeMl) ?? [], ownSize);
        if (base) source = 'catalog';
        else {
          base = dimsFromVolumeMl(v.volumeMl);
          source = 'ladder';
        }
      }
    }

    let suggestion: DimsSuggestion | null = null;
    if (base) {
      suggestion = {
        weightGrams: keepWeight ? null : base.weightGrams,
        lengthMm: keepSize ? null : base.lengthMm,
        widthMm: keepSize ? null : base.widthMm,
        heightMm: keepSize ? null : base.heightMm,
        source,
      };
      summary.withSuggestion += 1;
    }
    rows.push({ ...v, issues, suggestion });
  }
  rows.sort(
    (a, b) =>
      Number(Boolean(b.suggestion)) - Number(Boolean(a.suggestion)) ||
      a.productName.localeCompare(b.productName, 'ru'),
  );
  return { summary, rows };
}
