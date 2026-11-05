import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { holdGiftCertificateForOrder } from '../gift-certificates/gift-certificate-hold.util';
import { createAdminOrder, previewAdminOrder } from './create-admin-order';
import type { AdminCreateOrderDto } from './dto/admin-create-order.dto';

vi.mock('../gift-certificates/gift-certificate-hold.util', () => ({
  holdGiftCertificateForOrder: vi.fn(async () => ({})),
}));

vi.mock('./order-stock', () => ({
  reserveStockForLines: vi.fn(async () => undefined),
}));

vi.mock('./order-number', () => ({
  allocateNextOrderNumber: vi.fn(async () => 'JCOS-9001'),
}));

vi.mock('../rls/rls-after-commit', () => ({
  scheduleAfterRlsCommitWithBypass: (_prisma: unknown, fn: () => void) => {
    void Promise.resolve(fn()).catch(() => undefined);
  },
}));

const baseDto = (): AdminCreateOrderDto => ({
  lines: [{ variantId: 'v1', qty: 1 }],
  email: 'buyer@example.com',
  phone: '+79991234567',
  customerName: 'Иван',
  shippingAddress: {
    city: 'Москва',
    address: 'Тверская 1',
    comment: '__JCOS:carrier=cdek|dropoff=courier|',
  },
  shippingMethod: 'CDEK',
  shippingCost: 350,
  payMode: 'awaiting',
  attachGratitude: false,
});

