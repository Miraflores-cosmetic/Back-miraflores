import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OZON_UNAVAILABLE_MESSAGE, OzonAuthService } from '../ozon/ozon-auth.service';
import { OrderStatus, PaymentStatus, Prisma, ShipmentProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { scheduleAfterRlsCommitWithBypass } from '../rls/rls-after-commit';
import { CatalogPublicService } from '../catalog/catalog.public.service';
import { throwIfSampleCartBlocked } from '../catalog/sample-purchase.errors';
import { assertSampleOrderLinesAllowedInTx } from '../catalog/sample-purchase.util';
import { PromoPublicService } from '../promo/promo.service';
import { promoConsumingRedemptionWhere } from '../promo/promo-redemption.util';
import { GiftCertificatesPublicService } from '../gift-certificates/gift-certificates.public.service';
import {
  holdGiftCertificateForOrder,
} from '../gift-certificates/gift-certificate-hold.util';
import { SettingsPublicService } from '../settings/settings.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { AdminCreateOrderDto } from './dto/admin-create-order.dto';
import { createAdminOrder, previewAdminOrder } from './create-admin-order';
import { cancelUnpaidOrderInTx } from './cancel-unpaid-order';
import { cancelPendingAtProviders } from './cancel-pending-at-providers';
import { nextYandexPayMerchantOrderId } from './yandex-pay-order-id';
import { buildYandexPayFiscalCart } from './yandex-pay-fiscal-cart';
import {
  reserveStockForLines,
} from './order-stock';
import { lockOrderForUpdate } from './order-lock';
import {
  DELIVERY_SURCHARGE_DEFAULTS,
  normalizeDeliverySurchargeRow,
} from './delivery-surcharge';
import {
  resolveShippingFromQuote,
  buildQuoteCost,
  resolvePvzCode,
  requireCheckoutShipmentProvider,
  goodsSubtotalForFreePvzThreshold,
} from './order-shipping.resolve';
import {
  buildAddressClarificationComment,
  hasAddressClarificationEvidence,
} from './address-clarification';
import {
  hashCartLines,
  hashShippingAddress,
  ShippingQuoteService,
} from './shipping-quote.service';
import { ShippingServerEstimateService } from './shipping-server-estimate.service';
import type { ShippingQuoteRequestDto } from './dto/shipping-quote.dto';
import { applyPaidInTx } from './mark-order-paid';
import { canMarkPaid } from './order-transitions';
import { YooKassaService } from './yookassa.service';
import { YandexPayService } from './yandex-pay.service';
import { OrderPayTokenService } from './order-pay-token.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderChatService } from '../order-chat/order-chat.service';
import { formatPhoneE164, isValidPhone } from '../common/phone.util';
import {
  GIFT_PURCHASE_SKU,
  assertGiftDenomCartNotMixedWithPhysical,
  giftPurchaseSkuForDenom,
  parseGiftDenomCartVariantId,
  parseGiftPurchaseSkuDenomId,
} from '../gift-certificates/gift-certificate-purchase.util';

import { allocateNextOrderNumber } from './order-number';
import { shouldSyncOrderToYourich } from '../yourich/yourich-lead';
import { YourichSyncService } from '../yourich/yourich-sync.service';
import { YourichClient } from '../yourich/yourich.client';
import { normalizeReferralCode } from '../referral/referral-code';
import {
  resolveReferralAttribution,
  shippingFingerprintFromJson,
} from '../referral/referral-attribution';
import {
  enqueueReferralTouchInTx,
  scheduleReferralTouch,
} from '../referral/referral-touch';
import { ReferralCodeService } from '../referral/referral-code.service';
import { ReferralWalletService } from '../referral/referral-wallet.service';
import { ReferralStickyService } from '../referral/referral-sticky.service';

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
  isSample?: boolean;
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
    private readonly yandexPay: YandexPayService,
    private readonly config: ConfigService,
    private readonly payTokens: OrderPayTokenService,
    private readonly shippingQuotes: ShippingQuoteService,
    private readonly shippingServerEstimate: ShippingServerEstimateService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly orderChat: OrderChatService,
    @Optional() private readonly ozonAuth?: OzonAuthService,
    @Optional() private readonly yourichSync?: YourichSyncService,
    @Optional() private readonly yourichClient?: YourichClient,
    @Optional() private readonly referralWallet?: ReferralWalletService,
    @Optional() private readonly referralSticky?: ReferralStickyService,
    @Optional() private readonly referralCodes?: ReferralCodeService,
  ) {}

  private scheduleReferralTouch(orderId: string) {
    scheduleReferralTouch(this.prisma, this.referralWallet, orderId);
  }

  /**
   * Подарки благодарности по порогу суммы товаров **после промокода**.
   * Клиентские isGift-линии не принимаем: аттач только с сервера через getApplicableGift.
   * OOS / inactive на отдельном варианте — soft skip этого item; пустой список — без подарков.
   */
  private async resolveGratitudeGiftLines(
    goodsAfterPromo: number,
  ): Promise<SyncedCartItem[]> {
    const gift = await this.settingsPublic.getApplicableGift(goodsAfterPromo);
    const previewItems =
      gift.applicable && Array.isArray(gift.items) && gift.items.length > 0
        ? gift.items
        : gift.applicable && gift.variantId
          ? [
              {
                variantId: gift.variantId,
                quantity: gift.quantity ?? 1,
                productName: gift.productName,
              },
            ]
          : [];
    if (previewItems.length === 0) return [];

    const variantIds = [...new Set(previewItems.map((i) => i.variantId).filter(Boolean))];
    const variants = await this.prisma.productVariant.findMany({
      where: {
        id: { in: variantIds },
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
    const byId = new Map(variants.map((v) => [v.id, v]));

    const lines: SyncedCartItem[] = [];
    for (const preview of previewItems) {
      const variant = byId.get(preview.variantId);
      if (!variant) {
        this.logger.warn(
          `Gratitude gift skipped: variant missing/inactive (${preview.variantId})`,
        );
        continue;
      }
      const qty = Math.max(1, preview.quantity ?? 1);
      const available = Math.max(0, variant.stock - variant.stockReserve);
      if (available < qty) {
        this.logger.warn(
          `Gratitude gift skipped: OOS for ${variant.id} (need ${qty}, available ${available})`,
        );
        continue;
      }
      lines.push({
        variantId: variant.id,
        shadeId: null,
        shadeName: null,
        name: variant.product.name,
        variantName: variant.name,
        sku: variant.sku?.trim() || `gift-${variant.id}`,
        price: 0,
        qty,
        isGratitudeGift: true,
      });
    }
    return lines;
  }

  /**
   * 0 ₽ после промо/сертификата/кошелька: без ЮKassa, сразу PAID.
   * Иначе create успевает, а pay падает → «висяк» AWAITING_PAYMENT в админке.
   */
  private async finalizeZeroTotalCheckoutIfNeeded(
    orderId: string,
  ): Promise<ReturnType<OrdersPublicService['serializeCreated']> & {
    alreadyPaid: true;
  } | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order || order.needsAddressClarification || order.total > 0) {
      return null;
    }
    if (
      order.status === OrderStatus.PAID ||
      order.status === OrderStatus.PACKING ||
      order.status === OrderStatus.SHIPPED ||
      order.status === OrderStatus.DELIVERED
    ) {
      return { ...this.serializeCreated(order), alreadyPaid: true };
    }
    if (!canMarkPaid(order.status)) {
      return null;
    }
    await this.markOrderPaid(order.id, null);
    const refreshed = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!refreshed) return null;
    return { ...this.serializeCreated(refreshed), alreadyPaid: true };
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
    referralWalletAmount?: number;
    total: number;
    promoCode: string | null;
    giftCertificateCode: string | null;
    guestId: string | null;
    items: unknown;
    needsAddressClarification?: boolean | null;
  }) {
    const guestId = order.guestId?.trim() || '';
    const needsClarification = Boolean(order.needsAddressClarification);
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      email: order.email,
      phone: order.phone,
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      giftCertificateAmount: order.giftCertificateAmount,
      referralWalletAmount: order.referralWalletAmount ?? 0,
      total: order.total,
      promoCode: order.promoCode,
      giftCertificateCode: order.giftCertificateCode,
      items: order.items,
      needsAddressClarification: needsClarification,
      /**
       * HMAC для pay / status / abandon.
       * Пока needsAddressClarification — не выдаём: оплата заблокирована.
       */
      payToken:
        guestId && !needsClarification
          ? this.payTokens.issue(order.id, guestId)
          : null,
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
   * Доступ к checkout-status / pay: payToken (гость) или JWT buyer (userId заказа).
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

  private assertOrderPayAccess(
    order: { id: string; guestId: string | null; userId: string | null },
    opts: { payToken?: string | null; buyerUserId?: string | null },
  ) {
    this.assertCheckoutStatusAccess(order, opts);
  }

  private async loadDeliverySurcharges() {
    const row = await this.prisma.deliverySettings.findUnique({
      where: { id: 'default' },
      select: {
        cdekSurchargeKind: true,
        cdekSurchargeValue: true,
        ozonSurchargeKind: true,
        ozonSurchargeValue: true,
        yandexSurchargeKind: true,
        yandexSurchargeValue: true,
      },
    });
    if (!row) return { ...DELIVERY_SURCHARGE_DEFAULTS };
    return normalizeDeliverySurchargeRow(row);
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
    throwIfSampleCartBlocked(synced.removedLines);
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

    let promoDiscountForFreePvz = 0;
    const promoRaw = dto.promoCode?.trim();
    if (promoRaw) {
      if (synced.pricing && !synced.pricing.allowPromoCodes) {
        throw new BadRequestException('Промокод недоступен для вашей группы');
      }
      const guestId = dto.guestId?.trim() || '';
      if (!guestId) {
        throw new BadRequestException('guestId обязателен при расчёте с промокодом');
      }
      const email = dto.email?.trim() || '';
      const phone = dto.phone?.trim() || '';
      const scopeLines = items
        .filter((l) => !(l as { isGiftDenom?: boolean }).isGiftDenom)
        .map((l) => ({
          productId: (l as { productId?: string }).productId ?? '',
          categoryId: (l as { categoryId?: string }).categoryId ?? '',
          amount: Math.max(0, Math.floor(l.price * l.qty)),
        }))
        .filter((l) => l.productId && l.categoryId);
      const promoApply = await this.promoPublic.applyForCheckout(
        promoRaw,
        subtotal,
        {
          email,
          phone,
          userId: userId ?? null,
          guestId,
        },
        scopeLines,
      );
      promoDiscountForFreePvz = promoApply.discountAmount;
    }
    const goodsSubtotalForFreePvz = goodsSubtotalForFreePvzThreshold(
      subtotal,
      promoDiscountForFreePvz,
    );

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

    if (
      requireCheckoutShipmentProvider(dto.shippingMethod) === 'OZON' &&
      this.ozonAuth &&
      !(await this.ozonAuth.isConnected())
    ) {
      throw new BadRequestException(OZON_UNAVAILABLE_MESSAGE);
    }

    const surcharges = await this.loadDeliverySurcharges();

    const { cost, method, freePvz } = buildQuoteCost({
      shippingMethod: dto.shippingMethod,
      shippingComment: shippingAddress.comment,
      pvzCode: shippingAddress.pvzCode,
      goodsSubtotal: goodsSubtotalForFreePvz,
      freeShippingThresholdRub,
      clientEstimate: dto.clientEstimate,
      serverEstimate: await this.shippingServerEstimate.estimate({
        method: requireCheckoutShipmentProvider(dto.shippingMethod),
        shippingAddress,
        lines: items.map((l) => ({ variantId: l.variantId, qty: l.qty })),
      }),
      requireServerReprice:
        dto.shippingMethod.trim().toUpperCase() === 'OZON' ||
        (this.shippingServerEstimate.requireServerReprice() &&
          dto.shippingMethod.trim().toUpperCase() === 'CDEK' &&
          this.shippingServerEstimate.isCdekConfigured()),
      surcharges,
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
      goodsSubtotal: goodsSubtotalForFreePvz,
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

    const existing = await this.prisma.order.findUnique({
      where: { idempotencyKey },
      include: { items: true },
    });
    if (existing) {
      this.assertIdempotentGuest(existing, guestId);
      const finalized = await this.finalizeZeroTotalCheckoutIfNeeded(existing.id);
      if (finalized) return finalized;
      return this.serializeCreated(existing);
    }

    const synced = await this.catalogPublic.syncCartLines(dto.lines ?? [], userId ?? null);
    throwIfSampleCartBlocked(synced.removedLines);
    const items = synced.items;
    if (!items.length) {
      throw new BadRequestException('Корзина пуста или позиции недоступны');
    }

    const { giftOnly } = assertGiftDenomCartNotMixedWithPhysical(items);
    const wantsAddressClarification =
      Boolean(dto.needsAddressClarification) && !giftOnly;
    // Не доверяем одному boolean — иначе spoof = skip shippingQuote.
    const needsAddressClarification =
      wantsAddressClarification &&
      hasAddressClarificationEvidence({
        comment: dto.shippingAddress?.comment,
        address: dto.shippingAddress?.address,
      });
    if (wantsAddressClarification && !needsAddressClarification) {
      throw new BadRequestException(
        'Некорректный запрос уточнения адреса: нужен маркер в comment или синтетический адрес',
      );
    }

    const city = dto.shippingAddress?.city?.trim() || '';
    const address = dto.shippingAddress?.address?.trim() || '';
    if (!giftOnly && !needsAddressClarification && (!city || !address)) {
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
    const wantWallet = dto.useReferralWallet === true;
    if (promoRaw && giftRaw) {
      throw new BadRequestException(
        'Нельзя применить промокод и сертификат одновременно',
      );
    }
    if (wantWallet && (promoRaw || giftRaw)) {
      throw new BadRequestException(
        'Реферальный баланс нельзя совмещать с промокодом или сертификатом',
      );
    }
    if (wantWallet && !userId) {
      throw new BadRequestException(
        'Чтобы списать реферальный баланс, войдите в аккаунт',
      );
    }

    if (promoRaw) {
      if (synced.pricing && !synced.pricing.allowPromoCodes) {
        throw new BadRequestException('Промокод недоступен для вашей группы');
      }
      const scopeLines = items
        .filter((l) => !(l as { isGiftDenom?: boolean }).isGiftDenom)
        .map((l) => ({
          productId: (l as { productId?: string }).productId ?? '',
          categoryId: (l as { categoryId?: string }).categoryId ?? '',
          amount: Math.max(0, Math.floor(l.price * l.qty)),
        }))
        .filter((l) => l.productId && l.categoryId);
      // Precheck вне tx (быстрый UX-reject); лимиты повторно под FOR UPDATE ниже.
      promoApply = await this.promoPublic.applyForCheckout(
        promoRaw,
        subtotal,
        {
          email,
          phone,
          userId: userId ?? null,
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

    /** MF referral (?mf=) — независимо от Yourich; earn в фазе 2. */
    let referralAttribution: {
      code: string;
      referrerUserId: string;
      addressMatchSuspect: boolean;
      addressMatchReason: string | null;
    } | null = null;
    if (!giftOnly) {
      let codeNorm = normalizeReferralCode(dto.referral?.code);
      // Sticky: другое устройство / очистка LS — код с User.referredBy* в пределах TTL.
      if (!codeNorm && userId && this.referralSticky) {
        codeNorm = await this.referralSticky.resolveCodeForUser(userId);
      }
      if (codeNorm) {
        const buyerPhones: Array<string | null> = [
          phone,
          dto.shippingAddress?.phone?.trim() || null,
        ];
        if (userId) {
          const buyer = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
              phone: true,
              addresses: { select: { phone: true } },
            },
          });
          if (buyer?.phone) buyerPhones.push(buyer.phone);
          for (const a of buyer?.addresses ?? []) {
            if (a.phone) buyerPhones.push(a.phone);
          }
        }
        const resolved = this.referralCodes
          ? await this.referralCodes.resolveByCode(codeNorm)
          : null;
        const referrerRow = resolved
          ? await this.prisma.user.findUnique({
              where: { id: resolved.userId },
              select: {
                id: true,
                email: true,
                phone: true,
                referralCode: true,
                referralCodeActive: true,
                isActive: true,
                addresses: {
                  select: {
                    phone: true,
                    city: true,
                    address: true,
                    postalCode: true,
                  },
                },
              },
            })
          : await this.prisma.user.findFirst({
              where: { referralCode: codeNorm },
              select: {
                id: true,
                email: true,
                phone: true,
                referralCode: true,
                referralCodeActive: true,
                isActive: true,
                addresses: {
                  select: {
                    phone: true,
                    city: true,
                    address: true,
                    postalCode: true,
                  },
                },
              },
            });
        const referrer = referrerRow
          ? {
              ...referrerRow,
              matchedByCodeAlias: resolved?.matchedByCodeAlias === true,
            }
          : null;
        const referrerPhones: Array<string | null> = [
          referrer?.phone ?? null,
          ...(referrer?.addresses.map((a) => a.phone) ?? []),
        ];
        const buyerPvz =
          resolvePvzCode(
            dto.shippingAddress?.comment,
            dto.shippingAddress?.pvzCode,
          ) || null;
        const profileShipments = (referrer?.addresses ?? []).map((a) => ({
          city: a.city,
          address: a.address,
          postalCode: a.postalCode,
          pvzCode: null as string | null,
        }));
        // Профиль без pvzCode → ПВЗ почти никогда не матчился. Берём прошлые заказы.
        const orderShipments = referrer
          ? (
              await this.prisma.order.findMany({
                where: {
                  userId: referrer.id,
                  shippingAddress: { not: Prisma.DbNull },
                },
                orderBy: { createdAt: 'desc' },
                take: 40,
                select: { shippingAddress: true },
              })
            )
              .map((o) => shippingFingerprintFromJson(o.shippingAddress))
              .filter((s): s is NonNullable<typeof s> => s != null)
          : [];
        referralAttribution = resolveReferralAttribution({
          codeRaw: codeNorm,
          referrer,
          buyerUserId: userId ?? null,
          buyerEmail: email,
          buyerPhones,
          referrerPhones,
          buyerShipping: {
            city: dto.shippingAddress?.city,
            address: dto.shippingAddress?.address,
            postalCode: dto.shippingAddress?.postalCode,
            pvzCode: buyerPvz,
          },
          referrerShipments: [...profileShipments, ...orderShipments],
        });
      }
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

    if (!giftOnly && needsAddressClarification) {
      createComment = buildAddressClarificationComment(
        dto.shippingAddress.comment,
      );
      shippingCost = 0;
      shippingMethod = null;
    } else if (!giftOnly) {
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
        goodsSubtotal: payableAfterPromo,
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

    let referralWalletAmount = 0;
    if (wantWallet && userId && !giftOnly) {
      if (!this.referralWallet) {
        throw new BadRequestException('Реферальный кошелёк временно недоступен');
      }
      const quote = await this.referralWallet.quoteSpend(userId, payableForGift);
      // enabled=false гейтит earn, не spend — баланс можно списать.
      referralWalletAmount = quote.amount;
      if (referralWalletAmount < 1) {
        throw new BadRequestException(
          quote.debt > 0
            ? 'Реферальный баланс заблокирован: есть долг по clawback'
            : 'Недостаточно реферального баланса для списания',
        );
      }
    }

    const total = Math.max(
      0,
      payableForGift - giftCertificateAmount - referralWalletAmount,
    );

    // Подарки благодарности — только к physical-заказам (не к digital gift-denom).
    // Порог — payableAfterPromo (товары после промо), не сырой subtotal.
    const gratitudeGifts = giftOnly
      ? []
      : await this.resolveGratitudeGiftLines(payableAfterPromo);
    const itemsForOrder: SyncedCartItem[] = [
      ...(items as SyncedCartItem[]),
      ...gratitudeGifts,
    ];

    if (gratitudeGifts.length > 0) {
      this.logger.log(
        `Gratitude gifts attached: n=${gratitudeGifts.length} variants=${gratitudeGifts
          .map((g) => g.variantId)
          .join(',')} goodsAfterPromo=${payableAfterPromo}`,
      );
    } else {
      this.logger.log(
        `Gratitude gift not attached for goodsAfterPromo=${payableAfterPromo}`,
      );
    }

    const order = await this.prisma.$transaction(async (tx) => {
      await assertSampleOrderLinesAllowedInTx(tx, userId ?? null, itemsForOrder);

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
              referralWalletAmount,
              subtotal,
              total,
              shippingCost,
              shippingMethod,
              needsAddressClarification,
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
                : needsAddressClarification
                  ? {
                      city: city || '—',
                      address: address || 'Адрес уточнит оператор',
                      apartment:
                        dto.shippingAddress.apartment?.trim() || '',
                      region: dto.shippingAddress.region?.trim() || '',
                      district: dto.shippingAddress.district?.trim() || '',
                      comment: createComment,
                      postalCode:
                        dto.shippingAddress.postalCode?.trim() || '',
                      phone: dto.shippingAddress.phone?.trim() || undefined,
                      recipientName:
                        dto.shippingAddress.recipientName?.trim() ||
                        undefined,
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

      if (referralWalletAmount > 0 && userId && this.referralWallet) {
        await this.referralWallet.holdSpendInTx(tx, {
          userId,
          orderId: created.id,
          amount: referralWalletAmount,
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
              promoCodeRaw: promoApply?.affiliate
                ? promoApply.codeRaw
                : null,
              offerId: this.yourichClient?.fallbackOfferId() ?? null,
              state: 'PENDING',
              nextAttemptAt: new Date(),
            },
          });
        }
      }

      if (referralAttribution) {
        await tx.orderReferralAttribution.create({
          data: {
            orderId: created.id,
            code: referralAttribution.code,
            referrerUserId: referralAttribution.referrerUserId,
            addressMatchSuspect: referralAttribution.addressMatchSuspect,
            addressMatchReason: referralAttribution.addressMatchReason,
          },
        });
      }

      return created;
    });

    if (referralAttribution && userId && this.referralSticky) {
      await this.referralSticky.stampIfEmpty(
        userId,
        referralAttribution.referrerUserId,
      );
    }

    this.assertIdempotentGuest(order, guestId);

    scheduleAfterRlsCommitWithBypass(this.prisma, () =>
      this.orderChat.seedCustomerNoteFromOrder(order.id),
    );
    if (wantYourich && this.yourichSync) {
      scheduleAfterRlsCommitWithBypass(this.prisma, () =>
        this.yourichSync!.touch(order.id),
      );
    }

    // Письмо «ожидает оплаты» — не сразу: через 5 мин / 24 ч / 48 ч (OrdersExpiryWorker).
    // Ops-дубль админу о новом заказе — сразу.
    scheduleAfterRlsCommitWithBypass(this.prisma, () =>
      this.lifecycle.notifyAdminOrderCreated(order.number),
    );

    const finalized = await this.finalizeZeroTotalCheckoutIfNeeded(order.id);
    if (finalized) return finalized;
    return this.serializeCreated(order);
  }

  /**
   * Создание заказа сотрудником: без HMAC quote, guestId/idempotencyKey серверные.
   * @see createAdminOrder
   */
  private adminCreateDeps() {
    return {
      prisma: this.prisma,
      catalogPublic: this.catalogPublic,
      promoPublic: this.promoPublic,
      giftsPublic: this.giftsPublic,
      lifecycle: this.lifecycle,
      orderChat: this.orderChat,
      yourichSync: this.yourichSync,
      yourichClient: this.yourichClient,
      resolveGratitudeGiftLines: (goodsAfterPromo: number) =>
        this.resolveGratitudeGiftLines(goodsAfterPromo),
      logger: this.logger,
    };
  }

  async createAdmin(dto: AdminCreateOrderDto, opts: { actorUserId: string }) {
    return createAdminOrder(this.adminCreateDeps(), dto, opts);
  }

  /** Dry-run того же quote, что createAdmin (promo/gift/overrides). */
  async previewAdmin(dto: AdminCreateOrderDto) {
    return previewAdminOrder(this.adminCreateDeps(), dto);
  }

  /**
   * Гость отменяет неоплаченный заказ (смена корзины / адреса на checkout).
   * Снимает stockReserve + gift CAPTURE (cancelUnpaidOrderInTx).
   *
   * Письмо order_cancelled **не** шлём: пользователь ещё на checkout и сразу
   * создаёт новый заказ — письмо «заказ отменён» в этом UX шум.
   * Авто-отмены нет; письмо шлют только ручная отмена из админки / ЛК
   * (см. docs/emails.md).
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
          pendingPayments: [] as Array<{ provider: string; externalId: string }>,
        };
      }
      this.assertPayTokenAccess(order, payToken);

      const cancelled = await cancelUnpaidOrderInTx(tx, {
        orderId: order.id,
        fromStatus: order.status,
        items: order.items,
        message: 'Заказ отменён (checkout)',
        reason: 'abandon',
        referralWallet: this.referralWallet,
      });
      return {
        id: cancelled.id,
        status: cancelled.status,
        abandoned: true as const,
        pendingPayments: cancelled.pendingPayments,
      };
    });

    if (result.abandoned && result.pendingPayments.length) {
      await cancelPendingAtProviders(result.pendingPayments, {
        yookassa: this.yookassa,
        yandexPay: this.yandexPay,
      });
    }
    if (result.abandoned) {
      scheduleAfterRlsCommitWithBypass(this.prisma, () =>
        this.orderChat.applyRetentionForOrder(result.id, OrderStatus.CANCELLED),
      );
      if (this.yourichSync) {
        scheduleAfterRlsCommitWithBypass(this.prisma, () =>
          this.yourichSync!.touch(result.id),
        );
      }
      this.scheduleReferralTouch(result.id);
    }
    return {
      id: result.id,
      status: result.status,
      abandoned: result.abandoned,
    };
  }

  /** Публичные параметры Web SDK (Merchant ID не секрет). */
  yandexPayPublicConfig() {
    if (!this.yandexPay.isConfigured()) {
      return { enabled: false as const };
    }
    return {
      enabled: true as const,
      merchantId: this.yandexPay.merchantId(),
      env: this.yandexPay.isSandbox() ? 'SANDBOX' : 'PRODUCTION',
    };
  }

  /**
   * Exclusive pay channel: при старте одного провайдера гасим PENDING другого,
   * чтобы оба webhook не довели до двойного списания.
   */
  private async cancelRivalPendingPayments(
    orderId: string,
    active: 'yookassa' | 'yandexpay',
  ): Promise<void> {
    const rivals = await this.prisma.payment.findMany({
      where: {
        orderId,
        status: PaymentStatus.PENDING,
        provider: { not: active },
      },
      select: { id: true, provider: true, externalId: true },
    });
    if (!rivals.length) return;

    const yooIds = rivals
      .filter((p) => p.provider === 'yookassa' && p.externalId)
      .map((p) => p.externalId!);
    const ypIds = rivals
      .filter((p) => p.provider === 'yandexpay' && p.externalId)
      .map((p) => p.externalId!);

    if (yooIds.length) {
      await this.yookassa.cancelPaymentsBestEffort(yooIds);
    }
    if (ypIds.length) {
      await this.yandexPay.cancelOrdersBestEffort(ypIds);
    }

    await this.prisma.payment.updateMany({
      where: {
        orderId,
        status: PaymentStatus.PENDING,
        provider: { not: active },
      },
      data: { status: PaymentStatus.CANCELED },
    });
  }

  /**
   * Создаёт заказ в Яндекс Пэй (Merchant API) → paymentUrl для Web SDK.
   * Merchant orderId = `{Order.id}:{attempt}` (см. yandex-pay-order-id.ts).
   */
  async createYandexPayPayment(
    orderId: string,
    opts: { payToken?: string | null; buyerUserId?: string | null } = {},
  ) {
    if (!this.yandexPay.isConfigured()) {
      throw new BadRequestException('Яндекс Пэй не настроен');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        payments: { orderBy: { createdAt: 'desc' }, take: 8 },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    this.assertOrderPayAccess(order, opts);

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Заказ отменён, оформите заказ заново');
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
    if (order.needsAddressClarification) {
      throw new BadRequestException('Оператор уточняет адрес');
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

    // Exclusive: гасим PENDING ЮKassa до выдачи/reuse ссылки Яндекс Пэй.
    await this.cancelRivalPendingPayments(order.id, 'yandexpay');

    const pendingYp = order.payments.find(
      (p) =>
        p.provider === 'yandexpay' &&
        p.status === PaymentStatus.PENDING &&
        p.confirmationUrl?.trim() &&
        Math.round(Number(p.amount) || 0) === Math.round(order.total),
    );
    if (pendingYp?.confirmationUrl) {
      return {
        alreadyPaid: false as const,
        orderId: order.id,
        number: order.number,
        total: order.total,
        paymentId: pendingYp.externalId || order.id,
        paymentUrl: pendingYp.confirmationUrl,
        payToken:
          order.guestId?.trim()
            ? this.payTokens.issue(order.id, order.guestId.trim())
            : null,
      };
    }

    // Старые PENDING Яндекс Пэй (другая сумма / без url) — cancel перед новым.
    const staleYp = order.payments.filter(
      (p) =>
        p.provider === 'yandexpay' && p.status === PaymentStatus.PENDING,
    );
    if (staleYp.length) {
      await this.yandexPay.cancelOrdersBestEffort(
        staleYp.map((p) => p.externalId!).filter(Boolean),
      );
      await this.prisma.payment.updateMany({
        where: {
          orderId: order.id,
          provider: 'yandexpay',
          status: PaymentStatus.PENDING,
        },
        data: { status: PaymentStatus.CANCELED },
      });
    }

    const site =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      'http://localhost:3000';
    let guestId = order.guestId?.trim() || '';
    if (!guestId) {
      const buyerId = opts.buyerUserId?.trim() || '';
      if (buyerId && order.userId === buyerId) {
        const { randomUUID } = await import('node:crypto');
        guestId = randomUUID();
        await this.prisma.order.update({
          where: { id: order.id },
          data: { guestId },
        });
      } else {
        throw new BadRequestException('Нет guestId для оплаты');
      }
    }

    const returnQs = new URLSearchParams({
      orderId: order.id,
      number: order.number,
    });
    const successUrl = order.giftPurchaseDenominationId
      ? `${site}/certificates/success?${returnQs.toString()}`
      : `${site}/order/success?${returnQs.toString()}`;
    const failUrl = `${site}/order?pay=failed&orderId=${encodeURIComponent(order.id)}`;

    // 54-ФЗ: shipping-as-line / ratio shrink с учётом promo+gift (см. yandex-pay-fiscal-cart).
    const items = buildYandexPayFiscalCart({
      number: order.number,
      total: order.total,
      shippingCost: order.shippingCost,
      giftPurchaseDenominationId: order.giftPurchaseDenominationId,
      items: order.items,
    });
    if (!items.length) {
      throw new BadRequestException('Пустая корзина для Яндекс Пэй');
    }

    // Versioned merchant orderId: `{Order.id}:{attempt}` — не Order.id навсегда
    // (после смены total / rollback тот же id → reject / stuck URL).
    const priorYp = await this.prisma.payment.findMany({
      where: { orderId: order.id, provider: 'yandexpay' },
      select: { externalId: true },
    });
    const yandexOrderId = nextYandexPayMerchantOrderId(
      order.id,
      priorYp.map((p) => p.externalId),
    );

    const { paymentUrl, raw } = await this.yandexPay.createOrder({
      orderId: yandexOrderId,
      orderNumber: order.number,
      customerEmail: order.email,
      amountRub: order.total,
      items,
      redirectUrls: {
        onSuccess: successUrl,
        onError: failUrl,
        onAbort: failUrl,
      },
    });

    await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'yandexpay',
        status: PaymentStatus.PENDING,
        amount: order.total,
        externalId: yandexOrderId,
        confirmationUrl: paymentUrl,
        raw: { yandexPay: raw } as Prisma.InputJsonValue,
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
      paymentId: yandexOrderId,
      paymentUrl,
      payToken: this.payTokens.issue(order.id, guestId),
    };
  }

  /**
   * Ответ по схеме Merchant API: 200 `{status:success}` или 4xx `{status:fail, reasonCode}`.
   * Late (оплата на CANCELLED) после auto-refund → 200; если refund не удался → CONFLICT.
   */
  async handleYandexPayWebhook(jwtToken: string): Promise<{
    httpStatus: number;
    body: {
      status: 'success' | 'fail';
      reasonCode?: string;
      reason?: string;
    };
  }> {
    let payload: Awaited<
      ReturnType<YandexPayService['verifyWebhookJwt']>
    >;
    try {
      payload = await this.yandexPay.verifyWebhookJwt(jwtToken);
    } catch (e) {
      // Доки: 400 + reasonCode (UNAUTHORIZED | TOKEN_EXPIRED | …), не Nest 401 envelope.
      if (e instanceof UnauthorizedException) {
        const r = e.getResponse();
        const obj =
          typeof r === 'object' && r !== null
            ? (r as Record<string, unknown>)
            : {};
        const reasonCode =
          typeof obj.reasonCode === 'string' ? obj.reasonCode : 'UNAUTHORIZED';
        return {
          httpStatus: 400,
          body: {
            status: 'fail',
            reasonCode,
            reason:
              typeof obj.reason === 'string'
                ? obj.reason
                : typeof r === 'string'
                  ? r
                  : undefined,
          },
        };
      }
      throw e;
    }
    if (payload.event !== 'ORDER_STATUS_UPDATED') {
      // OPERATION_STATUS_UPDATED и пр. — ack, без смены заказа.
      return { httpStatus: 200, body: { status: 'success' } };
    }
    const ypOrderId = payload.order?.orderId?.trim();
    const status = payload.order?.paymentStatus;
    if (!ypOrderId) {
      return {
        httpStatus: 400,
        body: {
          status: 'fail',
          reasonCode: 'ORDER_NOT_FOUND',
          reason: 'missing orderId',
        },
      };
    }

    if (status === 'FAILED') {
      await this.prisma.payment.updateMany({
        where: {
          provider: 'yandexpay',
          externalId: ypOrderId,
          status: PaymentStatus.PENDING,
        },
        data: { status: PaymentStatus.CANCELED },
      });
      return { httpStatus: 200, body: { status: 'success' } };
    }

    if (status !== 'CAPTURED') {
      return { httpStatus: 200, body: { status: 'success' } };
    }

    // Не доверяем только webhook — перечитываем заказ в API.
    const remote = await this.yandexPay.getOrder(ypOrderId);
    if (remote.paymentStatus !== 'CAPTURED') {
      return { httpStatus: 200, body: { status: 'success' } };
    }

    const paymentRow = await this.prisma.payment.findFirst({
      where: { provider: 'yandexpay', externalId: ypOrderId },
      select: { orderId: true },
    });
    // Legacy: первые платежи писали externalId = Order.id
    const orderId =
      paymentRow?.orderId ||
      (
        await this.prisma.order.findUnique({
          where: { id: ypOrderId },
          select: { id: true },
        })
      )?.id;
    if (!orderId) {
      return {
        httpStatus: 400,
        body: {
          status: 'fail',
          reasonCode: 'ORDER_NOT_FOUND',
          reason: 'order not found',
        },
      };
    }

    const outcome = await this.markOrderPaidYandex(orderId, {
      id: ypOrderId,
      amountRub: remote.amountRub,
      status: remote.paymentStatus,
      raw: remote.raw,
    });

    if (outcome === 'late_failed') {
      // Осознанный CONFLICT: нотификация CAPTURED на отменённый заказ, auto-refund не прошёл.
      return {
        httpStatus: 400,
        body: {
          status: 'fail',
          reasonCode: 'CONFLICT',
          reason: 'late payment refund failed',
        },
      };
    }
    // paid | already | late_refunded — обработали, стоп ретраев.
    return { httpStatus: 200, body: { status: 'success' } };
  }

  private async markOrderPaidYandex(
    orderId: string,
    remote: {
      id: string;
      amountRub: number | null;
      status?: string;
      raw?: unknown;
    },
  ): Promise<MarkPaidOutcome> {
    const txResult = await this.prisma.$transaction(async (tx) => {
      const paid = await applyPaidInTx(tx, this.lifecycle, orderId, {
        kind: 'yandexpay',
        remote: {
          id: remote.id,
          amountRub: remote.amountRub,
          status: remote.status,
        },
      });
      if (paid.kind === 'paid') {
        await enqueueReferralTouchInTx(tx, this.referralWallet, orderId);
      }
      return paid;
    });

    if (txResult.kind === 'already') return 'already';
    if (txResult.kind === 'paid') {
      if (this.yourichSync) {
        scheduleAfterRlsCommitWithBypass(this.prisma, () =>
          this.yourichSync!.touch(orderId),
        );
      }
      this.scheduleReferralTouch(orderId);
      if (txResult.isGiftPurchase) {
        await this.notifyGiftPurchasePaid(txResult.orderId, txResult.number);
      } else {
        await this.lifecycle.notifyOrderPaid(txResult.email, txResult.number);
      }
      return 'paid';
    }

    // Late: как у ЮKassa — автовозврат через Merchant API.
    return this.refundLateYandexPayment(txResult.order, remote);
  }

  private async refundLateYandexPayment(
    order: {
      id: string;
      number: string;
      email: string;
      total: number;
      status: OrderStatus;
    },
    remote: { id: string; amountRub: number | null },
  ): Promise<'late_refunded' | 'late_failed'> {
    const paymentId = remote.id?.trim();
    if (!paymentId) {
      await this.reportLatePaymentFailed({
        order,
        paymentId: null,
        amount: order.total,
        reason: 'missing_yandexpay_order_id',
        provider: 'yandexpay',
      });
      return 'late_failed';
    }
    const amount =
      remote.amountRub != null && remote.amountRub > 0
        ? Math.round(remote.amountRub)
        : order.total;

    if (!this.yandexPay.isConfigured()) {
      await this.reportLatePaymentFailed({
        order,
        paymentId,
        amount,
        reason: 'yandexpay_not_configured',
        provider: 'yandexpay',
      });
      return 'late_failed';
    }

    try {
      const refund = await this.yandexPay.createRefund({
        merchantOrderId: paymentId,
        amountRub: amount,
        reason: `Автовозврат: заказ ${order.number} уже ${order.status}`,
        externalOperationId: `late-${paymentId}-${Date.now()}`,
      });
      await this.prisma.payment.updateMany({
        where: { externalId: paymentId },
        data: { status: PaymentStatus.REFUNDED },
      });
      await this.lifecycle.addEvent(this.prisma, {
        orderId: order.id,
        type: 'REFUND',
        message: `Автовозврат ${amount} ₽ (Яндекс Пэй, оплата после ${order.status})`,
        meta: {
          amount,
          auto: true,
          provider: 'yandexpay',
          refundId: refund.id,
          status: refund.status,
          yandexPayOrderId: paymentId,
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
        provider: 'yandexpay',
      });
      return 'late_failed';
    }
  }

  /** Создаёт платёж ЮKassa (embedded) для заказа AWAITING_PAYMENT. */
  async createPayment(
    orderId: string,
    opts: { payToken?: string | null; buyerUserId?: string | null } = {},
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, payments: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    this.assertOrderPayAccess(order, opts);

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Заказ отменён, оформите заказ заново');
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

    if (order.needsAddressClarification) {
      throw new BadRequestException('Оператор уточняет адрес');
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

    // Exclusive: гасим PENDING Яндекс Пэй до выдачи/reuse виджета ЮKassa.
    await this.cancelRivalPendingPayments(order.id, 'yookassa');

    const pending = order.payments.find(
      (p) =>
        p.provider === 'yookassa' &&
        p.status === PaymentStatus.PENDING &&
        p.externalId &&
        (p.raw as { confirmationToken?: string } | null)?.confirmationToken,
    );
    if (pending?.externalId) {
      const raw = pending.raw as { confirmationToken?: string } | null;
      // Не отдаём старый confirmationToken, если сумма платежа ≠ order.total
      // (защита от рассинхрона после правок / повторного pay).
      const amountOk = Math.round(Number(pending.amount) || 0) === Math.round(order.total);
      if (raw?.confirmationToken && amountOk) {
        return {
          alreadyPaid: false as const,
          orderId: order.id,
          number: order.number,
          total: order.total,
          paymentId: pending.externalId,
          confirmationToken: raw.confirmationToken,
          payToken:
            order.guestId?.trim()
              ? this.payTokens.issue(order.id, order.guestId.trim())
              : null,
        };
      }
      if (!amountOk) {
        await this.prisma.payment.update({
          where: { id: pending.id },
          data: { status: PaymentStatus.CANCELED },
        });
        await this.yookassa.cancelPaymentsBestEffort([pending.externalId]);
      }
    }

    const site =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      'http://localhost:3000';

    // return_url без payToken: токен живёт в sessionStorage вкладки
    // (см. Front pendingCheckoutOrder / OrderSuccess). Buyer JWT тоже ок на success.
    let guestId = order.guestId?.trim() || '';
    if (!guestId) {
      const buyerId = opts.buyerUserId?.trim() || '';
      if (buyerId && order.userId === buyerId) {
        const { randomUUID } = await import('node:crypto');
        guestId = randomUUID();
        await this.prisma.order.update({
          where: { id: order.id },
          data: { guestId },
        });
      } else {
        throw new BadRequestException('Нет guestId для оплаты');
      }
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
      payToken: this.payTokens.issue(order.id, guestId),
    };
  }

  async paymentStatus(
    externalId: string,
    opts: { payToken?: string | null; buyerUserId?: string | null } = {},
  ) {
    const row = await this.prisma.payment.findFirst({
      where: { externalId },
      include: {
        order: {
          select: {
            id: true,
            number: true,
            status: true,
            guestId: true,
            userId: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Платёж не найден');
    this.assertOrderPayAccess(row.order, opts);

    let lateOutcome: MarkPaidOutcome | null = null;
    let remoteStatus: string | undefined;
    let providerPaid = false;

    if (row.provider === 'yandexpay') {
      const remote = await this.yandexPay.getOrder(externalId);
      remoteStatus = remote.paymentStatus;
      providerPaid = remote.paymentStatus === 'CAPTURED';
      if (providerPaid && row.status !== PaymentStatus.SUCCEEDED) {
        lateOutcome = await this.markOrderPaidYandex(row.orderId, {
          id: externalId,
          amountRub: remote.amountRub,
          status: remote.paymentStatus,
          raw: remote.raw,
        });
      } else if (
        remote.paymentStatus === 'FAILED' &&
        row.status === PaymentStatus.PENDING
      ) {
        await this.prisma.payment.update({
          where: { id: row.id },
          data: {
            status: PaymentStatus.CANCELED,
            raw: remote.raw as Prisma.InputJsonValue,
          },
        });
      }
    } else {
      const remote = await this.yookassa.getPayment(externalId);
      remoteStatus = remote.status;
      providerPaid = Boolean(remote.paid || remote.status === 'succeeded');
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
      status: remoteStatus,
      /** true только если заказ реально в оплаченном/исполняемом статусе */
      paid: orderPaid,
      providerPaid,
      latePayment: late,
      latePaymentRefunded: lateOutcome === 'late_refunded',
      message:
        lateOutcome === 'late_refunded'
          ? 'Заказ уже отменён: платёж принят провайдером, оформлен автовозврат.'
          : lateOutcome === 'late_failed'
            ? 'Заказ уже отменён: платёж прошёл, но автовозврат не удался. Свяжитесь с поддержкой.'
            : undefined,
      orderId: order?.id ?? row.orderId,
      number: order?.number ?? row.order.number,
      orderStatus: order?.status ?? row.order.status,
      total: order?.total,
    };
  }

  /**
   * Success / return URL: синхронизация с ЮKassa или Яндекс Пэй
   * (иначе до webhook UI остаётся unpaid).
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
        total: true,
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
            provider: true,
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
        total: order.total,
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
        total: order.total,
        message:
          order.status === OrderStatus.CANCELLED
            ? 'Заказ отменён.'
            : 'Заказ нельзя подтвердить как оплаченный.',
      };
    }

    let lateOutcome: MarkPaidOutcome | null = null;
    for (const p of order.payments) {
      if (!p.externalId) continue;
      if (p.status === PaymentStatus.SUCCEEDED) continue;
      try {
        if (p.provider === 'yandexpay') {
          const remote = await this.yandexPay.getOrder(p.externalId);
          if (remote.paymentStatus === 'CAPTURED') {
            lateOutcome = await this.markOrderPaidYandex(order.id, {
              id: p.externalId,
              amountRub: remote.amountRub,
              status: remote.paymentStatus,
              raw: remote.raw,
            });
            break;
          }
          if (
            remote.paymentStatus === 'FAILED' &&
            p.status === PaymentStatus.PENDING
          ) {
            await this.prisma.payment.update({
              where: { id: p.id },
              data: {
                status: PaymentStatus.CANCELED,
                raw: remote.raw as Prisma.InputJsonValue,
              },
            });
          }
        } else {
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
        }
      } catch (e) {
        this.logger.warn(
          `checkoutSuccessStatus ${p.provider || 'yookassa'} ${p.externalId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    const fresh = await this.prisma.order.findUnique({
      where: { id: order.id },
      select: { id: true, number: true, status: true, total: true },
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
      total: fresh?.total ?? order.total,
      latePayment: late,
      message: paid
        ? undefined
        : lateOutcome === 'late_refunded'
          ? 'Заказ уже отменён: платёж принят провайдером, оформлен автовозврат.'
          : lateOutcome === 'late_failed'
            ? 'Заказ уже отменён: автовозврат не удался. Свяжитесь с поддержкой.'
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
   * Если заказ уже CANCELLED (abandon / ручная отмена) — late → автовозврат.
   */
  private async markOrderPaid(
    orderId: string,
    remote: Awaited<ReturnType<YooKassaService['getPayment']>> | null,
  ): Promise<MarkPaidOutcome> {
    if (remote?.metadata?.kind === 'surcharge' && remote.id) {
      return this.applySurchargePaymentSucceeded(orderId, remote.id, remote);
    }

    const txResult = await this.prisma.$transaction(async (tx) => {
      const paid = await applyPaidInTx(tx, this.lifecycle, orderId, {
        kind: 'yookassa',
        remote,
      });
      if (paid.kind === 'paid') {
        await enqueueReferralTouchInTx(tx, this.referralWallet, orderId);
      }
      return paid;
    });

    if (txResult.kind === 'already') return 'already';
    if (txResult.kind === 'paid') {
      if (this.yourichSync) {
        scheduleAfterRlsCommitWithBypass(this.prisma, () =>
          this.yourichSync!.touch(orderId),
        );
      }
      this.scheduleReferralTouch(orderId);
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
    const to = order.giftPurchaseRecipientEmail || order.email;
    await this.lifecycle.notifyGiftPurchasePaid({
      to,
      orderNumber,
      items: certs.map((c) => ({
        code: c.code,
        faceValue: c.faceValue,
        expiresAt: c.expiresAt,
      })),
      buyerEmail: order.email !== to ? order.email : undefined,
    });
    if (
      order.giftPurchaseRecipientEmail &&
      order.giftPurchaseRecipientEmail.toLowerCase() !== order.email.toLowerCase()
    ) {
      await this.lifecycle.notifyGiftBuyerCopy({
        to: order.email,
        orderNumber,
        recipientEmail: order.giftPurchaseRecipientEmail,
      });
    }
  }

  /** Автовозврат, если деньги пришли после ручной отмены / abandon. */
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
        provider: 'yookassa',
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
        provider: 'yookassa',
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
        message: `Автовозврат ${amount} ₽ (ЮKassa, оплата после ${order.status})`,
        meta: {
          amount,
          auto: true,
          provider: 'yookassa',
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
        provider: 'yookassa',
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
    provider?: 'yookassa' | 'yandexpay';
  }): Promise<void> {
    const { order, paymentId, amount, reason } = input;
    const provider = input.provider || 'yookassa';
    this.logger.error(
      `OPS_ALERT late_payment_failed orderId=${order.id} number=${order.number} status=${order.status} paymentId=${paymentId ?? 'none'} amount=${amount} provider=${provider} reason=${reason}`,
    );

    await this.lifecycle.addEvent(this.prisma, {
      orderId: order.id,
      type: 'OPS_ALERT',
      message: `Автовозврат не удался (${provider === 'yandexpay' ? 'Яндекс Пэй' : 'ЮKassa'}): ${reason}${paymentId ? ` (payment ${paymentId})` : ''}`,
      meta: {
        lateFailed: true,
        opsAlert: 'late_payment_failed',
        paymentProvider: provider,
        yookassaPaymentId: provider === 'yookassa' ? paymentId : null,
        yandexPayOrderId: provider === 'yandexpay' ? paymentId : null,
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
