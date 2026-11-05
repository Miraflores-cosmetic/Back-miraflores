import { OrderStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  SAMPLE_PURCHASE_COUNTED_STATUSES,
  capMaxQtyForSampleVariant,
  findPurchasedSampleVariantIds,
  resolveSampleOrderMaxQty,
  samplePurchaseBlockReason,
} from './sample-purchase.util';

describe('capMaxQtyForSampleVariant', () => {
  it('caps sample to 1 even when orderMaxQty is null', () => {
    expect(resolveSampleOrderMaxQty('Пробник', null, 50)).toBe(1);
    expect(capMaxQtyForSampleVariant('пробник 5 мл', 99)).toBe(1);
  });

  it('leaves regular variants unchanged', () => {
    expect(resolveSampleOrderMaxQty('50 мл', null, 50)).toBe(50);
  });
});

describe('samplePurchaseBlockReason', () => {
  const purchased = new Set(['v-sold']);

  it('ignores non-sample variants', () => {
    expect(
      samplePurchaseBlockReason('u1', '50 мл', purchased, 'v1'),
    ).toBeNull();
  });

  it('blocks guests', () => {
    expect(
      samplePurchaseBlockReason(null, 'Пробник', purchased, 'v1'),
    ).toBe('guest');
  });

  it('blocks repeat purchase', () => {
    expect(
      samplePurchaseBlockReason('u1', 'пробник', purchased, 'v-sold'),
    ).toBe('already_purchased');
  });

  it('allows first sample for user', () => {
    expect(
      samplePurchaseBlockReason('u1', 'Пробник 5 мл', purchased, 'v-new'),
    ).toBeNull();
  });
});

describe('findPurchasedSampleVariantIds', () => {
  it('queries distinct variant ids for user orders', async () => {
    const findMany = vi.fn().mockResolvedValue([{ variantId: 'a' }]);
    const set = await findPurchasedSampleVariantIds(
      { orderItem: { findMany } } as never,
      'user-1',
      ['a', 'b'],
    );
    expect(set).toEqual(new Set(['a']));
    expect(findMany).toHaveBeenCalled();
    expect(findMany.mock.calls[0]![0].where.isGratitudeGift).toBe(false);
    const statuses = findMany.mock.calls[0]![0].where.order.status.in;
    expect(statuses).toEqual(SAMPLE_PURCHASE_COUNTED_STATUSES);
    expect(statuses).not.toContain(OrderStatus.AWAITING_PAYMENT);
    expect(statuses).not.toContain(OrderStatus.REFUNDED);
    expect(statuses).not.toContain(OrderStatus.CANCELLED);
  });
});
