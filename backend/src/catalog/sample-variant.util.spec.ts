import { describe, expect, it } from 'vitest';
import {
  isProductVariantSample,
  isSampleVariantName,
} from './sample-variant.util';

describe('isSampleVariantName', () => {
  it('matches standalone пробник', () => {
    expect(isSampleVariantName('Пробник')).toBe(true);
    expect(isSampleVariantName('пробник 5 мл')).toBe(true);
    expect(isSampleVariantName('Набор + пробник')).toBe(true);
  });

  it('does not match neprobnik or tester', () => {
    expect(isSampleVariantName('Непробник')).toBe(false);
    expect(isSampleVariantName('непробник крема')).toBe(false);
    expect(isSampleVariantName('тестер')).toBe(false);
    expect(isSampleVariantName('Tester 5 ml')).toBe(false);
  });
});

describe('isProductVariantSample', () => {
  it('prefers isSample flag over name', () => {
    expect(
      isProductVariantSample({ isSample: true, name: '50 мл' }),
    ).toBe(true);
    expect(
      isProductVariantSample({ isSample: false, name: 'Пробник' }),
    ).toBe(false);
  });
});
