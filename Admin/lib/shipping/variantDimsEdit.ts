/** Границы совпадают с backend/src/ozon/ozon-package.ts (WEIGHT_*_G, SIDE_*_MM). */
export const DIMS_WEIGHT_MIN_G = 5;
export const DIMS_WEIGHT_MAX_G = 30_000;
export const DIMS_SIDE_MIN_MM = 5;
export const DIMS_SIDE_MAX_MM = 1_500;

export type VariantDimsValues = {
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
};

export type VariantDimsSuggestionValues = VariantDimsValues;

export type VariantDimsDraft = {
  weight: string;
  length: string;
  width: string;
  height: string;
};

export type VariantDimsPatch = Partial<Record<keyof VariantDimsValues, number>>;

const str = (n: number | null | undefined) => (n == null ? "" : String(n));

/** Черновик правки: предложение для ошибочных полей, иначе текущее значение. */
export function initialDimsDraft(
  current: VariantDimsValues,
  suggestion: VariantDimsSuggestionValues | null,
): VariantDimsDraft {
  const useSize = suggestion?.lengthMm != null;
  return {
    weight: str(suggestion?.weightGrams ?? current.weightGrams),
    length: str(useSize ? suggestion!.lengthMm : current.lengthMm),
    width: str(useSize ? suggestion!.widthMm : current.widthMm),
    height: str(useSize ? suggestion!.heightMm : current.heightMm),
  };
}

function parseInt10(raw: string): number | null | "bad" {
  const t = raw.trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? Number(t) : "bad";
}

/** PATCH только с изменёнными полями; стороны — тройкой. */
export function buildDimsPatch(
  current: VariantDimsValues,
  draft: VariantDimsDraft,
): { patch: VariantDimsPatch } | { error: string } {
  const weight = parseInt10(draft.weight);
  const sides = [
    parseInt10(draft.length),
    parseInt10(draft.width),
    parseInt10(draft.height),
  ];
  if (weight === "bad" || sides.includes("bad"))
    return { error: "Только целые числа" };

  const patch: VariantDimsPatch = {};
  if (weight != null) {
    if (weight < DIMS_WEIGHT_MIN_G || weight > DIMS_WEIGHT_MAX_G) {
      return { error: `Вес: ${DIMS_WEIGHT_MIN_G}–${DIMS_WEIGHT_MAX_G} г` };
    }
    if (weight !== current.weightGrams) patch.weightGrams = weight;
  }

  const filled = sides.filter((s) => s != null) as number[];
  if (filled.length && filled.length < 3)
    return { error: "Укажите все три габарита" };
  if (filled.length === 3) {
    if (filled.some((s) => s < DIMS_SIDE_MIN_MM || s > DIMS_SIDE_MAX_MM)) {
      return { error: `Габариты: ${DIMS_SIDE_MIN_MM}–${DIMS_SIDE_MAX_MM} мм` };
    }
    const [lengthMm, widthMm, heightMm] = filled;
    if (
      lengthMm !== current.lengthMm ||
      widthMm !== current.widthMm ||
      heightMm !== current.heightMm
    ) {
      Object.assign(patch, { lengthMm, widthMm, heightMm });
    }
  }

  if (!Object.keys(patch).length) return { error: "Значения не изменились" };
  return { patch };
}
