import { describe, expect, it } from 'vitest';
import { DiscountRewardType, DiscountScope } from '@prisma/client';
import {
  applyCampaignToCards,
  applyCampaignToDetailVariants,
} from './catalog-campaign-price.util';
import type { CampaignIn } from '../discounts/discount-pricing.engine';

function pctCampaign(productId: string, value = 10): CampaignIn[] {
  return [
    {
      id: 'camp1',
      name: '−10%',
      startsAt: new Date('2026-01-01'),
      scope: DiscountScope.PRODUCTS,
      productIds: [productId],
      categoryIds: [],
      rules: [
        {
          id: 'r1',
          sortOrder: 0,
          conditions: null,
          rewardType: DiscountRewardType.PERCENT,
          rewardValue: value,
        },
      ],
    },
  ];
}

describe('applyCampaignToDetailVariants', () => {
  it('совпадает с карточкой: PERCENT по каждому варианту отдельно (не joint cart)', () => {
    const productId = 'p-avokado';
    const categoryId = 'cat-hair';
    const campaigns = pctCampaign(productId, 10);

    // 885 × 10%: engine = 885 − floor(88.5) = 797 (не floor(796.5)=796)
    const card = applyCampaignToCards(
      [
        {
          id: productId,
          categoryId,
          price: 885,
          oldPrice: null,
          discountPercent: null,
        },
      ],
      campaigns,
    )[0]!;

    const variants = applyCampaignToDetailVariants(
      [
        { id: 'v-20', price: 885, compareAt: null },
        { id: 'v-100', price: 3980, compareAt: null },
      ],
      productId,
      categoryId,
      campaigns,
    );

    expect(card.price).toBe(797);
    expect(variants[0]!.price).toBe(797);
    expect(variants[0]!.compareAt).toBe(885);
    // Раньше joint allocate давал 796 / 3583
    expect(variants[1]!.price).toBe(3980 - Math.floor((3980 * 10) / 100));
    expect(variants[1]!.price).toBe(3582);
  });
});
