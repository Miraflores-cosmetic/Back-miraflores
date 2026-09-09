export {
  PRODUCT_ATTRIBUTE_KINDS,
  PRODUCT_ATTRIBUTE_KIND_LABELS,
  isProductAttributeKind,
  type ProductAttributeKind,
} from '@miraflores/admin-types';

export type ProductAttributeOptionApi = {
  id: string;
  kind: import('@miraflores/admin-types').ProductAttributeKind;
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
