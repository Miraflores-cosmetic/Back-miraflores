import { describe, expect, it } from 'vitest';
import { GroupCategoryPriceType } from '@prisma/client';
import { applyCategoryPriceRule, applyPriceRounding } from './group-price.util';

describe('group-price.util', () => {
  it('PERCENT_OFF', () => {
    expect(
      applyCategoryPriceRule(1000, GroupCategoryPriceType.PERCENT_OFF, 20, 'NEAREST'),
    ).toBe(800);
  });

  it('FIXED_OFF', () => {
    expect(
      applyCategoryPriceRule(1000, GroupCategoryPriceType.FIXED_OFF, 150, 'NEAREST'),
    ).toBe(850);
  });

  it('FIXED_PRICE', () => {
    expect(
      applyCategoryPriceRule(1000, GroupCategoryPriceType.FIXED_PRICE, 900, 'FLOOR'),
    ).toBe(900);
  });

  it('rounding FLOOR', () => {
    expect(applyPriceRounding(10.9, 'FLOOR')).toBe(10);
  });
});
