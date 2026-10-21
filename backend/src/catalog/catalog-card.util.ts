import { isCatalogSellableVariant } from './catalog-price.util';

/** Минимальный вариант для объёмов на карточке (каталог / избранное). */
export type CatalogCardVariantSource = {
  id: string;
  name: string;
  price: number;
  compareAt: number | null;
  orderMinQty: number;
  orderMaxQty: number | null;
  stock: number;
  stockReserve: number;
};

export type CatalogCardVolumeOption = {
  id: string;
  name: string;
  price: number;
  oldPrice: number | null;
  available: number;
  minQty: number;
  maxQty: number;
};

export function cardVariantQty(v: CatalogCardVariantSource) {
  const available = Math.max(0, v.stock - v.stockReserve);
  const minQty = Math.max(1, v.orderMinQty ?? 1);
  let maxQty =
    v.orderMaxQty != null ? Math.min(v.orderMaxQty, available) : available;
  if (maxQty > 0 && minQty > maxQty) maxQty = 0;
  return { available, minQty, maxQty };
}

/** Объёмы на карточке: без пробников; цена > 0. */
export function toCardVolumeOptions(
  variants: CatalogCardVariantSource[],
): CatalogCardVolumeOption[] {
  return variants.filter(isCatalogSellableVariant).map((v) => {
    const { available, minQty, maxQty } = cardVariantQty(v);
    const compareAt = v.compareAt;
    return {
      id: v.id,
      name: v.name,
      price: v.price,
      oldPrice: compareAt != null && compareAt > v.price ? compareAt : null,
      available,
      minQty,
      maxQty,
    };
  });
}
