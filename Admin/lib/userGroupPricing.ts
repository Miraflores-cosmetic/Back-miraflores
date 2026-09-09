import type { AdminUserGroup } from '@/lib/adminUserGroupTypes';

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
