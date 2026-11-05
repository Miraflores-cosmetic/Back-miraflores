import { BadRequestException } from '@nestjs/common';
import { ShipmentProvider } from '@prisma/client';
import type { CatalogPublicService } from '../catalog/catalog.public.service';
import type { PromoPublicService } from '../promo/promo.service';
import type { GiftCertificatesPublicService } from '../gift-certificates/gift-certificates.public.service';
import {
  assertGiftDenomCartNotMixedWithPhysical,
  parseGiftDenomCartVariantId,
} from '../gift-certificates/gift-certificate-purchase.util';
import { formatPhoneE164, isValidPhone } from '../common/phone.util';
import {
  assertCdekPvzCodePresent,
  assertShippingCommentMatchesCarrier,
  requireCheckoutShipmentProvider,
  resolvePvzCode,
} from './order-shipping.resolve';
import { shouldSyncOrderToYourich } from '../yourich/yourich-lead';
import type { AdminCreateOrderDto } from './dto/admin-create-order.dto';
import { throwIfSampleCartBlocked } from '../catalog/sample-purchase.errors';
import type { PrismaService } from '../prisma/prisma.service';

export type AdminSyncedCartItem = {
  variantId: string;
  shadeId: string | null;
  shadeName: string | null;
  name: string;
  variantName: string;
  isSample?: boolean;
  sku: string;
  price: number;
  qty: number;
  baseUnitPrice?: number;
  groupUnitPrice?: number;
  isGratitudeGift?: boolean;
  productId?: string;
  categoryId?: string;
  isGiftDenom?: boolean;
  /** Каталожная цена до override (для meta / UI). */
  catalogPrice?: number;
};

export type AdminPriceOverride = {
  variantId: string;
  catalogPrice: number;
  unitPrice: number;
  qty: number;
};

export type AdminCreateQuote = {
  email: string;
  phone: string;
  customerName: string;
  userId: string | null;
  guestId: string;
  items: AdminSyncedCartItem[];
  giftOnly: boolean;
  subtotal: number;
  discountTotal: number;
  promoCode: string | null;
  promoApply: Awaited<ReturnType<PromoPublicService['applyForCheckout']>> | null;
  giftApply: Awaited<
    ReturnType<GiftCertificatesPublicService['applyForCheckout']>
  > | null;
  giftCertificateAmount: number;
  giftCertificateCode: string | null;
  shippingCost: number;
  shippingMethod: ShipmentProvider | null;
  createComment: string;
  createPvzCode: string | null;
  city: string;
  address: string;
  payableAfterPromo: number;
  total: number;
  gratitudeGifts: AdminSyncedCartItem[];
  priceOverrides: AdminPriceOverride[];
  wantYourich: boolean;
  refHash: string | null;
  extUserId: string | null;
  syncedPricing: {
    groupId: string | null;
    groupName: string | null;
    context: string | null;
  };
};

export type AdminCreateQuoteDeps = {
  prisma: PrismaService;
  catalogPublic: CatalogPublicService;
  promoPublic: PromoPublicService;
  giftsPublic: GiftCertificatesPublicService;
  resolveGratitudeGiftLines: (
    goodsAfterPromo: number,
  ) => Promise<AdminSyncedCartItem[]>;
};

/**
 * Тот же расчёт, что create (sync + unitPrice override + applyForCheckout + gift + shipping).
 * Preview и create делят этот путь — без расхождения public /promo/validate.
 */
