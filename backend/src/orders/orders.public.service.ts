import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentStatus, Prisma, ShipmentProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogPublicService } from '../catalog/catalog.public.service';
import { PromoPublicService } from '../promo/promo.service';
import { promoConsumingRedemptionWhere } from '../promo/promo-redemption.util';
import { GiftCertificatesPublicService } from '../gift-certificates/gift-certificates.public.service';
import {
  holdGiftCertificateForOrder,
} from '../gift-certificates/gift-certificate-hold.util';
import { SettingsPublicService } from '../settings/settings.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import { cancelUnpaidOrderInTx } from './cancel-unpaid-order';
import {
  reserveStockForLines,
} from './order-stock';
import { lockOrderForUpdate } from './order-lock';
import { resolveShippingFromQuote, buildQuoteCost, resolvePvzCode, requireCheckoutShipmentProvider } from './order-shipping.resolve';
import {
  hashCartLines,
  hashShippingAddress,
  ShippingQuoteService,
} from './shipping-quote.service';
import { ShippingServerEstimateService } from './shipping-server-estimate.service';
import type { ShippingQuoteRequestDto } from './dto/shipping-quote.dto';
import { applyPaidInTx } from './mark-order-paid';
import { YooKassaService } from './yookassa.service';
import { OrderPayTokenService } from './order-pay-token.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { formatPhoneE164, isValidPhone } from '../common/phone.util';
import {
  giftBuyerCopyEmail,
  giftPurchasePaidEmail,
} from '../gift-certificates/gift-purchase-email';
import {
  GIFT_PURCHASE_SKU,
  assertGiftDenomCartNotMixedWithPhysical,
  giftPurchaseSkuForDenom,
  parseGiftDenomCartVariantId,
  parseGiftPurchaseSkuDenomId,
} from '../gift-certificates/gift-certificate-purchase.util';

import { allocateNextOrderNumber } from './order-number';

type SyncedCartItem = {
  variantId: string;
  shadeId: string | null;
  shadeName: string | null;
  name: string;
  variantName: string;
  sku: string;
  price: number;
  qty: number;
  baseUnitPrice?: number;
  groupUnitPrice?: number;
  isGratitudeGift?: boolean;
};

type LockedPromo = {
  id: string;
  active: boolean;
  maxUses: number | null;
  oneShot: boolean;
};

type MarkPaidOutcome =
  | 'paid'
  | 'already'
  | 'late_refunded'
  | 'late_failed'
  | 'surcharge';

const FULFILLED_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PACKING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

