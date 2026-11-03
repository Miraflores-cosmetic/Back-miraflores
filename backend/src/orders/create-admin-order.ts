import { BadRequestException, Logger } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';
import { scheduleAfterRlsCommitWithBypass } from '../rls/rls-after-commit';
import type { CatalogPublicService } from '../catalog/catalog.public.service';
import type { PromoPublicService } from '../promo/promo.service';
import { promoConsumingRedemptionWhere } from '../promo/promo-redemption.util';
import type { GiftCertificatesPublicService } from '../gift-certificates/gift-certificates.public.service';
import { holdGiftCertificateForOrder } from '../gift-certificates/gift-certificate-hold.util';
import {
  GIFT_PURCHASE_SKU,
  giftPurchaseSkuForDenom,
  parseGiftDenomCartVariantId,
  parseGiftPurchaseSkuDenomId,
} from '../gift-certificates/gift-certificate-purchase.util';
import { allocateNextOrderNumber } from './order-number';
import { reserveStockForLines } from './order-stock';
import type { YourichClient } from '../yourich/yourich.client';
import type { YourichSyncService } from '../yourich/yourich-sync.service';
import type { OrderLifecycleService } from './order-lifecycle.service';
import type { OrderChatService } from '../order-chat/order-chat.service';
import type { AdminCreateOrderDto } from './dto/admin-create-order.dto';
import {
  computeAdminCreateQuote,
  serializeAdminCreatePreview,
  type AdminCreateQuoteDeps,
} from './admin-create-quote';

type LockedPromo = {
  id: string;
  active: boolean;
  maxUses: number | null;
  oneShot: boolean;
};

export type CreateAdminOrderDeps = AdminCreateQuoteDeps & {
  lifecycle: OrderLifecycleService;
  orderChat: OrderChatService;
  yourichSync?: YourichSyncService;
  yourichClient?: YourichClient;
  logger: Logger;
};

function resolveIdempotencyKey(dto: AdminCreateOrderDto): string {
  const raw = dto.idempotencyKey?.trim();
  if (raw && raw.length >= 8) return raw.slice(0, 128);
  return `admin-${randomUUID()}`;
}

function serializeCreated(order: {
  id: string;
  number: string;
  status: OrderStatus;
  email: string;
  phone: string;
  subtotal: number;
  discountTotal: number;
  giftCertificateAmount: number;
  total: number;
  promoCode: string | null;
  giftCertificateCode: string | null;
}) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    email: order.email,
    phone: order.phone,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    giftCertificateAmount: order.giftCertificateAmount,
    total: order.total,
    promoCode: order.promoCode,
    giftCertificateCode: order.giftCertificateCode,
  };
}

export async function previewAdminOrder(
  deps: AdminCreateQuoteDeps,
  dto: AdminCreateOrderDto,
) {
  const guestId = `admin-preview-${randomUUID()}`;
  const quote = await computeAdminCreateQuote(deps, dto, {
    guestId,
    allowMissingShipping: Boolean(dto.previewAllowMissingShipping),
  });
  return serializeAdminCreatePreview(quote);
}

/**
 * Staff create: тот же quote, что preview; guestId стабилен от idempotencyKey.
 */
