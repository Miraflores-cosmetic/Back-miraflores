import { Prisma } from '@prisma/client';
import { isCatalogSellableVariant } from './catalog-price.util';

/** Prisma `where` для объёмов на PLP (без пробников / price ≤ 0). */
export const catalogSellableVariantWhere = {
  active: true,
  price: { gt: 0 },
  NOT: [
    { name: { equals: 'пробник', mode: 'insensitive' as const } },
    { name: { contains: 'пробник', mode: 'insensitive' as const } },
  ],
} satisfies Prisma.ProductVariantWhereInput;

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

/** PLP: sizeRow / модалка только при 2+ sellable объёмах. */
export function listCardVolumeOptions(
  variants: CatalogCardVariantSource[],
): CatalogCardVolumeOption[] | undefined {
  const options = toCardVolumeOptions(variants);
  return options.length > 1 ? options : undefined;
}
