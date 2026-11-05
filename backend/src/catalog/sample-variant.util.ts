/**
 * Детекция пробника для purchase rules / PLP / PDP.
 *
 * Источник истины: `ProductVariant.isSample` в БД.
 * Fallback по имени — только legacy / строки заказа без флага; не «тестer»,
 * не «непробник» (подстрока «пробник» внутри слова).
 */

/** Отдельное слово «пробник» (кириллица/латиница-разделители). */
const SAMPLE_NAME_TOKEN =
  /(?:^|[^a-zа-яё0-9])пробник(?:$|[^a-zа-яё0-9])/i;

export function isSampleVariantName(name: string | null | undefined): boolean {
  const raw = (name ?? '').trim();
  if (!raw) return false;
  const n = raw.toLowerCase();
  if (n === 'пробник') return true;
  return SAMPLE_NAME_TOKEN.test(raw);
}

export type SampleVariantLike = {
  isSample?: boolean | null;
  name?: string | null;
};

/** Explicit `isSample` из БД; иначе эвристика по имени. */
export function isProductVariantSample(
  v: SampleVariantLike | null | undefined,
): boolean {
  if (!v) return false;
  if (v.isSample === true) return true;
  if (v.isSample === false) return false;
  return isSampleVariantName(v.name);
}

/** Запись варианта: явный dto или infer из имени. */
export function resolveVariantIsSampleFlag(
  name: string,
  explicit?: boolean | null,
): boolean {
  if (explicit === true || explicit === false) return explicit;
  return isSampleVariantName(name);
}
