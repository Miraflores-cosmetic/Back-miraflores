/** Пробники и нулевые цены не должны задавать «цену от» в карточке / minPrice. */

export {
  isProductVariantSample,
  isSampleVariantName,
  resolveVariantIsSampleFlag,
  type SampleVariantLike,
} from './sample-variant.util';
import { isProductVariantSample } from './sample-variant.util';

export function isCatalogSellableVariant(v: {
  price: number;
  name?: string | null;
  isSample?: boolean | null;
}): boolean {
  return (
    Number.isFinite(v.price) && v.price > 0 && !isProductVariantSample(v)
  );
}

/** Цены для min/max на карточке и в поиске. */
export function catalogSellablePrices(
  variants: Array<{ price: number; name?: string | null; isSample?: boolean | null }>,
): number[] {
  return variants.filter(isCatalogSellableVariant).map((v) => v.price);
}

/**
 * Вариант для цены карточки: минимальная продаваемая цена
 * (без пробников и без price ≤ 0).
 */
export function pickCatalogCardVariant<
  T extends { price: number; name?: string | null },
>(variants: T[]): T | null {
  if (!variants.length) return null;
  const sellable = variants.filter(isCatalogSellableVariant);
  const pool = sellable.length ? sellable : variants.filter((v) => Number.isFinite(v.price) && v.price > 0);
  if (!pool.length) return variants[0] ?? null;
  const min = Math.min(...pool.map((v) => v.price));
  return pool.find((v) => v.price === min) ?? pool[0] ?? null;
}
