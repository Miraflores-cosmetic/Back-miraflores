import { describe, expect, it } from 'vitest';
import {
  cartSyncLineKey,
  mergeCartSyncInputLines,
} from './catalog-cart-sync-merge.util';

describe('mergeCartSyncInputLines', () => {
  it('не схлопывает один variant с разными shadeId', () => {
    const out = mergeCartSyncInputLines([
      { variantId: 'v1', shadeId: 'sh1', qty: 1 },
      { variantId: 'v1', shadeId: 'sh2', qty: 2 },
      { variantId: 'v1', shadeId: 'sh1', qty: 3 },
    ]);
    expect(out).toEqual([
      { variantId: 'v1', shadeId: 'sh1', qty: 4 },
      { variantId: 'v1', shadeId: 'sh2', qty: 2 },
    ]);
  });

  it('отдельно держит линию без оттенка', () => {
    const out = mergeCartSyncInputLines([
      { variantId: 'v1', qty: 1 },
      { variantId: 'v1', shadeId: 'sh1', qty: 1 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((l) => l.shadeId === null)?.qty).toBe(1);
    expect(out.find((l) => l.shadeId === 'sh1')?.qty).toBe(1);
  });

  it('cartSyncLineKey различает shade', () => {
    expect(cartSyncLineKey('v1', 'a')).not.toBe(cartSyncLineKey('v1', 'b'));
    expect(cartSyncLineKey('v1', null)).not.toBe(cartSyncLineKey('v1', 'a'));
  });
});
