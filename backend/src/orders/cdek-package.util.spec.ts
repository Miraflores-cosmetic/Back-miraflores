import { describe, expect, it } from 'vitest';
import { buildCdekPackagesFromOrderItems } from './cdek-package.util';

describe('buildCdekPackagesFromOrderItems', () => {
  it('uses catalog weightGrams per line, not 300g default', () => {
    const variantById = new Map([
      [
        'v1',
        { weightGrams: 60, lengthMm: 40, widthMm: 40, heightMm: 110 },
      ],
      [
        'v2',
        { weightGrams: 80, lengthMm: 45, widthMm: 45, heightMm: 120 },
      ],
    ]);
    const pkgs = buildCdekPackagesFromOrderItems(
      [
        {
          title: 'A',
          sku: 'sku-a',
          qty: 2,
          unitPrice: 1000,
          variantId: 'v1',
        },
        {
          title: 'B',
          sku: 'sku-b',
          qty: 1,
          unitPrice: 2000,
          variantId: 'v2',
        },
      ],
      variantById,
    );
    expect(pkgs).toHaveLength(2);
    expect(pkgs[0].items[0].weight).toBe(60);
    expect(pkgs[0].weight).toBe(120);
    expect(pkgs[1].items[0].weight).toBe(80);
    expect(pkgs[0].length).toBeGreaterThan(0);
    expect(pkgs[0].width).toBeGreaterThan(0);
    expect(pkgs[0].height).toBeGreaterThan(0);
  });
});
