import {
  GroupCategoryPriceType,
  type PriceRounding,
} from '@prisma/client';

export function applyPriceRounding(value: number, rounding: PriceRounding): number {
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

export function applyCategoryPriceRule(
  basePrice: number,
  type: GroupCategoryPriceType,
  value: number,
  rounding: PriceRounding,
): number {
  let next = basePrice;
  switch (type) {
    case GroupCategoryPriceType.PERCENT_OFF:
      next = basePrice * (100 - Math.min(100, Math.max(0, value))) / 100;
      break;
    case GroupCategoryPriceType.FIXED_OFF:
      next = basePrice - value;
      break;
    case GroupCategoryPriceType.FIXED_PRICE:
      next = value;
      break;
    default:
      next = basePrice;
  }
  return Math.max(0, applyPriceRounding(next, rounding));
}