export async function computeAdminCreateQuote(
  deps: AdminCreateQuoteDeps,
  dto: AdminCreateOrderDto,
  opts: { guestId: string; allowMissingShipping?: boolean },
): Promise<AdminCreateQuote> {
  const email = dto.email.trim().toLowerCase();
  if (!email) throw new BadRequestException('Укажите email и телефон');
  if (!isValidPhone(dto.phone)) {
    throw new BadRequestException('Некорректный телефон');
  }
  const phone = formatPhoneE164(dto.phone);

  const customerName = dto.customerName.trim();
  if (!customerName) throw new BadRequestException('Укажите имя');

  const userId = dto.userId?.trim() || null;
  if (userId) {
    const user = await deps.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new BadRequestException('Пользователь не найден');
  }

  const guestId = opts.guestId;

  const synced = await deps.catalogPublic.syncCartLines(
    (dto.lines ?? []).map((l) => ({
      variantId: l.variantId,
      shadeId: l.shadeId,
      qty: l.qty,
    })),
    userId,
    { bypassSamplePurchaseRules: true },
  );

  const overrideKey = (variantId: string, shadeId: string | null | undefined) =>
    `${variantId.trim()}\0${shadeId?.trim() || ''}`;
  const overrideByLine = new Map<string, number>();
  for (const line of dto.lines ?? []) {
    if (line.unitPrice == null || !Number.isFinite(line.unitPrice)) continue;
    overrideByLine.set(
      overrideKey(line.variantId, line.shadeId),
      Math.max(0, Math.floor(line.unitPrice)),
    );
  }

  const priceOverrides: AdminPriceOverride[] = [];
  const items = (synced.items as AdminSyncedCartItem[]).map((l) => {
    const catalogPrice = l.price;
    const o = overrideByLine.get(overrideKey(l.variantId, l.shadeId));
    if (o == null || o === catalogPrice) {
      return { ...l, catalogPrice };
    }
    priceOverrides.push({
      variantId: l.variantId,
      catalogPrice,
      unitPrice: o,
      qty: l.qty,
    });
    return { ...l, price: o, catalogPrice };
  });

  if (!items.length) {
    throwIfSampleCartBlocked(synced.removedLines);
    throw new BadRequestException('Корзина пуста или позиции недоступны');
  }

  const { giftOnly } = assertGiftDenomCartNotMixedWithPhysical(items);

  const city = dto.shippingAddress?.city?.trim() || '';
  const address = dto.shippingAddress?.address?.trim() || '';
  const allowMissingShipping = Boolean(opts.allowMissingShipping);
  if (!giftOnly && !allowMissingShipping && (!city || !address)) {
    throw new BadRequestException('Укажите город и адрес доставки');
  }

  const subtotal = items.reduce((sum, l) => sum + l.price * l.qty, 0);

  let discountTotal = 0;
  let promoCode: string | null = null;
  let promoApply: Awaited<ReturnType<PromoPublicService['applyForCheckout']>> | null =
    null;
  let giftApply: Awaited<
    ReturnType<GiftCertificatesPublicService['applyForCheckout']>
  > | null = null;

  const promoRaw = dto.promoCode?.trim();
  const giftRaw = dto.giftCertificateCode?.trim();
  if (promoRaw && giftRaw) {
    throw new BadRequestException(
      'Нельзя применить промокод и сертификат одновременно',
    );
  }

  if (promoRaw) {
    if (synced.pricing && !synced.pricing.allowPromoCodes) {
      throw new BadRequestException('Промокод недоступен для этой группы');
    }
    const scopeLines = items
      .filter((l) => !l.isGiftDenom && !parseGiftDenomCartVariantId(l.variantId))
      .map((l) => ({
        productId: l.productId ?? '',
        categoryId: l.categoryId ?? '',
        amount: Math.max(0, Math.floor(l.price * l.qty)),
      }))
      .filter((l) => l.productId && l.categoryId);
    promoApply = await deps.promoPublic.applyForCheckout(
      promoRaw,
      subtotal,
      {
        email,
        phone,
        userId,
        guestId,
      },
      scopeLines,
    );
    discountTotal = promoApply.discountAmount;
    promoCode = promoApply.code;
  }

  const refHash = dto.affiliate?.refHash?.trim() || null;
  const extUserId = dto.affiliate?.extUserId?.trim() || null;
  const wantYourich =
    !giftOnly &&
    shouldSyncOrderToYourich({
      giftPurchaseDenominationId: null,
      refHash,
      affiliatePromo: Boolean(promoApply?.affiliate),
    });

  const payableAfterPromo = Math.max(0, subtotal - discountTotal);

  let shippingCost = 0;
  let shippingMethod: ShipmentProvider | null = null;
  let createComment = '';
  let createPvzCode: string | null = null;

  if (!giftOnly) {
    if (!dto.shippingMethod?.trim()) {
      if (!allowMissingShipping) {
        throw new BadRequestException('Укажите способ доставки');
      }
      shippingCost = Math.max(0, Math.floor(dto.shippingCost ?? 0));
    } else {
      const carrier = requireCheckoutShipmentProvider(dto.shippingMethod);
      shippingMethod = carrier as ShipmentProvider;
      createComment = dto.shippingAddress?.comment?.trim() || '';
      createPvzCode = resolvePvzCode(
        createComment,
        dto.shippingAddress?.pvzCode,
      );
      assertShippingCommentMatchesCarrier(createComment, carrier);
      assertCdekPvzCodePresent({
        shippingMethod: carrier,
        comment: createComment,
        pvzCode: createPvzCode,
      });
      if (dto.shippingCost == null || !Number.isFinite(dto.shippingCost)) {
        if (!allowMissingShipping) {
          throw new BadRequestException('Укажите стоимость доставки');
        }
        shippingCost = 0;
      } else {
        shippingCost = Math.max(0, Math.floor(dto.shippingCost));
      }
    }
  }

  const payableForGift = payableAfterPromo + shippingCost;
  if (giftRaw) {
    giftApply = await deps.giftsPublic.applyForCheckout(giftRaw, payableForGift);
  }

  const giftCertificateAmount = giftApply?.applyAmount ?? 0;
  const giftCertificateCode = giftApply?.code ?? null;
  const total = Math.max(0, payableForGift - giftCertificateAmount);

  const attachGratitude = dto.attachGratitude !== false;
  const gratitudeGifts =
    giftOnly || !attachGratitude
      ? []
      : await deps.resolveGratitudeGiftLines(payableAfterPromo);

  return {
    email,
    phone,
    customerName,
    userId,
    guestId,
    items,
    giftOnly,
    subtotal,
    discountTotal,
    promoCode,
    promoApply,
    giftApply,
    giftCertificateAmount,
    giftCertificateCode,
    shippingCost,
    shippingMethod,
    createComment,
    createPvzCode,
    city,
    address,
    payableAfterPromo,
    total,
    gratitudeGifts,
    priceOverrides,
    wantYourich,
    refHash,
    extUserId,
    syncedPricing: {
      groupId: synced.pricing?.groupId ?? null,
      groupName: synced.pricing?.groupName ?? null,
      context: synced.pricing?.context ?? null,
    },
  };
}

export function serializeAdminCreatePreview(quote: AdminCreateQuote) {
  return {
    subtotal: quote.subtotal,
    discountTotal: quote.discountTotal,
    giftCertificateAmount: quote.giftCertificateAmount,
    shippingCost: quote.shippingCost,
    total: quote.total,
    promoCode: quote.promoCode,
    giftCertificateCode: quote.giftCertificateCode,
    gratitudeCount: quote.gratitudeGifts.length,
    gratitudeItems: quote.gratitudeGifts.map((g) => ({
      title: [g.name, g.variantName].filter(Boolean).join(' · '),
      qty: g.qty,
    })),
    priceOverrides: quote.priceOverrides,
    lines: quote.items.map((l) => ({
      variantId: l.variantId,
      title: [l.name, l.variantName, l.shadeName].filter(Boolean).join(' · '),
      qty: l.qty,
      unitPrice: l.price,
      catalogPrice: l.catalogPrice ?? l.price,
      lineTotal: l.price * l.qty,
    })),
  };
}
