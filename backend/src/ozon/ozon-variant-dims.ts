import type { Prisma } from '@prisma/client';
import type { OzonTariffLine } from './ozon-tariff';

export const OZON_VARIANT_DIMS_SELECT = {
  id: true,
  weightGrams: true,
  lengthMm: true,
  widthMm: true,
  heightMm: true,
  volumeMl: true,
  packageVolume: true,
} satisfies Prisma.ProductVariantSelect;

type VariantReader = {
  productVariant: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: typeof OZON_VARIANT_DIMS_SELECT;
    }): Promise<
      Array<{
        id: string;
        weightGrams: number | null;
        lengthMm: number | null;
        widthMm: number | null;
        heightMm: number | null;
        volumeMl: number | null;
        packageVolume: number | null;
      }>
    >;
  };
};

/** Строки заказа/корзины → строки тарифа с весом и габаритами вариантов из каталога. */
export async function loadOzonTariffLines(
  db: VariantReader,
  lines: Array<{ variantId: string | null; qty: number }>,
): Promise<OzonTariffLine[]> {
  const ids = [...new Set(lines.map((l) => l.variantId).filter((id): id is string => Boolean(id)))];
  const variants = ids.length
    ? await db.productVariant.findMany({ where: { id: { in: ids } }, select: OZON_VARIANT_DIMS_SELECT })
    : [];
  const byId = new Map(variants.map((v) => [v.id, v]));
  return lines.map((l) => {
    const v = l.variantId ? byId.get(l.variantId) : undefined;
    return {
      qty: l.qty,
      weightGrams: v?.weightGrams,
      lengthMm: v?.lengthMm,
      widthMm: v?.widthMm,
      heightMm: v?.heightMm,
      volumeMl: v?.volumeMl,
      packageVolume: v?.packageVolume,
    };
  });
}