export async function createAdminOrder(
  deps: CreateAdminOrderDeps,
  dto: AdminCreateOrderDto,
  opts: { actorUserId: string },
) {
  const idempotencyKey = resolveIdempotencyKey(dto);
  const guestId = `admin-${idempotencyKey}`;

  const existing = await deps.prisma.order.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    return serializeCreated(existing);
  }

  const quote = await computeAdminCreateQuote(deps, dto, { guestId });
  const {
    email,
    phone,
    customerName,
    userId,
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
    gratitudeGifts,
    priceOverrides,
    wantYourich,
    refHash,
    extUserId,
    syncedPricing,
  } = quote;

  const itemsForOrder = [...items, ...gratitudeGifts];

  if (gratitudeGifts.length > 0) {
    deps.logger.log(
      `Admin create: gratitude gifts n=${gratitudeGifts.length} goodsAfterPromo=${quote.payableAfterPromo}`,
    );
  }

  const order = await deps.prisma.$transaction(async (tx) => {
    if (promoApply) {
      const locked = await tx.$queryRaw<LockedPromo[]>`
          SELECT id, active, "maxUses", "oneShot"
          FROM "PromoCode"
          WHERE id = ${promoApply.promoCodeId}
          FOR UPDATE
        `;
      const row = locked[0];
      if (!row || !row.active) {
        throw new BadRequestException('Промокод недействителен');
      }

      const used = await tx.promoCodeRedemption.count({
        where: {
          promoCodeId: promoApply.promoCodeId,
          ...promoConsumingRedemptionWhere,
        },
      });
      if (row.maxUses != null && used >= row.maxUses) {
        throw new BadRequestException('Лимит применений промокода исчерпан');
      }

      if (row.oneShot) {
        const or: Prisma.PromoCodeRedemptionWhereInput[] = [{ email }];
        if (userId) or.push({ userId });
        if (guestId) or.push({ guestId });
        const prior = await tx.promoCodeRedemption.findFirst({
          where: {
            promoCodeId: row.id,
            ...promoConsumingRedemptionWhere,
            OR: or,
          },
          select: { id: true },
        });
        if (prior) {
          throw new BadRequestException('Этот промокод уже был использован');
        }
      }
    }

    let created: Prisma.OrderGetPayload<{ include: { items: true } }> | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const number = await allocateNextOrderNumber(tx);
        created = await tx.order.create({
          data: {
            number,
            idempotencyKey,
            status: OrderStatus.AWAITING_PAYMENT,
            email,
            phone,
            customerName,
            customerNote: dto.customerNote?.trim()
              ? dto.customerNote.trim().slice(0, 1000)
              : null,
            guestId,
            userId,
            pricingGroupId: syncedPricing.groupId,
            pricingGroupName: syncedPricing.groupName,
            pricingContext: syncedPricing.context,
            promoCode,
            discountTotal,
            giftCertificateCode,
            giftCertificateId: giftApply?.certificateId ?? null,
            giftCertificateAmount,
            subtotal,
            total: quote.total,
            shippingCost,
            shippingMethod,
            shippingAddress: giftOnly
              ? {
                  city: city || '—',
                  address: address || 'Электронный сертификат',
                  apartment: '',
                  region: '',
                  district: '',
                  comment: 'digital-gift',
                  postalCode: '',
                }
              : {
                  city,
                  address,
                  apartment: dto.shippingAddress?.apartment?.trim() || '',
                  region: dto.shippingAddress?.region?.trim() || '',
                  district: dto.shippingAddress?.district?.trim() || '',
                  comment: createComment,
                  postalCode: dto.shippingAddress?.postalCode?.trim() || '',
                  pvzCode: createPvzCode || undefined,
                  phone: dto.shippingAddress?.phone?.trim() || undefined,
                  recipientName:
                    dto.shippingAddress?.recipientName?.trim() || undefined,
                  carrierQuote: {
                    cost: shippingCost,
                    method: shippingMethod,
                    freePvz: false,
                    tariffId: dto.shippingAddress?.carrierQuote?.tariffId ?? null,
                    tariffName:
                      dto.shippingAddress?.carrierQuote?.tariffName ?? null,
                    daysMin: dto.shippingAddress?.carrierQuote?.daysMin ?? null,
                    daysMax: dto.shippingAddress?.carrierQuote?.daysMax ?? null,
                    source: 'admin',
                    estimatedAt: new Date().toISOString(),
                  },
                },
            giftPurchaseDenominationId: (() => {
              for (const l of itemsForOrder) {
                const denomId = parseGiftDenomCartVariantId(l.variantId);
                if (denomId) return denomId;
                const fromSku = parseGiftPurchaseSkuDenomId(l.sku);
                if (fromSku) return fromSku;
              }
              return null;
            })(),
            giftPurchaseRecipientEmail: (() => {
              const hasGift = itemsForOrder.some(
                (l) =>
                  Boolean(parseGiftDenomCartVariantId(l.variantId)) ||
                  Boolean(parseGiftPurchaseSkuDenomId(l.sku)) ||
                  (l.sku ?? '') === GIFT_PURCHASE_SKU,
              );
              return hasGift ? email : null;
            })(),
            items: {
              create: itemsForOrder.map((l) => {
                const giftDenomId = parseGiftDenomCartVariantId(l.variantId);
                const title = [l.name, l.variantName, l.shadeName]
                  .filter(Boolean)
                  .join(' · ');
                return {
                  variantId: giftDenomId ? null : l.variantId,
                  shadeId: l.shadeId ?? null,
                  title,
                  sku: giftDenomId
                    ? giftPurchaseSkuForDenom(giftDenomId)
                    : l.sku,
                  qty: l.qty,
                  unitPrice: l.price,
                  lineTotal: l.price * l.qty,
                  baseUnitPrice: l.baseUnitPrice ?? null,
                  groupUnitPrice: l.groupUnitPrice ?? null,
                  isGratitudeGift: Boolean(l.isGratitudeGift),
                };
              }),
            },
          },
          include: { items: true },
        });
        break;
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          const target = e.meta?.target;
          const targets = Array.isArray(target)
            ? target.map(String)
            : typeof target === 'string'
              ? [target]
              : [];
          if (targets.some((t) => t.includes('idempotencyKey'))) {
            const raced = await tx.order.findUnique({
              where: { idempotencyKey },
              include: { items: true },
            });
            if (raced) return raced;
          }
          if (attempt < 4) continue;
        }
        throw e;
      }
    }
    if (!created) throw new BadRequestException('Не удалось создать заказ');

    if (giftApply) {
      await holdGiftCertificateForOrder(tx, {
        certificateId: giftApply.certificateId,
        orderId: created.id,
        applyAmount: giftApply.applyAmount,
      });
    }

    await reserveStockForLines(
      tx,
      created.items.map((i) => ({
        variantId: i.variantId,
        qty: i.qty,
        title: i.title,
      })),
    );

    await deps.lifecycle.addEvent(tx, {
      orderId: created.id,
      type: 'CREATED',
      message: 'Заказ создан сотрудником',
      actorUserId: opts.actorUserId,
      meta: {
        source: 'admin',
        ...(priceOverrides.length
          ? { unitPriceOverrides: priceOverrides }
          : {}),
        attachGratitude: dto.attachGratitude !== false,
        payMode: dto.payMode,
        wantYourich,
      },
    });

    if (promoApply) {
      await tx.promoCodeRedemption.create({
        data: {
          promoCodeId: promoApply.promoCodeId,
          orderId: created.id,
          code: promoApply.code,
          discountAmount: discountTotal,
          email,
          userId,
          guestId,
        },
      });
    }

    if (wantYourich) {
      const giftPurchaseDenominationId = (() => {
        for (const l of itemsForOrder) {
          const denomId = parseGiftDenomCartVariantId(l.variantId);
          if (denomId) return denomId;
          const fromSku = parseGiftPurchaseSkuDenomId(l.sku);
          if (fromSku) return fromSku;
        }
        return null;
      })();
      if (!giftPurchaseDenominationId) {
        await tx.orderAffiliateLead.create({
          data: {
            orderId: created.id,
            leadCrmId: created.number,
            refHash,
            extUserId,
            promoCodeRaw: promoApply?.affiliate ? promoApply.codeRaw : null,
            offerId: deps.yourichClient?.fallbackOfferId() ?? null,
            state: 'PENDING',
            nextAttemptAt: new Date(),
          },
        });
      }
    }

    return created;
  });

  scheduleAfterRlsCommitWithBypass(deps.prisma, () =>
    deps.orderChat.seedCustomerNoteFromOrder(order.id),
  );
  if (wantYourich && deps.yourichSync) {
    scheduleAfterRlsCommitWithBypass(deps.prisma, () =>
      deps.yourichSync!.touch(order.id),
    );
  }
  scheduleAfterRlsCommitWithBypass(deps.prisma, () =>
    deps.lifecycle.notifyAdminOrderCreated(order.number),
  );

  return serializeCreated(order);
}
