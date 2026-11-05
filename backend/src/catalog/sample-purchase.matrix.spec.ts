import { SamplePurchaseRejectedException } from './sample-purchase.errors';
import { OrderStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogPublicService } from './catalog.public.service';
import {
  SAMPLE_PURCHASE_COUNTED_STATUSES,
  assertSampleOrderLinesAllowedInTx,
  findPurchasedSampleVariantIds,
} from './sample-purchase.util';

describe('findPurchasedSampleVariantIds matrix', () => {
  it('counts only paid/fulfilled statuses, not AWAITING_PAYMENT', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await findPurchasedSampleVariantIds(
      { orderItem: { findMany } } as never,
      'user-1',
      ['v-sample'],
    );
    const itemWhere = findMany.mock.calls[0]![0].where;
    expect(itemWhere.isGratitudeGift).toBe(false);
    expect(itemWhere.order.status.in).toEqual(SAMPLE_PURCHASE_COUNTED_STATUSES);
    expect(itemWhere.order.status.in).not.toContain(OrderStatus.AWAITING_PAYMENT);
    expect(itemWhere.order.status.in).not.toContain(OrderStatus.NEW);
  });

  it('excludes current order id when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await findPurchasedSampleVariantIds(
      { orderItem: { findMany } } as never,
      'user-1',
      ['v-sample'],
      { excludeOrderId: 'order-retry' },
    );
    expect(findMany.mock.calls[0]![0].where.order.id).toEqual({
      not: 'order-retry',
    });
  });
});

describe('assertSampleOrderLinesAllowedInTx matrix', () => {
  const productVariant = {
    findMany: vi.fn().mockResolvedValue([] as Array<{ id: string; name: string; isSample: boolean }>),
  };
  const txBase = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    orderItem: { findMany: vi.fn().mockResolvedValue([]) },
    productVariant,
  };

  beforeEach(() => {
    txBase.orderItem.findMany.mockReset();
    txBase.orderItem.findMany.mockResolvedValue([]);
    productVariant.findMany.mockReset();
    productVariant.findMany.mockImplementation(async (args: { where: { id: { in: string[] } } }) => {
      const ids = args.where.id.in;
      return ids.map((id) => {
        if (id === 'v1' || id === 'v-new') {
          return { id, name: 'Пробник', isSample: true };
        }
        if (id === 'v-renamed-sample') {
          return { id, name: '50 мл', isSample: true };
        }
        return { id, name: '50 мл', isSample: false };
      });
    });
  });

  it('guest + sample → BadRequest', async () => {
    await expect(
      assertSampleOrderLinesAllowedInTx(txBase as never, null, [
        { variantId: 'v1', variantName: 'Пробник 5 мл', qty: 1 },
      ]),
    ).rejects.toBeInstanceOf(SamplePurchaseRejectedException);
  });

  it('auth + qty 2 → BadRequest', async () => {
    await expect(
      assertSampleOrderLinesAllowedInTx(txBase as never, 'u1', [
        { variantId: 'v1', variantName: 'Пробник', qty: 2 },
      ]),
    ).rejects.toBeInstanceOf(SamplePurchaseRejectedException);
  });

  it('auth + repeat (paid history) → BadRequest', async () => {
    txBase.orderItem.findMany.mockResolvedValue([{ variantId: 'v1' }]);
    await expect(
      assertSampleOrderLinesAllowedInTx(txBase as never, 'u1', [
        { variantId: 'v1', variantName: 'пробник', qty: 1 },
      ]),
    ).rejects.toBeInstanceOf(SamplePurchaseRejectedException);
  });

  it('auth + first sample → ok', async () => {
    await expect(
      assertSampleOrderLinesAllowedInTx(txBase as never, 'u1', [
        { variantId: 'v-new', variantName: 'Пробник', qty: 1 },
      ]),
    ).resolves.toBeUndefined();
  });

  it('non-sample lines ignored', async () => {
    await expect(
      assertSampleOrderLinesAllowedInTx(txBase as never, null, [
        { variantId: 'v-regular', variantName: '50 мл', qty: 3 },
      ]),
    ).resolves.toBeUndefined();
  });

  it('gratitude sample ignored (guest would otherwise fail)', async () => {
    await expect(
      assertSampleOrderLinesAllowedInTx(txBase as never, null, [
        {
          variantId: 'v-gift',
          variantName: 'Пробник',
          qty: 1,
          isGratitudeGift: true,
        },
      ]),
    ).resolves.toBeUndefined();
    expect(txBase.orderItem.findMany).not.toHaveBeenCalled();
  });

  it('uses DB isSample when snapshot name is not probnik', async () => {
    await expect(
      assertSampleOrderLinesAllowedInTx(txBase as never, null, [
        { variantId: 'v-renamed-sample', variantName: '50 мл', qty: 1 },
      ]),
    ).rejects.toBeInstanceOf(SamplePurchaseRejectedException);
  });

  it('gratitude sample ignored even if variant in purchase history', async () => {
    txBase.orderItem.findMany.mockResolvedValue([{ variantId: 'v-gift' }]);
    await expect(
      assertSampleOrderLinesAllowedInTx(txBase as never, 'u1', [
        {
          variantId: 'v-gift',
          variantName: 'пробник',
          qty: 1,
          isGratitudeGift: true,
        },
        { variantId: 'v-regular', variantName: '50 мл', qty: 1 },
      ]),
    ).resolves.toBeUndefined();
    expect(txBase.orderItem.findMany).not.toHaveBeenCalled();
  });
});

