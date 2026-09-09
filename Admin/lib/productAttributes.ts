/** Виды атрибутов товара — совпадают с Prisma ProductAttributeKind. */
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

export type ProductAttributeOptionApi = {
  id: string;
  kind: ProductAttributeKind;
  label: string;
  sortOrder: number;
  active: boolean;
  usageCount?: number;
};

/** Срезает HTML из старых rich-значений «Хранение» → plain label для select. */
export function plainProductAttrValue(raw: string | null | undefined): string {
  if (!raw) return '';
  const t = raw.trim();
  if (!t.includes('<')) return t;
  return t
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