describe('createAdminOrder', () => {
  const syncCartLines = vi.fn();
  const applyForCheckoutPromo = vi.fn();
  const applyForCheckoutGift = vi.fn();
  const addEvent = vi.fn();
  const notifyAdminOrderCreated = vi.fn();
  const seedCustomerNoteFromOrder = vi.fn();
  const resolveGratitudeGiftLines = vi.fn(async () => []);

  let orderCreate: ReturnType<typeof vi.fn>;
  let affiliateCreate: ReturnType<typeof vi.fn>;
  let yourichTouch: ReturnType<typeof vi.fn>;
  let deps: Parameters<typeof createAdminOrder>[0];

  beforeEach(() => {
    vi.clearAllMocks();
    affiliateCreate = vi.fn();
    yourichTouch = vi.fn();
    orderCreate = vi.fn().mockResolvedValue({
      id: 'o-admin',
      number: 'JCOS-9001',
      status: 'AWAITING_PAYMENT',
      email: 'buyer@example.com',
      phone: '+79991234567',
      subtotal: 1000,
      discountTotal: 0,
      giftCertificateAmount: 0,
      total: 1350,
      promoCode: null,
      giftCertificateCode: null,
      items: [{ id: 'i1', variantId: 'v1', qty: 1, title: 'Товар', unitPrice: 1000 }],
    });

    syncCartLines.mockImplementation(
      async (
        lines: Array<{
          variantId: string;
          shadeId?: string | null;
          qty: number;
        }>,
      ) => ({
        items: (lines ?? []).map((l) => ({
          variantId: l.variantId,
          shadeId: l.shadeId ?? null,
          shadeName: l.shadeId ? 'Нюд' : null,
          name: 'Товар',
          variantName: '50 мл',
          sku: 'SKU-1',
          price: 1000,
          qty: l.qty,
          productId: 'p1',
          categoryId: 'c1',
        })),
        pricing: {
          groupId: null,
          groupName: null,
          context: 'guest',
          allowCatalogDiscounts: true,
          allowPromoCodes: true,
        },
      }),
    );

    const tx = {
      order: { create: orderCreate },
      promoCodeRedemption: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      orderAffiliateLead: { create: affiliateCreate },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };

    deps = {
      prisma: {
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1' }) },
        order: { findUnique: vi.fn().mockResolvedValue(null) },
        $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      } as never,
      catalogPublic: { syncCartLines } as never,
      promoPublic: { applyForCheckout: applyForCheckoutPromo } as never,
      giftsPublic: { applyForCheckout: applyForCheckoutGift } as never,
      lifecycle: { addEvent, notifyAdminOrderCreated } as never,
      orderChat: { seedCustomerNoteFromOrder } as never,
      resolveGratitudeGiftLines,
      yourichSync: { touch: yourichTouch } as never,
      yourichClient: { fallbackOfferId: () => 'offer-1' } as never,
      logger: { log: vi.fn(), warn: vi.fn() } as never,
    };
  });

  it('rejects empty cart after sync', async () => {
    syncCartLines.mockResolvedValueOnce({
      items: [],
      pricing: { allowPromoCodes: true },
    });
    await expect(
      createAdminOrder(deps, baseDto(), { actorUserId: 'staff1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects promo + gift XOR', async () => {
    await expect(
      createAdminOrder(
        deps,
        {
          ...baseDto(),
          promoCode: 'SALE10',
          giftCertificateCode: 'GIFT',
        },
        { actorUserId: 'staff1' },
      ),
    ).rejects.toThrow(/промокод и сертификат/i);
  });

  it('rejects missing shipping for physical cart', async () => {
    await expect(
      createAdminOrder(
        deps,
        {
          ...baseDto(),
          shippingMethod: undefined,
          shippingCost: undefined,
        },
        { actorUserId: 'staff1' },
      ),
    ).rejects.toThrow(/способ доставки/i);
  });

  it('сохраняет shadeId из sync в позиции заказа', async () => {
    await createAdminOrder(
      deps,
      {
        ...baseDto(),
        lines: [{ variantId: 'v1', shadeId: 'sh1', qty: 1 }],
      },
      { actorUserId: 'staff1' },
    );
    expect(syncCartLines).toHaveBeenCalledWith(
      [expect.objectContaining({ variantId: 'v1', shadeId: 'sh1', qty: 1 })],
      null,
      { bypassSamplePurchaseRules: true },
    );
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.items.create[0].shadeId).toBe('sh1');
  });

  it('previewAllowMissingShipping: скидка без доставки', async () => {
    applyForCheckoutPromo.mockResolvedValueOnce({
      promoCodeId: 'pc1',
      code: 'SALE10',
      codeRaw: 'SALE10',
      discountAmount: 100,
      affiliate: false,
    });
    const preview = await previewAdminOrder(deps, {
      ...baseDto(),
      shippingMethod: undefined,
      shippingCost: undefined,
      shippingAddress: undefined,
      promoCode: 'SALE10',
      previewAllowMissingShipping: true,
    });
    expect(preview.promoCode).toBe('SALE10');
    expect(preview.discountTotal).toBe(100);
    expect(preview.shippingCost).toBe(0);
    expect(preview.total).toBe(900);
  });

  it('creates order with unitPrice override and admin CREATED event', async () => {
    const result = await createAdminOrder(
      deps,
      {
        ...baseDto(),
        lines: [{ variantId: 'v1', qty: 2, unitPrice: 800 }],
      },
      { actorUserId: 'staff1' },
    );

    expect(result.id).toBe('o-admin');
    expect(orderCreate).toHaveBeenCalled();
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.subtotal).toBe(1600);
    expect(data.shippingCost).toBe(350);
    expect(data.items.create[0].unitPrice).toBe(800);
    expect(data.items.create[0].qty).toBe(2);
    expect(addEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'CREATED',
        actorUserId: 'staff1',
        meta: expect.objectContaining({
          source: 'admin',
          unitPriceOverrides: [
            expect.objectContaining({
              variantId: 'v1',
              catalogPrice: 1000,
              unitPrice: 800,
              qty: 2,
            }),
          ],
        }),
      }),
    );
  });

  it('idempotencyKey: повтор возвращает существующий заказ без create', async () => {
    (deps.prisma.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'o-existing',
      number: 'JCOS-1',
      status: 'AWAITING_PAYMENT',
      email: 'buyer@example.com',
      phone: '+79991234567',
      subtotal: 1000,
      discountTotal: 0,
      giftCertificateAmount: 0,
      total: 1350,
      promoCode: null,
      giftCertificateCode: null,
    });
    const res = await createAdminOrder(
      deps,
      { ...baseDto(), idempotencyKey: 'wizard-key-abc' },
      { actorUserId: 'staff1' },
    );
    expect(res.id).toBe('o-existing');
    expect(orderCreate).not.toHaveBeenCalled();
    expect(syncCartLines).not.toHaveBeenCalled();
  });

  it('applies promo path shape', async () => {
    applyForCheckoutPromo.mockResolvedValueOnce({
      promoCodeId: 'pc1',
      code: 'SALE10',
      codeRaw: 'SALE10',
      discountAmount: 100,
      affiliate: false,
    });
    deps.prisma.$transaction = vi.fn(async (fn: (t: unknown) => unknown) => {
      const tx = {
        order: { create: orderCreate },
        promoCodeRedemption: {
          count: vi.fn().mockResolvedValue(0),
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
        },
        orderAffiliateLead: { create: affiliateCreate },
        $queryRaw: vi.fn().mockResolvedValue([
          { id: 'pc1', active: true, maxUses: null, oneShot: false },
        ]),
      };
      return fn(tx);
    }) as never;

    await createAdminOrder(
      deps,
      { ...baseDto(), promoCode: 'SALE10' },
      { actorUserId: 'staff1' },
    );

    expect(applyForCheckoutPromo).toHaveBeenCalled();
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.promoCode).toBe('SALE10');
    expect(data.discountTotal).toBe(100);
  });

  it('holdGiftCertificateForOrder после create', async () => {
    applyForCheckoutGift.mockResolvedValueOnce({
      certificateId: 'gc1',
      code: 'GIFT100',
      applyAmount: 200,
    });
    await createAdminOrder(
      deps,
      { ...baseDto(), giftCertificateCode: 'GIFT100' },
      { actorUserId: 'staff1' },
    );
    expect(holdGiftCertificateForOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        certificateId: 'gc1',
        orderId: 'o-admin',
        applyAmount: 200,
      }),
    );
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.giftCertificateCode).toBe('GIFT100');
    expect(data.giftCertificateAmount).toBe(200);
  });

  it('gratitude gifts попадают в items.create', async () => {
    resolveGratitudeGiftLines.mockResolvedValueOnce([
      {
        variantId: 'gv1',
        shadeId: null,
        shadeName: null,
        name: 'Подарок',
        variantName: '1 шт',
        sku: 'GRAT-1',
        price: 0,
        qty: 1,
        isGratitudeGift: true,
      },
    ]);
    await createAdminOrder(
      deps,
      { ...baseDto(), attachGratitude: true },
      { actorUserId: 'staff1' },
    );
    expect(resolveGratitudeGiftLines).toHaveBeenCalled();
    const items = orderCreate.mock.calls[0][0].data.items.create as Array<{
      variantId: string | null;
      isGratitudeGift: boolean;
      unitPrice: number;
    }>;
    expect(items.some((i) => i.isGratitudeGift && i.variantId === 'gv1')).toBe(
      true,
    );
    expect(addEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({ attachGratitude: true }),
      }),
    );
  });

  it('Yourich: affiliate lead + touch при refHash', async () => {
    await createAdminOrder(
      deps,
      {
        ...baseDto(),
        affiliate: { refHash: 'rh-abc', extUserId: 'ext-1' },
      },
      { actorUserId: 'staff1' },
    );
    expect(affiliateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'o-admin',
          refHash: 'rh-abc',
          extUserId: 'ext-1',
          state: 'PENDING',
        }),
      }),
    );
    expect(yourichTouch).toHaveBeenCalledWith('o-admin');
    expect(addEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({ wantYourich: true }),
      }),
    );
  });

  it('gift-only: без shippingMethod / hold не нужен, Yourich off', async () => {
    syncCartLines.mockResolvedValueOnce({
      items: [
        {
          variantId: 'gift-denom:d1',
          shadeId: null,
          shadeName: null,
          name: 'Сертификат',
          variantName: '3000',
          sku: 'GIFT_CERTIFICATE:d1',
          price: 3000,
          qty: 1,
          productId: 'd1',
          categoryId: '',
          isGiftDenom: true,
        },
      ],
      pricing: {
        groupId: null,
        groupName: null,
        context: 'guest',
        allowCatalogDiscounts: true,
        allowPromoCodes: true,
      },
    });
    await createAdminOrder(
      deps,
      {
        ...baseDto(),
        lines: [{ variantId: 'gift-denom:d1', qty: 1 }],
        shippingMethod: undefined,
        shippingCost: undefined,
        shippingAddress: undefined,
        affiliate: { refHash: 'should-ignore', extUserId: null },
        attachGratitude: true,
      },
      { actorUserId: 'staff1' },
    );
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.shippingMethod).toBeNull();
    expect(data.shippingCost).toBe(0);
    expect(data.shippingAddress.comment).toBe('digital-gift');
    expect(resolveGratitudeGiftLines).not.toHaveBeenCalled();
    expect(affiliateCreate).not.toHaveBeenCalled();
    expect(yourichTouch).not.toHaveBeenCalled();
  });
});