function makeSampleSyncService() {
  const commerceCtx = {
    groupId: null,
    groupName: null,
    kind: 'guest' as const,
    allowCatalogDiscounts: false,
    allowPromoCodes: false,
  };
  const variantRow = {
    id: 'v-sample',
    name: 'Пробник 5 мл',
    isSample: true,
    sku: 'SKU-S',
    price: 100,
    compareAt: null,
    orderMinQty: 1,
    orderMaxQty: null,
    stock: 10,
    stockReserve: 0,
    product: {
      id: 'p1',
      categoryId: 'c1',
      slug: 'prod',
      name: 'Крем',
      productType: null,
      images: [],
    },
    galleryLinks: [],
  };

  const prisma = {
    giftCertificateDenomination: { findMany: vi.fn().mockResolvedValue([]) },
    productVariant: {
      findMany: vi.fn().mockResolvedValue([variantRow]),
    },
    productVariantShade: { findMany: vi.fn().mockResolvedValue([]) },
    cartSettings: {
      findUnique: vi.fn().mockResolvedValue({
        sampleRulesArticleSlug: null,
        sampleVariantNoticeHtml: null,
      }),
    },
    blogPost: {
      findUnique: vi.fn().mockResolvedValue({ isPublished: true }),
    },
    orderItem: { findMany: vi.fn().mockResolvedValue([]) },
  };

  const commerceContext = {
    resolveFromUserId: vi.fn().mockResolvedValue(commerceCtx),
  };
  const groupPricing = {
    resolveVariantPrices: vi.fn().mockResolvedValue(
      new Map([
        [
          'v-sample',
          { basePrice: 100, groupPrice: 100 },
        ],
      ]),
    ),
  };
  const visibility = {
    isTargetVisible: vi.fn().mockResolvedValue(true),
  };
  const discounts = {
    priceLines: vi.fn(),
  };

  const svc = new CatalogPublicService(
    prisma as never,
    discounts as never,
    commerceContext as never,
    groupPricing as never,
    visibility as never,
  );

  return { svc, prisma, commerceContext, commerceCtx, variantRow };
}

describe('CatalogPublicService sample sync / eligibility matrix', () => {
  it('sync: guest sample removed as sample_guest', async () => {
    const { svc } = makeSampleSyncService();
    const out = await svc.syncCartLines(
      [{ variantId: 'v-sample', qty: 1 }],
      undefined,
    );
    expect(out.removedLines).toEqual([
      expect.objectContaining({ reason: 'sample_guest' }),
    ]);
    expect(out.items).toHaveLength(0);
  });

  it('sync: auth first sample kept, qty capped to 1', async () => {
    const { svc, commerceContext, commerceCtx } = makeSampleSyncService();
    commerceContext.resolveFromUserId.mockResolvedValue({
      ...commerceCtx,
      kind: 'user',
    });
    const out = await svc.syncCartLines(
      [{ variantId: 'v-sample', qty: 5 }],
      'user-1',
    );
    expect(out.removedLines).toHaveLength(0);
    expect(out.items[0]?.qty).toBe(1);
    expect(out.items[0]?.maxQty).toBe(1);
  });

  it('sync: auth repeat removed as sample_already_purchased', async () => {
    const { svc, commerceContext, commerceCtx, prisma } = makeSampleSyncService();
    commerceContext.resolveFromUserId.mockResolvedValue({
      ...commerceCtx,
      kind: 'user',
    });
    prisma.orderItem.findMany.mockResolvedValue([{ variantId: 'v-sample' }]);
    const out = await svc.syncCartLines(
      [{ variantId: 'v-sample', qty: 1 }],
      'user-1',
    );
    expect(out.removedLines).toEqual([
      expect.objectContaining({ reason: 'sample_already_purchased' }),
    ]);
  });

  it('sync: gift denom passes sample rules (not a catalog sample)', async () => {
    const { svc, prisma } = makeSampleSyncService();
    prisma.productVariant.findMany.mockResolvedValue([]);
    prisma.giftCertificateDenomination.findMany.mockResolvedValue([
      {
        id: 'denom-1',
        name: '5000',
        faceValue: 5000,
        validityDays: 365,
        images: [],
      },
    ]);
    const giftKey = 'gift-denom:denom-1'; // GIFT_DENOM_CART_PREFIX
    const out = await svc.syncCartLines(
      [{ variantId: giftKey, qty: 1 }],
      undefined,
    );
    expect(out.removedLines).toHaveLength(0);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.isGiftDenom).toBe(true);
  });

  it('eligibility: guest sample ineligible', async () => {
    const { svc } = makeSampleSyncService();
    const out = await svc.resolveSampleEligibility(['v-sample'], undefined);
    expect(out.variants['v-sample']).toEqual({
      isSample: true,
      eligible: false,
      reason: 'guest',
    });
  });

  it('eligibility: unknown variant id is not eligible', async () => {
    const { svc } = makeSampleSyncService();
    const out = await svc.resolveSampleEligibility(['missing-id'], 'user-1');
    expect(out.variants['missing-id']).toEqual({
      isSample: false,
      eligible: false,
      reason: 'unknown_variant',
    });
  });

  it('eligibility: auth eligible when no paid history', async () => {
    const { svc } = makeSampleSyncService();
    const out = await svc.resolveSampleEligibility(['v-sample'], 'user-1');
    expect(out.variants['v-sample']).toEqual({
      isSample: true,
      eligible: true,
    });
  });
});
