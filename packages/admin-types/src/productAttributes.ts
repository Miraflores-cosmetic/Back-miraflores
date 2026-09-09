/**
 * Product attribute option kinds.
 * Must stay in sync with Prisma `enum ProductAttributeKind` (backend/prisma/schema.prisma).
 */
export const PRODUCT_ATTRIBUTE_KINDS = [
  'productType',
  'purpose',
  'shelfLife',
  'storage',
] as const;

export type ProductAttributeKind = (typeof PRODUCT_ATTRIBUTE_KINDS)[number];

export const PRODUCT_ATTRIBUTE_KIND_LABELS: Record<ProductAttributeKind, string> = {
  productType: 'Тип продукта',
  purpose: 'Для чего',
  shelfLife: 'Срок годности',
  storage: 'Хранение',
};

export function isProductAttributeKind(v: unknown): v is ProductAttributeKind {
  return (
    typeof v === 'string' &&
    (PRODUCT_ATTRIBUTE_KINDS as readonly string[]).includes(v)
  );
}
