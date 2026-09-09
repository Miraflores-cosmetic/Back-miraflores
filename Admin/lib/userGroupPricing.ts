import { adminBackendJson } from '@/lib/adminBackendFetch';
import type { AdminCategory } from '@/lib/adminCatalogTypes';
import type {
  AdminGroupVariantPriceListResponse,
  AdminUserGroup,
} from '@/lib/adminUserGroupTypes';

export type LeafCategoryOption = { id: string; label: string };

function categoryLabel(c: AdminCategory): string {
  if (c.parent?.name) return `${c.parent.name} → ${c.name}`;
  return c.name;
}

/** Leaf-категории для правил групповых цен (без подкатегорий). */
export async function fetchLeafCategories(): Promise<LeafCategoryOption[]> {
  const cats = await adminBackendJson<AdminCategory[]>('catalog/admin/categories');
  const parentIds = new Set(
    cats.map((c) => c.parentId).filter((id): id is string => Boolean(id)),
  );
  return cats
    .filter((c) => !parentIds.has(c.id))
    .map((c) => ({ id: c.id, label: categoryLabel(c) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}

export type UserGroupPricingSection = 'categories' | 'products';

export function parseUserGroupPricingSection(
  raw: string | null | undefined,
): UserGroupPricingSection {
  const s = raw?.trim();
  if (s === 'products' || s === 'categories') return s;
  return 'categories';
}

/** Округление как на витрине (group-price.util). */
export function applyGroupPriceRounding(
  value: number,
  rounding: AdminUserGroup['priceRounding'],
): number {
  if (!Number.isFinite(value)) return 0;
  switch (rounding) {
    case 'FLOOR':
      return Math.floor(value);
    case 'CEIL':
      return Math.ceil(value);
    default:
      return Math.round(value);
  }
}

export function computePercentOffPrice(
  basePrice: number,
  percentOff: number,
  rounding: AdminUserGroup['priceRounding'],
): number {
  const pct = Math.min(100, Math.max(0, percentOff));
  const next = (basePrice * (100 - pct)) / 100;
  return Math.max(0, applyGroupPriceRounding(next, rounding));
}

const VARIANT_PRICES_PAGE_SIZE = 100;

/** productId товаров, у которых в группе уже есть хотя бы одна SKU-цена. */
export async function fetchRuledProductIds(groupId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let page = 1;
  while (true) {
    const sp = new URLSearchParams({
      page: String(page),
      limit: String(VARIANT_PRICES_PAGE_SIZE),
    });
    const res = await adminBackendJson<AdminGroupVariantPriceListResponse>(
      `user-groups/admin/${groupId}/variant-prices?${sp}`,
    );
    for (const row of res.items) ids.add(row.productId);
    if (page * VARIANT_PRICES_PAGE_SIZE >= res.total) break;
    page++;
  }
  return ids;
}