@Injectable()
export class OrdersPublicService {
  private readonly logger = new Logger(OrdersPublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogPublic: CatalogPublicService,
    private readonly promoPublic: PromoPublicService,
    private readonly giftsPublic: GiftCertificatesPublicService,
    private readonly settingsPublic: SettingsPublicService,
    private readonly yookassa: YooKassaService,
    private readonly config: ConfigService,
    private readonly payTokens: OrderPayTokenService,
    private readonly shippingQuotes: ShippingQuoteService,
    private readonly shippingServerEstimate: ShippingServerEstimateService,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  /**
   * Подарок благодарности по порогу subtotal — бесплатная линия в заказе.
   * Клиентские isGift-линии не принимаем: аттач только с сервера через getApplicableGift.
   * OOS / inactive — soft skip (заказ без подарка), не блокируем create.
   * Preview (`GET applicable-gift`) тоже скрывает OOS заранее.
   */
  private async resolveGratitudeGiftLine(
    subtotal: number,
  ): Promise<SyncedCartItem | null> {
    const gift = await this.settingsPublic.getApplicableGift(subtotal);
    if (!gift.applicable || !gift.variantId) return null;

    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id: gift.variantId,
        active: true,
        product: { active: true },
      },
      select: {
        id: true,
        name: true,
        sku: true,
        stock: true,
        stockReserve: true,
        product: { select: { name: true } },
      },
    });
    if (!variant) {
      this.logger.warn(
        `Gratitude gift skipped: variant missing/inactive (${gift.variantId})`,
      );
      return null;
    }

    const qty = Math.max(1, gift.quantity ?? 1);
    const available = Math.max(0, variant.stock - variant.stockReserve);
    if (available < qty) {
      this.logger.warn(
        `Gratitude gift skipped: OOS for ${variant.id} (need ${qty}, available ${available})`,
      );
      return null;
    }

    return {
      variantId: variant.id,
      shadeId: null,
      shadeName: null,
      name: variant.product.name,
      variantName: variant.name,
      sku: variant.sku?.trim() || `gift-${variant.id}`,
      price: 0,
      qty,
      isGratitudeGift: true,
    };
  }

  private serializeCreated(order: {
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
    guestId: string | null;
    items: unknown;
  }) {
    const guestId = order.guestId?.trim() || '';
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
      items: order.items,
      /** Short-lived HMAC для pay / status / abandon. */
      payToken: guestId ? this.payTokens.issue(order.id, guestId) : null,
    };
  }

  private assertPayTokenAccess(
    order: { id: string; guestId: string | null },
    payToken?: string | null,
  ) {
    const claims = this.payTokens.verify(payToken, order.id);
    if (!order.guestId || order.guestId !== claims.guestId) {
      throw new BadRequestException('Нет доступа к заказу');
    }
    return claims;
  }

  /**
   * Доступ к checkout-status: payToken (гость) или JWT buyer (userId заказа).
   * Без одного из двух — 403 (не отдаём number/paid по голому orderId).
   */
  private assertCheckoutStatusAccess(
    order: { id: string; guestId: string | null; userId: string | null },
    opts: { payToken?: string | null; buyerUserId?: string | null },
  ) {
    const buyerId = opts.buyerUserId?.trim() || '';
    if (buyerId && order.userId && order.userId === buyerId) {
      return;
    }
    const token = opts.payToken?.trim() || '';
    if (token) {
      this.assertPayTokenAccess(order, token);
      return;
    }
    throw new ForbiddenException(
      'Нужен payToken или вход в аккаунт владельца заказа',
    );
  }

  /**
   * Подписанный расчёт доставки: Nest фиксирует cost (free-PVZ или clientEstimate)
   * в HMAC-токене. Create order принимает только этот quote.
   */
  async createShippingQuote(dto: ShippingQuoteRequestDto, userId?: string | null) {
    const city = dto.shippingAddress?.city?.trim() || '';
    const address = dto.shippingAddress?.address?.trim() || '';
    if (!city || !address) {
      throw new BadRequestException('Укажите город и адрес доставки');
    }

    const synced = await this.catalogPublic.syncCartLines(dto.lines ?? [], userId ?? null);
    const items = synced.items;
    if (!items.length) {
      throw new BadRequestException('Корзина пуста или позиции недоступны');
    }
    const { giftOnly } = assertGiftDenomCartNotMixedWithPhysical(items);
    if (giftOnly) {
      throw new BadRequestException(
        'Для электронных сертификатов доставка не нужна — оформите заказ без расчёта доставки',
      );
    }

    const subtotal = items.reduce((sum, l) => sum + l.price * l.qty, 0);
    const cartSettings = await this.prisma.cartSettings.findUnique({
      where: { id: 'default' },
      select: { freeShippingThresholdRub: true },
    });
    const freeShippingThresholdRub =
      cartSettings?.freeShippingThresholdRub ?? 10_000;

    const comment = dto.shippingAddress.comment?.trim() || '';
    const shippingAddress = {
      city,
      address,
      apartment: dto.shippingAddress.apartment?.trim() || '',
      region: dto.shippingAddress.region?.trim() || '',
      district: dto.shippingAddress.district?.trim() || '',
      postalCode: dto.shippingAddress.postalCode?.trim() || '',
      comment,
      pvzCode: resolvePvzCode(comment, dto.shippingAddress.pvzCode),
      phone: dto.shippingAddress.phone?.trim() || '',
      recipientName: dto.shippingAddress.recipientName?.trim() || '',
    };

    const { cost, method, freePvz } = buildQuoteCost({
      shippingMethod: dto.shippingMethod,
      shippingComment: shippingAddress.comment,
      pvzCode: shippingAddress.pvzCode,
      goodsSubtotal: subtotal,
      freeShippingThresholdRub,
      clientEstimate: dto.clientEstimate,
      serverEstimate: await this.shippingServerEstimate.estimate({
        method: requireCheckoutShipmentProvider(dto.shippingMethod),
        shippingAddress,
        lines: items.map((l) => ({ variantId: l.variantId, qty: l.qty })),
      }),
      requireServerReprice:
        this.shippingServerEstimate.requireServerReprice() &&
        dto.shippingMethod.trim().toUpperCase() === 'CDEK' &&
        this.shippingServerEstimate.isCdekConfigured(),
    });

    const linesForHash = items.map((l) => ({
      variantId: l.variantId,
      shadeId: l.shadeId,
      qty: l.qty,
    }));

    const cq = dto.carrierQuote;
    const issued = this.shippingQuotes.issue({
      cost,
      method,
      addrHash: hashShippingAddress(shippingAddress, method),
      linesHash: hashCartLines(linesForHash),
      goodsSubtotal: subtotal,
      freePvz,
      ...(cq?.tariffId != null ? { tariffId: cq.tariffId } : {}),
      ...(cq?.tariffName ? { tariffName: cq.tariffName } : {}),
      ...(cq?.daysMin != null ? { daysMin: cq.daysMin } : {}),
      ...(cq?.daysMax != null ? { daysMax: cq.daysMax } : {}),
    });

    return {
      cost: issued.payload.cost,
      method: issued.payload.method,
      freePvz: issued.payload.freePvz,
      quote: issued.quote,
      expiresAt: issued.expiresAt,
      removedKeys: synced.removedKeys,
      removedLines: synced.removedLines,
      subtotal,
    };
  }

  /** Idempotent create: payToken только владельцу guestId. */
  private assertIdempotentGuest(
    order: { guestId: string | null },
    guestId: string,
  ) {
    const g = guestId.trim();
    if (!g || !order.guestId || order.guestId !== g) {
      throw new ForbiddenException('Заказ с таким ключом уже создан');
    }
  }

  /**
   * Создаёт заказ (SKU checkout или gift purchase в одной модели Order).
   *
   * guestId обязателен даже при JWT USER: SPA всегда шлёт guest-идентификатор
   * (cookie/local), а payToken = HMAC(orderId, guestId) — единый ключ доступа
   * к pay / abandon / payment-status для гостя и залогиненного покупателя.
   * JWT buyer отдельно покрывает только checkout-status владельца (userId).
   * Связка guest+JWT сознательная: не путать с «гостевой-only» моделью.
   */
  async create(dto: CreateOrderDto, userId?: string | null) {
    const email = dto.email.trim().toLowerCase();
    if (!email) throw new BadRequestException('Укажите email и телефон');
    if (!isValidPhone(dto.phone)) {
      throw new BadRequestException('Некорректный телефон');
    }
    const phone = formatPhoneE164(dto.phone);

    const customerName = dto.customerName.trim();
    if (!customerName) throw new BadRequestException('Укажите имя');

    const idempotencyKey = dto.idempotencyKey?.trim();
    if (!idempotencyKey) {
      throw new BadRequestException('idempotencyKey обязателен');
    }

    const guestId = dto.guestId.trim();
    if (!guestId) throw new BadRequestException('guestId обязателен');

    await this.expireStaleAwaitingOrders();

    const existing = await this.prisma.order.findUnique({
      where: { idempotencyKey },
      include: { items: true },
    });
    if (existing) {
      this.assertIdempotentGuest(existing, guestId);
      return this.serializeCreated(existing);
    }

    const synced = await this.catalogPublic.syncCartLines(dto.lines ?? [], userId ?? null);
    const items = synced.items;
    if (!items.length) {
      throw new BadRequestException('Корзина пуста или позиции недоступны');
    }

    const { giftOnly } = assertGiftDenomCartNotMixedWithPhysical(items);

    const city = dto.shippingAddress?.city?.trim() || '';
    const address = dto.shippingAddress?.address?.trim() || '';
    if (!giftOnly && (!city || !address)) {
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
        throw new BadRequestException('Промокод недоступен для вашей группы');
      }
      // Precheck вне tx (быстрый UX-reject); лимиты повторно под FOR UPDATE ниже.
      promoApply = await this.promoPublic.applyForCheckout(promoRaw, subtotal, {
        email,
        userId: userId ?? null,
        guestId,
      });
      discountTotal = promoApply.discountAmount;
      promoCode = promoApply.code;
    }

    const payableAfterPromo = Math.max(0, subtotal - discountTotal);

    const cartSettings = await this.prisma.cartSettings.findUnique({
      where: { id: 'default' },
      select: { freeShippingThresholdRub: true },
    });
    const freeShippingThresholdRub =
      cartSettings?.freeShippingThresholdRub ?? 10_000;

    let shippingCost = 0;
    let shippingMethod: ShipmentProvider | null = null;
    let createComment = '';
    let createPvzCode: string | null = null;
    let quotePayload: ReturnType<ShippingQuoteService['verify']> | null = null;

    if (!giftOnly) {
      if (!dto.shippingQuote?.trim() || !dto.shippingMethod?.trim()) {
        throw new BadRequestException('Укажите способ и расчёт доставки');
      }
      quotePayload = this.shippingQuotes.verify(dto.shippingQuote);
      createComment = dto.shippingAddress.comment?.trim() || '';
      createPvzCode = resolvePvzCode(createComment, dto.shippingAddress.pvzCode);
      const resolved = resolveShippingFromQuote({
        quote: quotePayload,
        shippingMethod: dto.shippingMethod,
        shippingAddress: {
          city,
          address,
          apartment: dto.shippingAddress.apartment?.trim() || '',
          region: dto.shippingAddress.region?.trim() || '',
          district: dto.shippingAddress.district?.trim() || '',
          postalCode: dto.shippingAddress.postalCode?.trim() || '',
          comment: createComment,
          pvzCode: createPvzCode,
          phone: dto.shippingAddress.phone?.trim() || '',
          recipientName: dto.shippingAddress.recipientName?.trim() || '',
        },
        lines: items.map((l) => ({
          variantId: l.variantId,
          shadeId: l.shadeId,
          qty: l.qty,
        })),
        goodsSubtotal: subtotal,
        freeShippingThresholdRub,
      });
      shippingCost = resolved.cost;
      shippingMethod = resolved.method;
    }

    // Сертификат покрывает товары + доставку (промо — только товары).
    const payableForGift = payableAfterPromo + shippingCost;
    if (giftRaw) {
      giftApply = await this.giftsPublic.applyForCheckout(giftRaw, payableForGift);
    }

    const giftCertificateAmount = giftApply?.applyAmount ?? 0;
    const giftCertificateCode = giftApply?.code ?? null;
    const total = Math.max(0, payableForGift - giftCertificateAmount);

    // Подарок благодарности — только к physical-заказам (не к digital gift-denom).
    const gratitudeGift = giftOnly
      ? null
      : await this.resolveGratitudeGiftLine(subtotal);
    const itemsForOrder: SyncedCartItem[] = gratitudeGift
      ? [...(items as SyncedCartItem[]), gratitudeGift]
      : (items as SyncedCartItem[]);

    if (gratitudeGift) {
      this.logger.log(
        `Gratitude gift attached: variant=${gratitudeGift.variantId} qty=${gratitudeGift.qty} subtotal=${subtotal}`,
      );
    } else {
      this.logger.log(
        `Gratitude gift not attached for subtotal=${subtotal}`,
      );
    }

    const order = await this.prisma.$transaction(async (tx) => {
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

      let created:
        | Prisma.OrderGetPayload<{ include: { items: true } }>
        | undefined;
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
              userId: userId ?? null,
              pricingGroupId: synced.pricing?.groupId ?? null,
              pricingGroupName: synced.pricing?.groupName ?? null,
              pricingContext: synced.pricing?.context ?? null,
              promoCode,
              discountTotal,
              giftCertificateCode,
              giftCertificateId: giftApply?.certificateId ?? null,
              giftCertificateAmount,
              subtotal,
              total,
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
                    apartment: dto.shippingAddress.apartment?.trim() || '',
                    region: dto.shippingAddress.region?.trim() || '',
                    district: dto.shippingAddress.district?.trim() || '',
                    comment: createComment,
                    postalCode: dto.shippingAddress.postalCode?.trim() || '',
                    pvzCode: createPvzCode || undefined,
                    phone: dto.shippingAddress.phone?.trim() || undefined,
                    recipientName:
                      dto.shippingAddress.recipientName?.trim() || undefined,
                    carrierQuote: {
                      cost: shippingCost,
                      method: shippingMethod,
                      freePvz: Boolean(quotePayload?.freePvz),
                      tariffId:
                        dto.shippingAddress.carrierQuote?.tariffId ??
                        quotePayload?.tariffId ??
                        null,
                      tariffName:
                        dto.shippingAddress.carrierQuote?.tariffName ??
                        quotePayload?.tariffName ??
                        null,
                      daysMin:
                        dto.shippingAddress.carrierQuote?.daysMin ??
                        quotePayload?.daysMin ??
                        null,
                      daysMax:
                        dto.shippingAddress.carrierQuote?.daysMax ??
                        quotePayload?.daysMax ??
                        null,
                      source: 'checkout',
                      estimatedAt: new Date().toISOString(),
                      quoteExp: quotePayload?.exp,
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
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
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

      await this.lifecycle.addEvent(tx, {
        orderId: created.id,
        type: 'CREATED',
        message: 'Заказ создан',
        meta: { source: 'checkout' },
      });

      // Hold слота промокода сразу (лимит / oneShot), не ждать PAID.
      if (promoApply) {
        await tx.promoCodeRedemption.create({
          data: {
            promoCodeId: promoApply.promoCodeId,
            orderId: created.id,
            code: promoApply.code,
            discountAmount: discountTotal,
            email,
            userId: userId ?? null,
            guestId,
          },
        });
      }

      return created;
    });

    this.assertIdempotentGuest(order, guestId);
    return this.serializeCreated(order);
  }

  /**
   * Гость отменяет неоплаченный заказ (смена корзины / адреса на checkout).
   * Снимает stockReserve.
   */
  async abandon(orderId: string, payToken?: string | null) {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockOrderForUpdate(tx, orderId);
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (
        order.status !== OrderStatus.AWAITING_PAYMENT &&
        order.status !== OrderStatus.NEW
      ) {
        return {
          id: order.id,
          status: order.status,
          abandoned: false as const,
          pendingExternalIds: [] as string[],
        };
      }
      this.assertPayTokenAccess(order, payToken);

      const cancelled = await cancelUnpaidOrderInTx(tx, {
        orderId: order.id,
        fromStatus: order.status,
        items: order.items,
        message: 'Заказ отменён (checkout)',
        reason: 'abandon',
      });
      return {
        id: cancelled.id,
        status: cancelled.status,
        abandoned: true as const,
        pendingExternalIds: cancelled.pendingExternalIds,
      };
    });

    if (result.abandoned && result.pendingExternalIds.length) {
      await this.yookassa.cancelPaymentsBestEffort(result.pendingExternalIds);
    }
    return {
      id: result.id,
      status: result.status,
      abandoned: result.abandoned,
    };
  }

  /**
   * Авто-отмена неоплаченных AWAITING_PAYMENT старше TTL (мин).
   * Env: ORDER_AWAITING_TTL_MINUTES (default 60).
   */
  async expireStaleAwaitingOrders(now = new Date()): Promise<number> {
    const minutesRaw = this.config.get<string>('ORDER_AWAITING_TTL_MINUTES');
    const minutes = Math.max(
      5,
      Number.parseInt(minutesRaw || '60', 10) || 60,
    );
    const cutoff = new Date(now.getTime() - minutes * 60_000);

    const stale = await this.prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.NEW] },
        createdAt: { lt: cutoff },
      },
      include: { items: true },
      take: 50,
    });

    let cancelled = 0;
    for (const order of stale) {
      const pendingExternalIds = await this.prisma.$transaction(async (tx) => {
        await lockOrderForUpdate(tx, order.id);
        const fresh = await tx.order.findUnique({
          where: { id: order.id },
          include: { items: true },
        });
        if (
          !fresh ||
          (fresh.status !== OrderStatus.AWAITING_PAYMENT &&
            fresh.status !== OrderStatus.NEW)
        ) {
          return null;
        }
        const result = await cancelUnpaidOrderInTx(tx, {
          orderId: fresh.id,
          fromStatus: fresh.status,
          items: fresh.items,
          message: 'Заказ отменён (истёк срок оплаты)',
          reason: 'ttl',
          giftNote: 'Возврат при истечении срока оплаты',
        });
        return result.pendingExternalIds;
      });
      if (pendingExternalIds == null) continue;
      if (pendingExternalIds.length) {
        await this.yookassa.cancelPaymentsBestEffort(pendingExternalIds);
      }
      cancelled += 1;
    }
    return cancelled;
  }

  /** Создаёт платёж ЮKassa (embedded) для заказа AWAITING_PAYMENT. */
  async createPayment(orderId: string, payToken?: string | null) {
    await this.expireStaleAwaitingOrders();

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, payments: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    this.assertPayTokenAccess(order, payToken);

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Срок оплаты истёк, оформите заказ заново');
    }

    if (order.status === OrderStatus.PAID) {
      return {
        alreadyPaid: true as const,
        orderId: order.id,
        number: order.number,
        total: order.total,
      };
    }

    if (
      order.status !== OrderStatus.AWAITING_PAYMENT &&
      order.status !== OrderStatus.NEW
    ) {
      throw new BadRequestException('Заказ нельзя оплатить в текущем статусе');
    }

    if (order.total <= 0) {
      await this.markOrderPaid(order.id, null);
      return {
        alreadyPaid: true as const,
        orderId: order.id,
        number: order.number,
        total: 0,
      };
    }

    const pending = order.payments.find(
      (p) =>
        p.status === PaymentStatus.PENDING &&
        p.externalId &&
        (p.raw as { confirmationToken?: string } | null)?.confirmationToken,
    );
    if (pending?.externalId) {
      const raw = pending.raw as { confirmationToken?: string } | null;
      if (raw?.confirmationToken) {
        return {
          alreadyPaid: false as const,
          orderId: order.id,
          number: order.number,
          total: order.total,
          paymentId: pending.externalId,
          confirmationToken: raw.confirmationToken,
        };
      }
    }

    const site =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      'http://localhost:3000';

    // createPayment всегда через assertPayTokenAccess → guestId обязателен.
    // return_url без payToken: токен живёт в sessionStorage вкладки checkout
    // (см. Front pendingCheckoutOrder / OrderSuccess).
    const guestId = order.guestId?.trim() || '';
    if (!guestId) {
      throw new BadRequestException('Нет guestId для оплаты');
    }
    const returnQs = new URLSearchParams({
      orderId: order.id,
      number: order.number,
    });
    const returnUrl = order.giftPurchaseDenominationId
      ? `${site}/certificates/success?${returnQs.toString()}`
      : `${site}/order/success?${returnQs.toString()}`;

    // Чек: unitPrice × qty = subtotal; при промо — пропорционально к order.total.
    // Бесплатные подарки благодарности в чек не кладём (0 ₽ ломает фискализацию).
    const receiptBase = order.items
      .filter((i) => !i.isGratitudeGift && i.unitPrice > 0)
      .map((i) => ({
        description: i.title,
        quantity: i.qty,
        amountRub: i.unitPrice,
      }));
    const linesSum = receiptBase.reduce((s, i) => s + i.amountRub * i.quantity, 0);
    const ratio = linesSum > 0 ? order.total / linesSum : 1;
    let running = 0;
    const receiptItems = receiptBase.map((i, idx) => {
      const isLast = idx === receiptBase.length - 1;
      let unit = Math.round(i.amountRub * ratio);
      if (isLast) {
        unit = Math.max(
          0,
          Math.round((order.total - running) / Math.max(1, i.quantity)),
        );
      } else {
        running += unit * i.quantity;
      }
      if (unit <= 0 && order.total > 0) unit = 1;
      return { ...i, amountRub: unit };
    });

    const { payment, confirmationToken } = await this.yookassa.createEmbeddedPayment({
      amountRub: order.total,
      description: order.giftPurchaseDenominationId
        ? `Сертификат ${order.number}`
        : `Заказ ${order.number}`,
      orderId: order.id,
      orderNumber: order.number,
      customerEmail: order.email,
      returnUrl,
      receiptItems,
    });

    await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'yookassa',
        status: PaymentStatus.PENDING,
        amount: order.total,
        externalId: payment.id,
        confirmationUrl: payment.confirmation?.confirmation_url ?? null,
        raw: { confirmationToken, yookassa: payment } as Prisma.InputJsonValue,
      },
    });

    if (order.status === OrderStatus.NEW) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.AWAITING_PAYMENT },
      });
    }

    return {
      alreadyPaid: false as const,
      orderId: order.id,
      number: order.number,
      total: order.total,
      paymentId: payment.id,
      confirmationToken,
    };
  }

  async paymentStatus(externalId: string, payToken?: string | null) {
    const row = await this.prisma.payment.findFirst({
      where: { externalId },
      include: {
        order: { select: { id: true, number: true, status: true, guestId: true } },
      },
    });
    if (!row) throw new NotFoundException('Платёж не найден');
    this.assertPayTokenAccess(row.order, payToken);

    const remote = await this.yookassa.getPayment(externalId);
    const providerPaid = Boolean(remote.paid || remote.status === 'succeeded');

    let lateOutcome: MarkPaidOutcome | null = null;
    if (providerPaid && row.status !== PaymentStatus.SUCCEEDED) {
      const metaKind =
        (remote.metadata?.kind as string | undefined) ||
        (row.raw as { kind?: string } | null)?.kind;
      if (metaKind === 'surcharge') {
        lateOutcome = await this.applySurchargePaymentSucceeded(
          row.orderId,
          externalId,
          remote,
        );
      } else {
        lateOutcome = await this.markOrderPaid(row.orderId, remote);
      }
    } else if (
      remote.status === 'canceled' &&
      row.status === PaymentStatus.PENDING
    ) {
      await this.prisma.payment.update({
        where: { id: row.id },
        data: {
          status: PaymentStatus.CANCELED,
          raw: remote as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const order = await this.prisma.order.findUnique({
      where: { id: row.orderId },
      select: { id: true, number: true, status: true, total: true },
    });

    const orderPaid = Boolean(
      order && FULFILLED_STATUSES.includes(order.status),
    );
    const late =
      lateOutcome === 'late_refunded' || lateOutcome === 'late_failed';

    return {
      paymentId: externalId,
      status: remote.status,
      /** true только если заказ реально в оплаченном/исполняемом статусе */
      paid: orderPaid,
      providerPaid,
      latePayment: late,
      latePaymentRefunded: lateOutcome === 'late_refunded',
      message:
        lateOutcome === 'late_refunded'
          ? 'Срок оплаты истёк: платёж принят провайдером, оформлен автовозврат.'
          : lateOutcome === 'late_failed'
            ? 'Срок оплаты истёк: платёж прошёл, но автовозврат не удался. Свяжитесь с поддержкой.'
            : undefined,
      orderId: order?.id ?? row.orderId,
      number: order?.number ?? row.order.number,
      orderStatus: order?.status ?? row.order.status,
      total: order?.total,
    };
  }

  /**
   * Success после 3DS: синхронизация с ЮKassa.
   * Auth: payToken (query) или JWT покупателя (владелец order.userId).
   */
  async checkoutSuccessStatus(
    orderId: string,
    opts: { payToken?: string | null; buyerUserId?: string | null } = {},
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        number: true,
        status: true,
        guestId: true,
        userId: true,
        payments: {
          where: { externalId: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            externalId: true,
            status: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    this.assertCheckoutStatusAccess(order, opts);

    if (FULFILLED_STATUSES.includes(order.status)) {
      return {
        paid: true as const,
        orderId: order.id,
        number: order.number,
        orderStatus: order.status,
      };
    }

    if (
      order.status !== OrderStatus.AWAITING_PAYMENT &&
      order.status !== OrderStatus.NEW
    ) {
      return {
        paid: false as const,
        orderId: order.id,
        number: order.number,
        orderStatus: order.status,
        message:
          order.status === OrderStatus.CANCELLED
            ? 'Срок оплаты истёк или заказ отменён.'
            : 'Заказ нельзя подтвердить как оплаченный.',
      };
    }

    let lateOutcome: MarkPaidOutcome | null = null;
    for (const p of order.payments) {
      if (!p.externalId) continue;
      if (p.status === PaymentStatus.SUCCEEDED) continue;
      try {
        const remote = await this.yookassa.getPayment(p.externalId);
        if (remote.paid || remote.status === 'succeeded') {
          lateOutcome = await this.markOrderPaid(order.id, remote);
          break;
        }
        if (
          remote.status === 'canceled' &&
          p.status === PaymentStatus.PENDING
        ) {
          await this.prisma.payment.update({
            where: { id: p.id },
            data: {
              status: PaymentStatus.CANCELED,
              raw: remote as unknown as Prisma.InputJsonValue,
            },
          });
        }
      } catch (e) {
        this.logger.warn(
          `checkoutSuccessStatus yookassa ${p.externalId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    const fresh = await this.prisma.order.findUnique({
      where: { id: order.id },
      select: { id: true, number: true, status: true },
    });
    const paid = Boolean(
      fresh && FULFILLED_STATUSES.includes(fresh.status),
    );
    const late =
      lateOutcome === 'late_refunded' || lateOutcome === 'late_failed';

    return {
      paid,
      orderId: fresh?.id ?? order.id,
      number: fresh?.number ?? order.number,
      orderStatus: fresh?.status ?? order.status,
      latePayment: late,
      message: paid
        ? undefined
        : lateOutcome === 'late_refunded'
          ? 'Срок оплаты истёк: платёж принят провайдером, оформлен автовозврат.'
          : lateOutcome === 'late_failed'
            ? 'Срок оплаты истёк: автовозврат не удался. Свяжитесь с поддержкой.'
            : 'Оплата ещё не подтверждена. Обычно это занимает несколько секунд.',
    };
  }

  async handleYookassaWebhook(body: {
    event?: string;
    object?: {
      id?: string;
      status?: string;
      paid?: boolean;
      metadata?: { orderId?: string };
    };
  }) {
    const event = body.event;
    if (event === 'payment.canceled') {
      return this.handlePaymentCanceledWebhook(body);
    }
    if (event !== 'payment.succeeded') {
      return { received: true, ignored: true as const };
    }
    const paymentId = body.object?.id;
    if (!paymentId) throw new BadRequestException('Нет id платежа');

    const remote = await this.yookassa.getPayment(paymentId);
    if (!(remote.paid || remote.status === 'succeeded')) {
      return { received: true, ignored: true as const };
    }

    const orderId =
      remote.metadata?.orderId ||
      body.object?.metadata?.orderId ||
      (
        await this.prisma.payment.findFirst({
          where: { externalId: paymentId },
          select: { orderId: true },
        })
      )?.orderId;

    if (!orderId) throw new BadRequestException('Не найден заказ для платежа');

    const kind =
      remote.metadata?.kind ||
      (body.object?.metadata as { kind?: string } | undefined)?.kind ||
      undefined;
    if (kind === 'surcharge') {
      const surcharge = await this.applySurchargePaymentSucceeded(
        orderId,
        paymentId,
        remote,
      );
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, number: true, status: true },
      });
      return { received: true, outcome: surcharge, order };
    }

    const outcome = await this.markOrderPaid(orderId, remote);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, number: true, status: true },
    });
    return { received: true, outcome, order };
  }

  /** Синхронизация локального Payment при payment.canceled от ЮKassa. */
  private async handlePaymentCanceledWebhook(body: {
    object?: {
      id?: string;
      status?: string;
      metadata?: { orderId?: string };
    };
  }) {
    const paymentId = body.object?.id;
    if (!paymentId) throw new BadRequestException('Нет id платежа');

    const row = await this.prisma.payment.findFirst({
      where: { externalId: paymentId },
      select: { id: true, orderId: true, status: true },
    });
    if (!row) {
      return { received: true, ignored: true as const, reason: 'payment_not_found' };
    }
    if (
      row.status === PaymentStatus.CANCELED ||
      row.status === PaymentStatus.REFUNDED ||
      row.status === PaymentStatus.SUCCEEDED
    ) {
      return {
        received: true,
        ignored: true as const,
        reason: 'already_terminal',
        paymentStatus: row.status,
      };
    }

    await this.prisma.payment.update({
      where: { id: row.id },
      data: {
        status: PaymentStatus.CANCELED,
        raw: (body.object ?? {}) as Prisma.InputJsonValue,
      },
    });
    await this.lifecycle.addEvent(this.prisma, {
      orderId: row.orderId,
      type: 'NOTE',
      message: `Платёж ЮKassa отменён (${paymentId})`,
      meta: { yookassaPaymentId: paymentId, source: 'webhook' },
    });
    return {
      received: true,
      canceled: true as const,
      orderId: row.orderId,
      paymentId,
    };
  }

  /**
   * Доплата по уже оплаченному заказу: только SUCCEEDED payment + event,
   * без повторного PAID-pipeline (сток/gift уже обработаны).
   */
  private async applySurchargePaymentSucceeded(
    orderId: string,
    paymentId: string,
    remote: Awaited<ReturnType<YooKassaService['getPayment']>> | null,
  ): Promise<'surcharge' | 'already'> {
    const row = await this.prisma.payment.findFirst({
      where: { externalId: paymentId, orderId },
    });
    if (!row) {
      // Создадим запись, если webhook пришёл раньше локального create (редко)
      const amountRaw = remote?.amount?.value
        ? Math.round(Number.parseFloat(remote.amount.value))
        : 0;
      if (amountRaw < 1) return 'already';
      await this.prisma.payment.create({
        data: {
          orderId,
          provider: 'yookassa',
          status: PaymentStatus.SUCCEEDED,
          amount: amountRaw,
          externalId: paymentId,
          confirmationUrl: remote?.confirmation?.confirmation_url ?? null,
          raw: {
            kind: 'surcharge',
            yookassa: remote,
          } as Prisma.InputJsonValue,
        },
      });
    } else if (row.status === PaymentStatus.SUCCEEDED) {
      return 'already';
    } else {
      await this.prisma.payment.update({
        where: { id: row.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          raw: {
            kind: 'surcharge',
            yookassa: remote,
          } as Prisma.InputJsonValue,
        },
      });
    }

    const amount =
      row?.amount ??
      (remote?.amount?.value
        ? Math.round(Number.parseFloat(remote.amount.value))
        : 0);

    await this.lifecycle.addEvent(this.prisma, {
      orderId,
      type: 'SURCHARGE_PAID',
      message: `Доплата ${amount} ₽ получена`,
      meta: {
        amount,
        yookassaPaymentId: paymentId,
        kind: 'surcharge',
      },
    });

    return 'surcharge';
  }

  /**
   * Переводит заказ в PAID при AWAITING/NEW (общий applyPaidInTx).
   * Если заказ уже CANCELLED (TTL/abandon) — late → автовозврат.
   */
  private async markOrderPaid(
    orderId: string,
    remote: Awaited<ReturnType<YooKassaService['getPayment']>> | null,
  ): Promise<MarkPaidOutcome> {
    if (remote?.metadata?.kind === 'surcharge' && remote.id) {
      return this.applySurchargePaymentSucceeded(orderId, remote.id, remote);
    }

    const txResult = await this.prisma.$transaction(async (tx) => {
      return applyPaidInTx(tx, this.lifecycle, orderId, {
        kind: 'yookassa',
        remote,
      });
    });

    if (txResult.kind === 'already') return 'already';
    if (txResult.kind === 'paid') {
      if (txResult.isGiftPurchase) {
        await this.notifyGiftPurchasePaid(txResult.orderId, txResult.number);
      } else {
        await this.lifecycle.notifyOrderPaid(txResult.email, txResult.number);
      }
      return 'paid';
    }

    return this.refundLatePayment(txResult.order, remote);
  }

  private async notifyGiftPurchasePaid(orderId: string, orderNumber: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        email: true,
        giftPurchaseRecipientEmail: true,
      },
    });
    const certs = await this.prisma.giftCertificate.findMany({
      where: { purchaseOrderId: orderId },
      select: { code: true, faceValue: true, expiresAt: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!order || !certs.length) {
      if (order?.email) {
        await this.lifecycle.notifyOrderPaid(order.email, orderNumber);
      }
      return;
    }
    const mail = giftPurchasePaidEmail({
      orderNumber,
      items: certs.map((c) => ({
        code: c.code,
        faceValue: c.faceValue,
        expiresAt: c.expiresAt,
      })),
      recipientEmail: order.giftPurchaseRecipientEmail || order.email,
      buyerEmail: order.email,
    });
    await this.lifecycle.notifyCustomer(mail);
    // Копия покупателю, если код ушёл другому
    if (
      order.giftPurchaseRecipientEmail &&
      order.giftPurchaseRecipientEmail.toLowerCase() !== order.email.toLowerCase()
    ) {
      await this.lifecycle.notifyCustomer(
        giftBuyerCopyEmail({
          orderNumber,
          recipientEmail: order.giftPurchaseRecipientEmail,
          to: order.email,
        }),
      );
    }
  }

  /** Автовозврат, если деньги пришли после cancel/TTL. */
  private async refundLatePayment(
    order: {
      id: string;
      number: string;
      email: string;
      total: number;
      status: OrderStatus;
    },
    remote: Awaited<ReturnType<YooKassaService['getPayment']>> | null,
  ): Promise<'late_refunded' | 'late_failed'> {
    const paymentId = remote?.id;
    if (!paymentId) {
      await this.reportLatePaymentFailed({
        order,
        paymentId: null,
        amount: order.total,
        reason: 'missing_remote_payment_id',
      });
      return 'late_failed';
    }

    const amountRaw = remote?.amount?.value
      ? Math.round(Number.parseFloat(remote.amount.value))
      : order.total;
    const amount = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : order.total;

    if (!this.yookassa.isConfigured()) {
      await this.reportLatePaymentFailed({
        order,
        paymentId,
        amount,
        reason: 'yookassa_not_configured',
      });
      return 'late_failed';
    }

    try {
      const refund = await this.yookassa.createRefund({
        paymentId,
        amountRub: amount,
        description: `Автовозврат: заказ ${order.number} уже ${order.status}`,
      });
      await this.prisma.payment.updateMany({
        where: { externalId: paymentId },
        data: { status: PaymentStatus.REFUNDED },
      });
      await this.lifecycle.addEvent(this.prisma, {
        orderId: order.id,
        type: 'REFUND',
        message: `Автовозврат ${amount} ₽ (оплата после ${order.status})`,
        meta: {
          amount,
          auto: true,
          refundId: refund.id,
          status: refund.status,
          yookassaPaymentId: paymentId,
        },
      });
      await this.lifecycle.notifyOrderRefund({
        to: order.email,
        orderNumber: order.number,
        amount,
        full: true,
        kind: 'late',
      });
      return 'late_refunded';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.reportLatePaymentFailed({
        order,
        paymentId,
        amount,
        reason: msg,
      });
      return 'late_failed';
    }
  }

  /**
   * Ops-сигнал: деньги списаны, заказ CANCELLED, автовозврат не удался.
   * Лог с префиксом OPS_ALERT (для scrape) + email OPS_ALERT_EMAIL / SUPPORT_EMAIL + событие OPS_ALERT.
   */
  private async reportLatePaymentFailed(input: {
    order: { id: string; number: string; status: OrderStatus };
    paymentId: string | null;
    amount: number;
    reason: string;
  }): Promise<void> {
    const { order, paymentId, amount, reason } = input;
    this.logger.error(
      `OPS_ALERT late_payment_failed orderId=${order.id} number=${order.number} status=${order.status} paymentId=${paymentId ?? 'none'} amount=${amount} reason=${reason}`,
    );

    await this.lifecycle.addEvent(this.prisma, {
      orderId: order.id,
      type: 'OPS_ALERT',
      message: `Автовозврат не удался: ${reason}${paymentId ? ` (payment ${paymentId})` : ''}`,
      meta: {
        lateFailed: true,
        opsAlert: 'late_payment_failed',
        yookassaPaymentId: paymentId,
        amount,
        reason,
      },
    });

    const opsTo = (
      this.config.get<string>('OPS_ALERT_EMAIL') ||
      this.config.get<string>('SUPPORT_EMAIL') ||
      ''
    ).trim();
    if (!opsTo) {
      this.logger.warn(
        'OPS_ALERT late_payment_failed: set OPS_ALERT_EMAIL or SUPPORT_EMAIL for email notify',
      );
      return;
    }
    const site =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      '';
    const adminUrl = site
      ? `${site}/admin/orders/${order.id}`
      : `/admin/orders/${order.id}`;
    await this.lifecycle.notifyCustomer({
      to: opsTo,
      subject: `[OPS] Late payment failed — ${order.number}`,
      text: [
        `Деньги списаны, заказ ${order.number} (${order.id}) в статусе ${order.status}.`,
        `Автовозврат не удался.`,
        `paymentId: ${paymentId ?? '—'}`,
        `amount: ${amount} ₽`,
        `reason: ${reason}`,
        `Админка: ${adminUrl}`,
      ].join('\n'),
      html: `<p><strong>OPS: late_payment_failed</strong></p>
<p>Заказ <strong>${order.number}</strong> (${order.id}) — статус ${order.status}. Деньги списаны, автовозврат не удался.</p>
<ul>
<li>paymentId: ${paymentId ?? '—'}</li>
<li>amount: ${amount} ₽</li>
<li>reason: ${reason}</li>
</ul>
<p><a href="${adminUrl}">Открыть заказ в админке</a></p>`,
    });
  }
}
