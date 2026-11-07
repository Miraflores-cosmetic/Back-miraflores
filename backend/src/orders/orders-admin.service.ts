import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GiftCertificateStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  ShipmentProvider,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { scheduleAfterRlsCommitWithBypass } from '../rls/rls-after-commit';
import { restoreStockOnPaidCancel } from './order-stock';
import { adjustStockForItemEdit } from './order-item-stock-edit';
import { lockOrderForUpdate } from './order-lock';
import { isClarificationComment } from './address-clarification';
import { applyPaidInTx } from './mark-order-paid';
import { cancelUnpaidOrderInTx } from './cancel-unpaid-order';
import { cancelPendingAtProviders } from './cancel-pending-at-providers';
import { YandexPayService } from './yandex-pay.service';
import { CarrierShipmentService } from './carrier-shipment.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { releaseGiftCertificateForOrder, holdGiftCertificateForOrder } from '../gift-certificates/gift-certificate-hold.util';
import {
  analyzeGiftPurchaseSpend,
  assertGiftPurchaseCodesUnusedForRefund,
  revokeGiftCertificatesIssuedByPurchaseOrder,
} from '../gift-certificates/gift-certificate-purchase.util';
import {
  canCancel,
  canDeliver,
  canMarkPaid,
  canRefund,
  canSendTracking,
  canShip,
  canStartPacking,
  parseShipmentProvider,
  remainingRefundable,
} from './order-transitions';
import {
  assertCdekPvzCodePresent,
  assertShippingCommentMatchesCarrier,
  resolvePvzCode,
  type CheckoutCarrier,
} from './order-shipping.resolve';
import { YooKassaService } from './yookassa.service';
import {
  assertOrderEditable,
  balanceAfterTotal,
  formatAddressOneLine,
  isPaidEditableStatus,
  isUnpaidEditableStatus,
  netPaidAmount,
  ORDER_EDITABLE_STATUSES,
  recalcOrderTotal,
  sumSucceededPayments,
} from './order-admin-edit';
import type {
  OrderItemUpdateLineDto,
  OrderItemsUpdateDto,
  OrderRemovePromoDto,
  OrderShippingAddressUpdateDto,
} from './dto/order-admin-actions.dto';
import type { AdminCreateOrderDto } from './dto/admin-create-order.dto';
import { OrderChatService } from '../order-chat/order-chat.service';
import { estimateOzonDelivery } from '../ozon/ozon-tariff';
import { loadOzonTariffLines } from '../ozon/ozon-variant-dims';
import { ozonFlagWhere, ozonRowFlags, parseOzonFlagFilter } from './order-ozon-flags';
import { isManualChecklistStep, serializeChecklistMarks } from './order-checklist';
import {
  buildAwaitingPaymentTimeline,
  remindMailByStageFromEvents,
  resolveAwaitingRemindSchedule,
  type RemindMailByStage,
} from './order-awaiting-payment-schedule';
import { YourichSyncService } from '../yourich/yourich-sync.service';
import { scheduleReferralTouch } from '../referral/referral-touch';
import { ReferralWalletService } from '../referral/referral-wallet.service';
import { OrdersPublicService } from './orders.public.service';

const LIST_MAX = 100;
const LIST_DEFAULT = 20;

type ShippingAddressSnap = {
  city?: string;
  address?: string;
  apartment?: string;
  region?: string;
  district?: string;
  postalCode?: string;
  comment?: string;
  pvzCode?: string;
  phone?: string;
  recipientName?: string;
  carrierQuote?: {
    tariffId?: number | null;
    tariffName?: string | null;
    daysMin?: number | null;
    daysMax?: number | null;
    cost?: number | null;
    method?: string | null;
    freePvz?: boolean;
    source?: string | null;
    estimatedAt?: string | null;
    quoteExp?: number | null;
  };
};

@Injectable()
export class OrdersAdminService {
  private readonly logger = new Logger(OrdersAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly yookassa: YooKassaService,
    private readonly carrier: CarrierShipmentService,
    private readonly config: ConfigService,
    private readonly orderChat: OrderChatService,
    private readonly ordersPublic: OrdersPublicService,
    private readonly yandexPay: YandexPayService,
    @Optional() private readonly yourichSync?: YourichSyncService,
    @Optional() private readonly referralWallet?: ReferralWalletService,
  ) {}

  /** YouRich outbox + MF referral earn/clawback. */
  private scheduleYourichTouch(orderId: string) {
    if (this.yourichSync) {
      scheduleAfterRlsCommitWithBypass(this.prisma, () =>
        this.yourichSync!.touch(orderId),
      );
    }
    scheduleReferralTouch(this.prisma, this.referralWallet, orderId);
  }

  private async enrichEvents(
    events: Array<{
      id: string;
      type: string;
      message: string;
      actorUserId: string | null;
      meta: Prisma.JsonValue;
      createdAt: Date;
    }>,
  ) {
    const actorIds = [
      ...new Set(
        events
          .map((e) => e.actorUserId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const actors =
      actorIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, email: true, displayName: true },
          });
    const byId = new Map(actors.map((u) => [u.id, u]));
    return events.map((e) => {
      const actor = e.actorUserId ? byId.get(e.actorUserId) : null;
      return {
        id: e.id,
        type: e.type,
        message: e.message,
        actorUserId: e.actorUserId,
        createdAt: e.createdAt,
        meta: e.meta ?? null,
        actor: actor
          ? {
              id: actor.id,
              email: actor.email,
              displayName: actor.displayName,
            }
          : null,
      };
    });
  }

  async list(
    opts: {
      q?: string;
      status?: string;
      page?: number;
      limit?: number;
      staffUserId?: string;
      flag?: string;
      unviewedOnly?: boolean;
      /** AWAITING/NEW старше ORDER_AWAITING_TTL — SLA, hold stock/gift до ручной отмены. */
      overdueOnly?: boolean;
      /** Ops backlog: клиент не нашёл адрес — нужно уточнить доставку. */
      clarificationOnly?: boolean;
    } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(LIST_MAX, Math.max(1, opts.limit ?? LIST_DEFAULT));
    const base = this.listWhere(opts.q, opts.status);
    const flag = parseOzonFlagFilter(opts.flag);
    let where: Prisma.OrderWhereInput = flag ? { AND: [base, ozonFlagWhere(flag)] } : base;
    if (opts.unviewedOnly) {
      where = {
        AND: [
          where,
          { adminViewedAt: null, status: OrderStatus.PAID },
        ],
      };
    }
    if (opts.overdueOnly) {
      where = { AND: [where, this.awaitingPaymentOverdueWhere()] };
    }
    if (opts.clarificationOnly) {
      where = { AND: [where, this.addressClarificationWhere()] };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          number: true,
          status: true,
          email: true,
          phone: true,
          customerName: true,
          total: true,
          refundedAmount: true,
          userId: true,
          createdAt: true,
          awaitingPaymentRemindStage: true,
          shippingMethod: true,
          needsAddressClarification: true,
          adminViewedAt: true,
          shipments: { select: { provider: true, tracking: true, carrierCostRub: true } },
        },
      }),
    ]);

    const staffUserId = opts.staffUserId?.trim();
    const orderIds = rows.map((r) => r.id);
    const awaitingIds = rows
      .filter(
        (r) =>
          r.status === OrderStatus.AWAITING_PAYMENT ||
          r.status === OrderStatus.NEW,
      )
      .map((r) => r.id);
    const [chatUnreadByOrderId, chatMessageCountByOrderId, remindMailByOrder] =
      await Promise.all([
        staffUserId && orderIds.length > 0
          ? this.orderChat.unreadOrderChatCountsForStaff(staffUserId, orderIds)
          : Promise.resolve({} as Record<string, number>),
        orderIds.length > 0
          ? this.orderChat.orderChatMessageCountsForOrders(orderIds)
          : Promise.resolve({} as Record<string, number>),
        this.loadRemindMailByOrderIds(awaitingIds),
      ]);

    const awaitingSchedule = resolveAwaitingRemindSchedule({
      get: (k) => this.config.get<string>(k),
    });

    return {
      items: rows.map(({ shipments, adminViewedAt, awaitingPaymentRemindStage, ...r }) => ({
        ...r,
        adminUnviewed: r.status === OrderStatus.PAID && adminViewedAt == null,
        ozon: ozonRowFlags({ status: r.status, shippingMethod: r.shippingMethod, shipments }),
        chatUnreadCount: chatUnreadByOrderId[r.id] ?? 0,
        chatMessageCount: chatMessageCountByOrderId[r.id] ?? 0,
        awaitingPayment: buildAwaitingPaymentTimeline(
          r.createdAt,
          r.status,
          awaitingPaymentRemindStage,
          awaitingSchedule,
          new Date(),
          remindMailByOrder.get(r.id) ?? null,
        ),
      })),
      total,
      page,
      limit,
    };
  }

  /** Счётчики для чипов «Ozon без трека» / «Ozon без факта стоимости» в списке заказов. */
  async ozonFlagCounts(): Promise<{ noTrack: number; noCost: number }> {
    const [noTrack, noCost] = await this.prisma.$transaction([
      this.prisma.order.count({ where: ozonFlagWhere('ozon_no_track') }),
      this.prisma.order.count({ where: ozonFlagWhere('ozon_no_cost') }),
    ]);
    return { noTrack, noCost };
  }

  async unviewedCount() {
    const count = await this.prisma.order.count({
      where: {
        adminViewedAt: null,
        status: OrderStatus.PAID,
      },
    });
    return { count };
  }

  /** Неоплаченные старше TTL — stock/gift hold до ручной отмены. */
  async awaitingPaymentOverdueCount() {
    const count = await this.prisma.order.count({
      where: this.awaitingPaymentOverdueWhere(),
    });
    return { count };
  }

  /** Unpaid с needsAddressClarification — backlog «нужен адрес». */
  async addressClarificationCount() {
    const count = await this.prisma.order.count({
      where: this.addressClarificationWhere(),
    });
    return { count };
  }

  private awaitingPaymentOverdueWhere(): Prisma.OrderWhereInput {
    const schedule = resolveAwaitingRemindSchedule({
      get: (k) => this.config.get<string>(k),
    });
    const cutoff = new Date(Date.now() - schedule.ttlMinutes * 60_000);
    return {
      status: { in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.NEW] },
      createdAt: { lte: cutoff },
    };
  }

  private addressClarificationWhere(): Prisma.OrderWhereInput {
    return {
      needsAddressClarification: true,
      status: { in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.NEW] },
    };
  }

  /** PAYMENT_REMIND.meta → mailStatus по stage (для chips mailed/tone). */
  private async loadRemindMailByOrderIds(
    orderIds: string[],
  ): Promise<Map<string, RemindMailByStage>> {
    const out = new Map<string, RemindMailByStage>();
    if (orderIds.length === 0) return out;
    const events = await this.prisma.orderEvent.findMany({
      where: { orderId: { in: orderIds }, type: 'PAYMENT_REMIND' },
      select: { orderId: true, meta: true },
      orderBy: { createdAt: 'asc' },
    });
    const byOrder = new Map<string, Array<{ meta: unknown }>>();
    for (const ev of events) {
      const list = byOrder.get(ev.orderId) ?? [];
      list.push({ meta: ev.meta });
      byOrder.set(ev.orderId, list);
    }
    for (const [orderId, list] of byOrder) {
      out.set(orderId, remindMailByStageFromEvents(list));
    }
    return out;
  }

  /** Первое открытие карточки сотрудником — снимает заказ с бейджа «новые оплаченные». */
  async markViewed(id: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id, adminViewedAt: null },
      data: { adminViewedAt: new Date() },
    });
  }

  async getById(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        status: true,
        email: true,
        phone: true,
        customerName: true,
        customerNote: true,
        shippingAddress: true,
        shippingMethod: true,
        shippingCost: true,
        needsAddressClarification: true,
        subtotal: true,
        discountTotal: true,
        giftCertificateAmount: true,
        giftCertificateCode: true,
        referralWalletAmount: true,
        giftPurchaseDenominationId: true,
        giftPurchaseRecipientEmail: true,
        total: true,
        refundedAmount: true,
        promoCode: true,
        pricingGroupId: true,
        pricingGroupName: true,
        pricingContext: true,
        guestId: true,
        userId: true,
        createdAt: true,
        updatedAt: true,
        awaitingPaymentRemindStage: true,
        user: {
          select: { id: true, email: true, displayName: true, isActive: true },
        },
        items: {
          select: {
            id: true,
            title: true,
            sku: true,
            qty: true,
            unitPrice: true,
            lineTotal: true,
            isGratitudeGift: true,
            variantId: true,
            shadeId: true,
            shade: {
              select: { id: true, name: true, imageUrl: true },
            },
            variant: {
              select: {
                id: true,
                productId: true,
                product: {
                  select: {
                    id: true,
                    slug: true,
                    name: true,
                    images: {
                      where: { mediaType: 'image' },
                      orderBy: { sortOrder: 'asc' },
                      take: 1,
                      select: { url: true },
                    },
                  },
                },
                galleryLinks: {
                  orderBy: { sortOrder: 'asc' },
                  take: 4,
                  select: {
                    productImage: {
                      select: { url: true, mediaType: true },
                    },
                  },
                },
              },
            },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            provider: true,
            status: true,
            amount: true,
            externalId: true,
            confirmationUrl: true,
            createdAt: true,
            raw: true,
          },
        },
        shipments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            provider: true,
            tracking: true,
            status: true,
            externalId: true,
            createdAt: true,
            carrierCostRub: true,
            carrierCostAt: true,
            estimatedCostRub: true,
            billableGrams: true,
            tariffVersion: true,
          },
        },
        events: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            message: true,
            actorUserId: true,
            meta: true,
            createdAt: true,
          },
        },
        checklistMarks: {
          select: { checklist: true, stepId: true, doneAt: true, doneByUserId: true },
        },
        promoRedemption: { select: { id: true } },
        affiliateLead: {
          select: {
            id: true,
            leadCrmId: true,
            refHash: true,
            extUserId: true,
            promoCodeRaw: true,
            offerId: true,
            leadId: true,
            lastSentEvent: true,
            lastSentSum: true,
            state: true,
            attempts: true,
            nextAttemptAt: true,
            lastError: true,
            lastHttpStatus: true,
            syncedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    const issuedGiftCertificates = order.giftPurchaseDenominationId
      ? await this.prisma.giftCertificate.findMany({
          where: { purchaseOrderId: id },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            code: true,
            faceValue: true,
            balance: true,
            status: true,
            expiresAt: true,
          },
        })
      : [];

    const snap = (order.shippingAddress ?? null) as ShippingAddressSnap | null;
    const paidSucceeded = sumSucceededPayments(order.payments);
    const netPaid = netPaidAmount(order.payments, order.refundedAmount);
    const { balanceDue, refundSuggested } = balanceAfterTotal(
      order.total,
      netPaid,
    );
    const remaining = Math.min(
      remainingRefundable(
        Math.max(order.total, paidSucceeded),
        order.refundedAmount,
      ),
      Math.max(0, paidSucceeded - order.refundedAmount),
    );
    const canEditCore =
      // SKU-checkout и gift-purchase живут в одной Order: флаги через giftPurchase*.
      // Долгосрочно — orderKind / отдельные read-модели (lifecycle mail, edit rules).
      ORDER_EDITABLE_STATUSES.includes(order.status) &&
      !order.giftPurchaseDenominationId;
    const hasShipment = order.shipments.length > 0;
    const giftPurchaseSpend = order.giftPurchaseDenominationId
      ? analyzeGiftPurchaseSpend(issuedGiftCertificates)
      : { unused: true, spentCerts: [], spentTotal: 0 };
    const giftPurchaseRefundBlocked = !giftPurchaseSpend.unused;

    const remindMail =
      order.status === OrderStatus.AWAITING_PAYMENT ||
      order.status === OrderStatus.NEW
        ? (
            await this.loadRemindMailByOrderIds([order.id])
          ).get(order.id) ?? null
        : null;

    const mfReferral = this.referralWallet
      ? await this.referralWallet.getOrderReferralSummary(id)
      : null;

    return {
      id: order.id,
      number: order.number,
      status: order.status,
      email: order.email,
      phone: order.phone,
      customerName: order.customerName,
      customerNote: order.customerNote ?? null,
      shippingAddress: snap
        ? {
            city: snap.city ?? '',
            address: snap.address ?? '',
            apartment: snap.apartment ?? '',
            region: snap.region ?? '',
            district: snap.district ?? '',
            postalCode: snap.postalCode ?? '',
            comment: snap.comment ?? '',
            pvzCode: snap.pvzCode ?? '',
            phone: snap.phone ?? '',
            recipientName: snap.recipientName ?? '',
            carrierQuote: snap.carrierQuote ?? null,
          }
        : null,
      shippingMethod: order.shippingMethod,
      shippingCost: order.shippingCost,
      needsAddressClarification: Boolean(order.needsAddressClarification),
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      giftCertificateAmount: order.giftCertificateAmount,
      giftCertificateCode: order.giftCertificateCode,
      referralWalletAmount: order.referralWalletAmount ?? 0,
      giftPurchaseDenominationId: order.giftPurchaseDenominationId,
      giftPurchaseRecipientEmail: order.giftPurchaseRecipientEmail,
      issuedGiftCertificates,
      giftPurchaseRefundBlocked,
      giftPurchaseSpentTotal: giftPurchaseSpend.spentTotal,
      total: order.total,
      refundedAmount: order.refundedAmount,
      refundRemaining: remaining,
      netPaid,
      balanceDue,
      refundSuggested,
      promoCode: order.promoCode,
      pricingGroupId: order.pricingGroupId,
      pricingGroupName: order.pricingGroupName,
      pricingContext: order.pricingContext,
      guestId: order.guestId,
      userId: order.userId,
      user: order.user
        ? {
            id: order.user.id,
            email: order.user.email,
            displayName: order.user.displayName,
            isActive: order.user.isActive,
          }
        : null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      awaitingPayment: buildAwaitingPaymentTimeline(
        order.createdAt,
        order.status,
        order.awaitingPaymentRemindStage,
        resolveAwaitingRemindSchedule({
          get: (k) => this.config.get<string>(k),
        }),
        new Date(),
        remindMail,
      ),
      hasPromoRedemption: Boolean(order.promoRedemption),
      affiliate: order.affiliateLead
        ? {
            leadCrmId: order.affiliateLead.leadCrmId,
            refHash: order.affiliateLead.refHash,
            extUserId: order.affiliateLead.extUserId,
            promoCodeRaw: order.affiliateLead.promoCodeRaw,
            offerId: order.affiliateLead.offerId,
            leadId: order.affiliateLead.leadId,
            lastSentEvent: order.affiliateLead.lastSentEvent,
            lastSentSum: order.affiliateLead.lastSentSum,
            state: order.affiliateLead.state,
            attempts: order.affiliateLead.attempts,
            nextAttemptAt: order.affiliateLead.nextAttemptAt,
            lastError: order.affiliateLead.lastError,
            lastHttpStatus: order.affiliateLead.lastHttpStatus,
            syncedAt: order.affiliateLead.syncedAt,
          }
        : null,
      /** MF referral wallet — отдельно от YouRich affiliate. */
      mfReferral,
      items: order.items.map((i) => {
        const shadeImageUrl = i.shade?.imageUrl ?? null;
        const variantImageUrl =
          i.variant?.galleryLinks
            ?.map((l) => l.productImage)
            .find((img) => img && img.mediaType === 'image')?.url ?? null;
        const productImageUrl = i.variant?.product?.images?.[0]?.url ?? null;
        return {
          id: i.id,
          title: i.title,
          sku: i.sku,
          qty: i.qty,
          unitPrice: i.unitPrice,
          lineTotal: i.lineTotal,
          isGratitudeGift: Boolean(i.isGratitudeGift),
          variantId: i.variantId,
          shadeId: i.shadeId ?? null,
          shadeName: i.shade?.name ?? null,
          shadeImageUrl,
          imageUrl: shadeImageUrl || variantImageUrl || productImageUrl || null,
          productId: i.variant?.productId ?? i.variant?.product?.id ?? null,
          productSlug: i.variant?.product?.slug ?? null,
        };
      }),
      payments: order.payments.map((p) => {
        const raw = p.raw as { kind?: string } | null;
        return {
          id: p.id,
          provider: p.provider,
          status: p.status,
          amount: p.amount,
          externalId: p.externalId,
          confirmationUrl: p.confirmationUrl,
          kind: raw?.kind ?? null,
          createdAt: p.createdAt,
        };
      }),
      shipments: order.shipments,
      checklist: await this.serializeChecklist(order.checklistMarks ?? []),
      events: await this.enrichEvents(order.events),
      latePaymentFailed: order.events.some((e) => {
        const m = e.meta;
        return (
          m != null &&
          typeof m === 'object' &&
          !Array.isArray(m) &&
          (m as Record<string, unknown>).lateFailed === true
        );
      }),
      actions: {
        canCancel: canCancel(order.status),
        canMarkPaid:
          canMarkPaid(order.status) && !order.needsAddressClarification,
        canStartPacking: canStartPacking(order.status),
        canShip: canShip(order.status),
        canSendTracking: canSendTracking(order.status),
        canDeliver: canDeliver(order.status),
        canRefund:
          canRefund(order.status) &&
          remaining > 0 &&
          !giftPurchaseRefundBlocked,
        canEditAddress: canEditCore && !hasShipment,
        canEditItems: canEditCore,
        canCreateSurcharge:
          canEditCore &&
          isPaidEditableStatus(order.status) &&
          balanceDue > 0,
        /** Неоплаченный заказ: выдать новую redirect-ссылку ЮKassa на актуальный total. */
        canCreateCheckoutPayment:
          canEditCore &&
          isUnpaidEditableStatus(order.status) &&
          !order.giftPurchaseDenominationId &&
          order.total > 0 &&
          !order.needsAddressClarification,
        canRemovePromo:
          canEditCore &&
          !order.giftPurchaseDenominationId &&
          (Boolean(order.promoCode) || order.discountTotal > 0),
      },
      /** @deprecated use actions.canCancel */
      canCancel: canCancel(order.status),
    };
  }

  private async serializeChecklist(
    marks: Array<{ checklist: string; stepId: string; doneAt: Date; doneByUserId: string | null }>,
  ) {
    const ids = [...new Set(marks.map((m) => m.doneByUserId).filter((v): v is string => Boolean(v)))];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, email: true, displayName: true },
        })
      : [];
    return serializeChecklistMarks(marks, new Map(users.map((u) => [u.id, u])));
  }

  /** Отметка ручного шага чеклиста склада — видна всем сменам. */
  async setChecklistMark(
    id: string,
    actorUserId: string,
    input: { checklist: string; stepId: string; done: boolean },
  ) {
    if (!isManualChecklistStep(input.checklist, input.stepId)) {
      throw new BadRequestException('Неизвестный шаг чеклиста');
    }
    const order = await this.prisma.order.findUnique({ where: { id }, select: { id: true } });
    if (!order) throw new NotFoundException('Заказ не найден');
    const key = { orderId: id, checklist: input.checklist, stepId: input.stepId };
    if (input.done) {
      await this.prisma.orderChecklistMark.upsert({
        where: { orderId_checklist_stepId: key },
        create: { ...key, doneByUserId: actorUserId },
        update: {},
      });
    } else {
      await this.prisma.orderChecklistMark.deleteMany({ where: key });
    }
    return this.getById(id);
  }

  async markPaid(
    id: string,
    actorUserId: string,
    opts: { notifyCustomer?: boolean } = {},
  ) {
    const notifyCustomer = opts.notifyCustomer !== false;
    const existing = await this.prisma.order.findUnique({
      where: { id },
      select: { needsAddressClarification: true, status: true },
    });
    if (!existing) throw new NotFoundException('Заказ не найден');
    if (existing.needsAddressClarification) {
      throw new BadRequestException(
        'Сначала уточните адрес доставки, затем отметьте заказ оплаченным',
      );
    }
    const result = await this.prisma.$transaction(async (tx) => {
      return applyPaidInTx(tx, this.lifecycle, id, {
        kind: 'admin',
        actorUserId,
      });
    });

    if (result.kind !== 'paid') {
      // already — редкий гонка; всё равно отдаём detail
      return this.getById(id);
    }

    this.scheduleYourichTouch(id);

    if (notifyCustomer) {
      if (result.isGiftPurchase) {
        const order = await this.prisma.order.findUnique({
          where: { id: result.orderId },
          select: {
            email: true,
            giftPurchaseRecipientEmail: true,
          },
        });
        const certs = await this.prisma.giftCertificate.findMany({
          where: { purchaseOrderId: result.orderId },
          select: { code: true, faceValue: true, expiresAt: true },
          orderBy: { createdAt: 'asc' },
        });
        if (order && certs.length) {
          const to = order.giftPurchaseRecipientEmail || order.email;
          await this.lifecycle.notifyGiftPurchasePaid({
            to,
            orderNumber: result.number,
            items: certs.map((c) => ({
              code: c.code,
              faceValue: c.faceValue,
              expiresAt: c.expiresAt,
            })),
            buyerEmail: order.email !== to ? order.email : undefined,
          });
        }
      } else {
        await this.lifecycle.notifyOrderPaid(result.email, result.number);
      }
    }

    return this.getById(id);
  }

  /** Preview итога wizard — тот же quote, что create (без записи). */
  async preview(dto: AdminCreateOrderDto) {
    return this.ordersPublic.previewAdmin(dto);
  }

  /**
   * Staff wizard: create → optional mark-paid / checkout-payment link.
   * mark_paid требует orders_finance (как POST :id/mark-paid).
   * Follow-up после commit не валит весь create: заказ уже есть → paymentError.
   */
  async create(
    dto: AdminCreateOrderDto,
    actorUserId: string,
    opts: { canOrdersFinance?: boolean } = {},
  ) {
    if (dto.payMode === 'mark_paid' && !opts.canOrdersFinance) {
      throw new ForbiddenException(
        'Отметить оплату может только сотрудник с доступом «Заказы: оплата и возвраты»',
      );
    }

    const created = await this.ordersPublic.createAdmin(dto, { actorUserId });
    const notifyCustomer = dto.notifyCustomer !== false;
    let paymentLink: string | null = null;
    let paymentError: string | null = null;

    try {
      if (dto.payMode === 'mark_paid') {
        await this.markPaid(created.id, actorUserId, { notifyCustomer });
      } else if (dto.payMode === 'awaiting_link') {
        // Idempotent create retry / multi-tab: reuse PENDING link if amount matches
        // (не cancel + новый платёж в ЮKassa).
        const withCheckout = await this.createCheckoutPayment(
          created.id,
          actorUserId,
          { notifyCustomer, reuseExisting: true },
        );
        paymentLink =
          (withCheckout as { checkout?: { confirmationUrl?: string } }).checkout
            ?.confirmationUrl ?? null;
      }
    } catch (e) {
      const message =
        e instanceof HttpException
          ? (() => {
              const body = e.getResponse();
              if (typeof body === 'string') return body;
              if (
                body &&
                typeof body === 'object' &&
                'message' in body &&
                (typeof (body as { message: unknown }).message === 'string' ||
                  Array.isArray((body as { message: unknown }).message))
              ) {
                const m = (body as { message: string | string[] }).message;
                return Array.isArray(m) ? m.join('; ') : m;
              }
              return e.message;
            })()
          : e instanceof Error
            ? e.message
            : 'Не удалось завершить оплату';
      this.logger.warn(
        `Admin create follow-up failed order=${created.id} payMode=${dto.payMode}: ${message}`,
      );
      paymentError = message;
      paymentLink = null;
    }

    const order = await this.getById(created.id);
    return { order, paymentLink, paymentError };
  }

  async startPacking(id: string, actorUserId: string) {
    await this.setStatus(id, OrderStatus.PACKING, actorUserId, 'Сборка заказа');
    return this.getById(id);
  }

  async ship(
    id: string,
    actorUserId: string,
    opts: {
      provider?: string;
      tracking?: string;
      registerCarrier?: boolean;
    } = {},
  ) {
    type ShipClaim =
      | {
          mode: 'reuse';
          provider: ShipmentProvider;
          tracking: string | null;
          externalId: string | null;
          shipmentId: string;
          carrierNote: string;
        }
      | {
          mode: 'register';
          provider: ShipmentProvider;
          shipmentId: string;
          orderForCarrier: {
            id: string;
            number: string;
            email: string;
            phone: string;
            customerName: string | null;
            shippingMethod: ShipmentProvider | null;
            shippingAddress: unknown;
            items: Array<{
              title: string;
              sku: string;
              qty: number;
              unitPrice: number;
              isGratitudeGift: boolean;
              variantId: string | null;
            }>;
          };
        }
      | {
          mode: 'manual';
          provider: ShipmentProvider;
          tracking: string | null;
          shipmentId: string | null;
        };

    const claim = await this.prisma.$transaction(async (tx) => {
      await lockOrderForUpdate(tx, id);
      const orderRow = await tx.order.findUnique({
        where: { id },
        include: {
          items: {
            select: {
              title: true,
              sku: true,
              qty: true,
              unitPrice: true,
              isGratitudeGift: true,
              variantId: true,
            },
          },
          shipments: { orderBy: { createdAt: 'desc' }, take: 5 },
        },
      });
      if (!orderRow) throw new NotFoundException('Заказ не найден');
      if (!canShip(orderRow.status)) {
        throw new BadRequestException(
          'Заказ нельзя отправить из текущего статуса',
        );
      }

      const shipments = await this.clearStaleRegisteringShipments(
        tx,
        orderRow.shipments,
      );

      const provider = this.resolveShipmentProvider(
        opts.provider,
        orderRow.shippingMethod,
        orderRow.shippingAddress,
      );
      const tracking = opts.tracking?.trim() || null;

      const existingWithCarrier =
        shipments.find(
          (s) =>
            Boolean(s.externalId) ||
            s.status === 'registered' ||
            s.status === 'shipped',
        ) ?? null;
      const registering = shipments.find((s) => s.status === 'registering');
      if (registering) {
        throw new BadRequestException(
          'Регистрация у перевозчика уже выполняется — подождите или обновите страницу',
        );
      }

      if (existingWithCarrier && !tracking) {
        const t = existingWithCarrier.tracking;
        return {
          mode: 'reuse',
          provider,
          tracking: t,
          externalId: existingWithCarrier.externalId,
          shipmentId: existingWithCarrier.id,
          carrierNote: t
            ? `ранее создано у перевозчика, трек ${t}`
            : 'ранее создано у перевозчика',
        } satisfies ShipClaim;
      }

      if (provider === ShipmentProvider.YANDEX && !tracking) {
        throw new BadRequestException(
          'Для Яндекс Доставки укажите трек-номер. Автосоздание заявки пока не подключено.',
        );
      }
      if (provider === ShipmentProvider.OZON && !tracking) {
        throw new BadRequestException(
          'Для Ozon Доставки укажите номер отправления / трек. Отправление оформляется вручную в кабинете Ozon.',
        );
      }

      const wantRegister =
        !existingWithCarrier &&
        !tracking &&
        provider === ShipmentProvider.CDEK &&
        opts.registerCarrier !== false;

      if (wantRegister) {
        if (!this.carrier.isCdekConfigured()) {
          if (opts.registerCarrier === true) {
            throw new BadRequestException(
              'Не заданы CDEK_ACCOUNT / CDEK_SECURE для автосоздания отправления',
            );
          }
          return {
            mode: 'manual',
            provider,
            tracking: null,
            shipmentId: null,
          } satisfies ShipClaim;
        }

        const placeholder = await tx.shipment.create({
          data: {
            orderId: id,
            provider,
            status: 'registering',
          },
        });
        await tx.order.update({
          where: { id },
          data: { shippingMethod: provider },
        });

        return {
          mode: 'register',
          provider,
          shipmentId: placeholder.id,
          orderForCarrier: {
            id: orderRow.id,
            number: orderRow.number,
            email: orderRow.email,
            phone: orderRow.phone,
            customerName: orderRow.customerName,
            shippingMethod: provider,
            shippingAddress: orderRow.shippingAddress,
            items: orderRow.items,
          },
        } satisfies ShipClaim;
      }

      return {
        mode: 'manual',
        provider,
        tracking,
        shipmentId: existingWithCarrier?.id ?? null,
      } satisfies ShipClaim;
    });

    let tracking: string | null =
      claim.mode === 'manual' || claim.mode === 'reuse' ? claim.tracking : null;
    let externalId: string | null =
      claim.mode === 'reuse' ? claim.externalId : null;
    let raw: Prisma.InputJsonValue | undefined;
    let carrierNote: string | null =
      claim.mode === 'reuse' ? claim.carrierNote : null;
    let shipmentId: string | null =
      claim.mode === 'manual' ? claim.shipmentId : claim.shipmentId;

    if (claim.mode === 'register') {
      try {
        const registered = await this.carrier.register(
          claim.orderForCarrier,
          claim.provider,
        );
        tracking = registered.tracking;
        externalId = registered.externalId;
        raw = registered.raw as Prisma.InputJsonValue;
        carrierNote = tracking
          ? `СДЭК: создано, трек ${tracking}`
          : 'СДЭК: заявка создана (трек появится позже)';
        // Сразу пишем uuid/трек — иначе при ошибке SHIPPED потеряем отправление в СДЭК.
        await this.prisma.shipment.update({
          where: { id: claim.shipmentId },
          data: {
            tracking,
            externalId,
            status: 'registered',
            ...(raw !== undefined ? { raw } : {}),
          },
        });
      } catch (err) {
        await this.prisma.shipment
          .delete({ where: { id: claim.shipmentId } })
          .catch(() => undefined);
        throw err;
      }
    }

    const provider = claim.provider;

    await this.prisma.$transaction(async (tx) => {
      await lockOrderForUpdate(tx, id);
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (!canShip(order.status)) {
        throw new BadRequestException(
          'Заказ нельзя отправить из текущего статуса',
        );
      }

      await tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.SHIPPED,
          shippingMethod: provider,
        },
      });

      if (shipmentId) {
        await tx.shipment.update({
          where: { id: shipmentId },
          data: {
            provider,
            tracking,
            ...(externalId !== null ? { externalId } : {}),
            status: 'shipped',
            ...(raw !== undefined ? { raw } : {}),
          },
        });
      } else {
        await tx.shipment.create({
          data: {
            orderId: id,
            provider,
            tracking,
            externalId,
            status: 'shipped',
            ...(raw !== undefined ? { raw } : {}),
          },
        });
      }

      await this.lifecycle.addEvent(tx, {
        orderId: id,
        type: 'SHIPPED',
        message: carrierNote
          ? `Отправлен (${provider}): ${carrierNote}`
          : tracking
            ? `Отправлен (${provider}), трек: ${tracking}`
            : `Отправлен (${provider})`,
        actorUserId,
        meta: {
          provider,
          tracking,
          externalId,
          carrierRegistered: Boolean(carrierNote),
        },
      });
    });

    // Письмо с треком — отдельная кнопка «Отправить трек-номер» (sendTracking).
    return this.getById(id);
  }

  /**
   * Письмо клиенту с трек-номером (без смены статуса).
   * Трек: из body или последнего shipment; при новом значении — обновляет shipment.
   */
  async sendTracking(
    id: string,
    actorUserId: string,
    opts: { tracking?: string } = {},
  ) {
    const orderRow = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        email: true,
        status: true,
        shipments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, tracking: true },
        },
      },
    });
    if (!orderRow) throw new NotFoundException('Заказ не найден');
    if (!canSendTracking(orderRow.status)) {
      throw new BadRequestException(
        'Письмо с треком доступно после статуса «Отправлен»',
      );
    }

    const fromBody = opts.tracking?.trim() || '';
    const fromShipment = orderRow.shipments[0]?.tracking?.trim() || '';
    const tracking = fromBody || fromShipment;
    if (!tracking) {
      throw new BadRequestException('Укажите трек-номер');
    }

    const shipmentId = orderRow.shipments[0]?.id ?? null;
    if (shipmentId && fromBody && fromBody !== fromShipment) {
      await this.prisma.shipment.update({
        where: { id: shipmentId },
        data: { tracking: fromBody },
      });
    }

    await this.lifecycle.addEvent(this.prisma, {
      orderId: id,
      type: 'TRACKING_SENT',
      message: `Трек отправлен клиенту: ${tracking}`,
      actorUserId,
      meta: { tracking },
    });

    await this.lifecycle.notifyOrderShipped(
      orderRow.email,
      orderRow.number,
      tracking,
    );

    return this.getById(id);
  }

  /**
   * Только регистрация у перевозчика (без смены статуса на SHIPPED).
   * Слот бронируется под FOR UPDATE до HTTP в СДЭК — без гонки двойного create.
   */
  async registerCarrier(
    id: string,
    actorUserId: string,
    opts: { provider?: string } = {},
  ) {
    const claim = await this.prisma.$transaction(async (tx) => {
      await lockOrderForUpdate(tx, id);
      const orderRow = await tx.order.findUnique({
        where: { id },
        include: {
          items: {
            select: {
              title: true,
              sku: true,
              qty: true,
              unitPrice: true,
              isGratitudeGift: true,
              variantId: true,
            },
          },
          shipments: { orderBy: { createdAt: 'desc' }, take: 5 },
        },
      });
      if (!orderRow) throw new NotFoundException('Заказ не найден');
      if (!canShip(orderRow.status)) {
        throw new BadRequestException(
          'Создать отправление можно только в статусе «Сборка»',
        );
      }

      const shipments = await this.clearStaleRegisteringShipments(
        tx,
        orderRow.shipments,
      );

      if (
        shipments.some(
          (s) =>
            Boolean(s.externalId) ||
            s.status === 'registered' ||
            s.status === 'shipped',
        )
      ) {
        throw new BadRequestException(
          'Отправление у перевозчика уже создано — см. shipments',
        );
      }
      if (shipments.some((s) => s.status === 'registering')) {
        throw new BadRequestException(
          'Регистрация у перевозчика уже выполняется — подождите или обновите страницу',
        );
      }

      const resolvedProvider = this.resolveShipmentProvider(
        opts.provider,
        orderRow.shippingMethod,
        orderRow.shippingAddress,
      );

      if (resolvedProvider === ShipmentProvider.PICKUP) {
        throw new BadRequestException(
          'Автосоздание отправления недоступно для самовывоза',
        );
      }
      if (resolvedProvider === ShipmentProvider.YANDEX) {
        throw new BadRequestException(
          'Автосоздание заявки Яндекс Доставки пока не подключено. Укажите трек вручную или зарегистрируйте отправление в кабинете Яндекса.',
        );
      }
      if (resolvedProvider === ShipmentProvider.OZON) {
        throw new BadRequestException(
          'Автосоздание отправления Ozon недоступно. Оформите отправление в кабинете Ozon и укажите трек вручную.',
        );
      }

      const placeholder = await tx.shipment.create({
        data: {
          orderId: id,
          provider: resolvedProvider,
          status: 'registering',
        },
      });
      await tx.order.update({
        where: { id },
        data: { shippingMethod: resolvedProvider },
      });

      return {
        shipmentId: placeholder.id,
        provider: resolvedProvider,
        orderForCarrier: {
          id: orderRow.id,
          number: orderRow.number,
          email: orderRow.email,
          phone: orderRow.phone,
          customerName: orderRow.customerName,
          shippingMethod: resolvedProvider,
          shippingAddress: orderRow.shippingAddress,
          items: orderRow.items,
        },
      };
    });

    let registered;
    try {
      registered = await this.carrier.register(
        claim.orderForCarrier,
        claim.provider,
      );
      await this.prisma.shipment.update({
        where: { id: claim.shipmentId },
        data: {
          provider: registered.provider,
          tracking: registered.tracking,
          externalId: registered.externalId,
          status: 'registered',
          raw: registered.raw as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      await this.prisma.shipment
        .delete({ where: { id: claim.shipmentId } })
        .catch(() => undefined);
      throw err;
    }

    await this.lifecycle.addEvent(this.prisma, {
      orderId: id,
      type: 'CARRIER_REGISTERED',
      message: registered.tracking
        ? `Создано отправление ${registered.provider}, трек: ${registered.tracking}`
        : `Создано отправление ${registered.provider}`,
      actorUserId,
      meta: {
        provider: registered.provider,
        tracking: registered.tracking,
        externalId: registered.externalId,
      },
    });

    return this.getById(id);
  }

  /** Зависший placeholder после краша — можно повторить create. */
  private async clearStaleRegisteringShipments<
    T extends { id: string; status: string | null; createdAt: Date },
  >(tx: Prisma.TransactionClient, shipments: T[]): Promise<T[]> {
    const staleMs = 2 * 60 * 1000;
    const now = Date.now();
    const remaining: T[] = [];
    for (const s of shipments) {
      if (
        s.status === 'registering' &&
        now - s.createdAt.getTime() >= staleMs
      ) {
        await tx.shipment.delete({ where: { id: s.id } });
        continue;
      }
      remaining.push(s);
    }
    return remaining;
  }

  /**
   * Источник службы: явный body → order.shippingMethod → meta в comment.
   * Не молчаливый PICKUP из parseShipmentProvider при пустом provider.
   */
  private resolveShipmentProvider(
    raw: string | undefined | null,
    orderMethod: ShipmentProvider | null,
    shippingAddress: unknown,
  ): ShipmentProvider {
    const v = (raw ?? '').trim().toUpperCase();
    if (v === 'CDEK' || v === 'YANDEX' || v === 'OZON' || v === 'PICKUP') {
      return v as ShipmentProvider;
    }
    if (orderMethod) return orderMethod;

    const comment =
      (shippingAddress as { comment?: string } | null)?.comment || '';
    if (/__(?:JCOS|VSP):carrier=ozon/i.test(comment)) {
      return ShipmentProvider.OZON;
    }
    if (
      /__JCOS:carrier=yandex/i.test(comment) ||
      /__VSP:carrier=yandex/i.test(comment) ||
      /яндекс/i.test(comment)
    ) {
      return ShipmentProvider.YANDEX;
    }
    if (
      /__JCOS:carrier=cdek/i.test(comment) ||
      /__VSP:carrier=cdek/i.test(comment) ||
      /сдэк|cdek/i.test(comment)
    ) {
      return ShipmentProvider.CDEK;
    }

    throw new BadRequestException('Укажите службу доставки');
  }

  async deliver(id: string, actorUserId: string) {
    await this.setStatus(id, OrderStatus.DELIVERED, actorUserId, 'Заказ доставлен');
    this.scheduleYourichTouch(id);
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      select: { number: true, email: true },
    });
    await this.lifecycle.notifyOrderDelivered(order.email, order.number);
    return this.getById(id);
  }

  /** Внутренняя заметка саппорта → OrderEvent type=NOTE. */
  async addNote(id: string, actorUserId: string, message: string) {
    const text = message.trim();
    if (!text) {
      throw new BadRequestException('Введите текст заметки');
    }
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    await this.lifecycle.addEvent(this.prisma, {
      orderId: id,
      type: 'NOTE',
      message: text.slice(0, 2000),
      actorUserId,
    });
    return this.getById(id);
  }

  /**
   * Факт стоимости у перевозчика на последнем отправлении. Для Ozon рядом сохраняется
   * оценка по действующей сетке (billable, версия) — основа сверки тарифа.
   */
  async setShipmentCost(id: string, actorUserId: string, carrierCostRub: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        shippingAddress: true,
        items: { select: { variantId: true, qty: true } },
        shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    const shipment = order.shipments[0];
    if (!shipment) {
      throw new BadRequestException('Сначала отметьте заказ отправленным — стоимость привязывается к отправлению');
    }

    let estimate: Awaited<ReturnType<typeof estimateOzonDelivery>> = null;
    if (shipment.provider === ShipmentProvider.OZON) {
      const comment = String((order.shippingAddress as ShippingAddressSnap | null)?.comment ?? '');
      const dropoff = /(?:^|\|)dropoff=courier(?:\||$|__)/i.test(comment) ? 'courier' : 'pvz';
      const lines = await loadOzonTariffLines(
        this.prisma,
        order.items.map((i) => ({ variantId: i.variantId, qty: i.qty })),
      );
      estimate = estimateOzonDelivery(lines, dropoff);
    }

    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        carrierCostRub,
        carrierCostAt: new Date(),
        estimatedCostRub: estimate?.cost ?? null,
        billableGrams: estimate ? Math.round(estimate.billableKg * 1000) : null,
        tariffVersion: estimate?.tariffVersion ?? null,
      },
    });
    await this.lifecycle.addEvent(this.prisma, {
      orderId: id,
      type: 'CARRIER_COST',
      message: estimate
        ? `Стоимость у перевозчика: ${carrierCostRub} ₽ (по сетке ${estimate.cost} ₽)`
        : `Стоимость у перевозчика: ${carrierCostRub} ₽`,
      actorUserId,
      meta: {
        shipmentId: shipment.id,
        carrierCostRub,
        estimatedCostRub: estimate?.cost ?? null,
        tariffVersion: estimate?.tariffVersion ?? null,
      },
    });
    return this.getById(id);
  }

  /**
   * Отмена неоплаченного заказа (AWAITING/NEW): status → CANCELLED, снимает резерв.
   * Оплаченный — только через refund (полный возврат вернёт сток).
   */
  async cancel(id: string, actorUserId?: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockOrderForUpdate(tx, id);
      const order = await tx.order.findUnique({
        where: { id },
        include: {
          items: true,
          promoRedemption: { select: { id: true, promoCodeId: true } },
        },
      });
      if (!order) throw new NotFoundException('Заказ не найден');

      if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) {
        return {
          ...this.serializeCancel(order),
          promoReleased: false,
          email: null as string | null,
          pendingExternalIds: [] as string[],
          pendingPayments: [] as { provider: string; externalId: string }[],
        };
      }

      if (!canCancel(order.status)) {
        throw new BadRequestException(
          order.status === OrderStatus.PAID || order.status === OrderStatus.PACKING
            ? 'Оплаченный заказ нельзя отменить без возврата — оформите возврат'
            : 'Отгруженный заказ нельзя отменить этим методом',
        );
      }

      const cancelled = await cancelUnpaidOrderInTx(tx, {
        orderId: id,
        fromStatus: order.status,
        items: order.items,
        message: 'Заказ отменён',
        actorUserId: actorUserId ?? null,
        reason: 'admin',
        referralWallet: this.referralWallet,
      });

      return {
        ...this.serializeCancel({
          ...order,
          status: OrderStatus.CANCELLED,
        }),
        promoReleased: Boolean(order.promoRedemption),
        email: order.email,
        number: order.number,
        pendingExternalIds: cancelled.pendingExternalIds,
        pendingPayments: cancelled.pendingPayments,
      };
    });

    if (result.pendingPayments?.length) {
      await cancelPendingAtProviders(result.pendingPayments, {
        yookassa: this.yookassa,
        yandexPay: this.yandexPay,
      });
    } else if (result.pendingExternalIds?.length) {
      await this.yookassa.cancelPaymentsBestEffort(result.pendingExternalIds);
    }

    if (result.email) {
      await this.lifecycle.notifyOrderCancelled(result.email, result.number);
    }

    scheduleAfterRlsCommitWithBypass(this.prisma, () =>
      this.orderChat.applyRetentionForOrder(id, OrderStatus.CANCELLED),
    );
    this.scheduleYourichTouch(id);

    // Полный detail (как packing/ship) — UI делает setOrder(row), slim ломает items/actions.
    const detail = await this.getById(id);
    return { ...detail, promoReleased: result.promoReleased };
  }

  /**
   * Возврат: при providerRefund ЮKassa вызывается внутри tx до записи БД —
   * ошибка PSP откатывает транзакцию (нет «в системе возвращено / на карте нет»).
   *
   * Политика gift/wallet: при redeem/purchase/wallet spend частичный card
   * refund запрещён. RELEASE / revoke — только на полный возврат (нет
   * proportional RELEASE). Ручная правка gift — в admin «Сертификаты».
   */
  async refund(
    id: string,
    actorUserId: string,
    opts: { amount?: number; reason?: string; providerRefund?: boolean } = {},
  ) {
    const outcome = await this.prisma.$transaction(
      async (tx) => {
        await lockOrderForUpdate(tx, id);
        const order = await tx.order.findUnique({
          where: { id },
          include: {
            items: true,
            payments: {
              where: { status: PaymentStatus.SUCCEEDED },
              orderBy: { createdAt: 'desc' },
            },
          },
        });
        if (!order) throw new NotFoundException('Заказ не найден');
        if (!canRefund(order.status)) {
          throw new BadRequestException('Возврат недоступен для этого статуса');
        }

        const remainingCard = Math.min(
          remainingRefundable(
            Math.max(order.total, sumSucceededPayments(order.payments)),
            order.refundedAmount,
          ),
          Math.max(
            0,
            sumSucceededPayments(order.payments) - order.refundedAmount,
          ),
        );
        const giftApplied = (order.giftCertificateAmount ?? 0) > 0;
        const walletApplied = (order.referralWalletAmount ?? 0) > 0;
        const isGiftPurchase = Boolean(order.giftPurchaseDenominationId);
        // Карта уже вся возвращена, но ещё можно открутить redeem / wallet / отозвать purchase-коды.
        if (
          remainingCard <= 0 &&
          !giftApplied &&
          !isGiftPurchase &&
          !walletApplied
        ) {
          throw new BadRequestException('По заказу уже возвращена вся сумма');
        }
        if (remainingCard <= 0 && order.status === OrderStatus.REFUNDED) {
          throw new BadRequestException('По заказу уже возвращена вся сумма');
        }

        let amount: number;
        if (remainingCard <= 0) {
          // gift/wallet-only / card already 0 / purchase revoke: только RELEASE/REVOKE + REFUNDED
          amount = 0;
          if (opts.amount != null && Math.round(opts.amount) !== 0) {
            throw new BadRequestException(
              isGiftPurchase
                ? 'По карте возвращать нечего — оформите полный возврат (0 ₽) для отзыва кодов покупки'
                : walletApplied
                  ? 'По карте возвращать нечего — оформите полный возврат (0 ₽) для RELEASE реф. баланса'
                  : 'По карте возвращать нечего — оформите полный возврат (0 ₽) для открутки сертификата',
            );
          }
        } else {
          amount = opts.amount != null ? Math.round(opts.amount) : remainingCard;
          if (amount < 1 || amount > remainingCard) {
            throw new BadRequestException(
              `Сумма возврата должна быть от 1 до ${remainingCard} ₽`,
            );
          }
          // Политика: gift / wallet / purchase — только полный card refund
          // (нет proportional RELEASE; иначе hold остаётся в подвешенном состоянии).
          if (
            amount < remainingCard &&
            (giftApplied || isGiftPurchase || walletApplied)
          ) {
            throw new BadRequestException(
              giftApplied
                ? 'Заказ с подарочным сертификатом: доступен только полный возврат. Частичный возврат картой не трогает резерв сертификата — оформите полный refund или скорректируйте баланс вручную в «Сертификаты».'
                : walletApplied
                  ? 'Заказ с реферальным балансом: доступен только полный возврат. Частичный возврат картой не делает RELEASE кошелька — оформите полный refund.'
                  : 'Покупка сертификата: доступен только полный возврат (иначе выданные коды не отзовутся). Частичный возврат запрещён.',
            );
          }
        }

        // До PSP: покупка сертификата с уже потраченным кодом — блок (нет clawback).
        if (isGiftPurchase) {
          const issued = await tx.giftCertificate.findMany({
            where: {
              purchaseOrderId: id,
              status: { not: GiftCertificateStatus.REVOKED },
            },
            select: {
              id: true,
              code: true,
              faceValue: true,
              balance: true,
              status: true,
            },
          });
          assertGiftPurchaseCodesUnusedForRefund(issued);
        }

        const wantProvider = opts.providerRefund === true;
        let providerRefundId: string | null = null;
        let providerRefundStatus: string | null = null;
        let providerPaymentId: string | null = null;
        let providerName: string | null = null;

        if (wantProvider) {
          if (amount < 1) {
            throw new BadRequestException(
              'Возврат через провайдера требует сумму ≥ 1 ₽ (для gift-only снимите providerRefund)',
            );
          }
          const pay =
            order.payments.find(
              (p) => p.externalId && p.provider === 'yandexpay',
            ) ||
            order.payments.find(
              (p) => p.externalId && p.provider === 'yookassa',
            ) ||
            order.payments.find((p) => p.externalId);
          if (!pay?.externalId) {
            throw new BadRequestException(
              'Нет успешного платежа провайдера для возврата',
            );
          }
          providerPaymentId = pay.externalId;
          providerName = pay.provider || 'yookassa';
          try {
            if (providerName === 'yandexpay') {
              if (!this.yandexPay.isConfigured()) {
                throw new BadRequestException(
                  'Яндекс Пэй не настроен. Снимите providerRefund или задайте ключи.',
                );
              }
              const refund = await this.yandexPay.createRefund({
                merchantOrderId: pay.externalId,
                amountRub: amount,
                reason: opts.reason ?? `Возврат заказа ${order.number}`,
                externalOperationId: `admin-${id}-${Date.now()}`,
              });
              providerRefundId = refund.id;
              providerRefundStatus = refund.status;
            } else {
              if (!this.yookassa.isConfigured()) {
                throw new BadRequestException(
                  'ЮKassa не настроена. Снимите providerRefund или задайте ключи.',
                );
              }
              const refund = await this.yookassa.createRefund({
                paymentId: pay.externalId,
                amountRub: amount,
                description: opts.reason ?? `Возврат заказа ${order.number}`,
              });
              providerRefundId = refund.id;
              providerRefundStatus = refund.status;
            }
          } catch (e) {
            if (e instanceof BadRequestException) throw e;
            const msg = e instanceof Error ? e.message : String(e);
            throw new BadRequestException(
              `${providerName === 'yandexpay' ? 'Яндекс Пэй' : 'ЮKassa'} отклонил(а) возврат: ${msg}. Учёт в системе не изменён.`,
            );
          }
        }

        const newRefunded = order.refundedAmount + amount;
        const paidSucceeded = sumSucceededPayments(order.payments);
        // Полный возврат: вернули все успешные платежи (или gift/wallet-only / purchase revoke 0₽).
        const full =
          paidSucceeded <= 0
            ? amount === 0 && (giftApplied || isGiftPurchase || walletApplied)
            : newRefunded >= paidSucceeded;
        const nextStatus = full ? OrderStatus.REFUNDED : order.status;

        if (
          full &&
          (order.status === OrderStatus.PAID || order.status === OrderStatus.PACKING)
        ) {
          await restoreStockOnPaidCancel(
            tx,
            order.items.map((i) => ({ variantId: i.variantId, qty: i.qty })),
          );
        }

        let giftReleased = false;
        let purchaseCodesRevoked = 0;
        if (full && giftApplied) {
          giftReleased = await releaseGiftCertificateForOrder(tx, id, {
            note: 'Возврат при полном refund заказа',
          });
        }
        if (full && this.referralWallet) {
          await this.referralWallet.releaseSpendInTx(tx, id, {
            note: 'Возврат реф. баланса при полном refund заказа',
          });
        }
        if (full && isGiftPurchase) {
          purchaseCodesRevoked = await revokeGiftCertificatesIssuedByPurchaseOrder(
            tx,
            id,
            {
              note: 'Отзыв кодов при возврате покупки сертификата',
              actorUserId,
            },
          );
        }

        await tx.order.update({
          where: { id },
          data: {
            refundedAmount: newRefunded,
            status: nextStatus,
          },
        });

        if (full) {
          await tx.payment.updateMany({
            where: { orderId: id, status: PaymentStatus.SUCCEEDED },
            data: { status: PaymentStatus.REFUNDED },
          });
        }

        const viaLabel =
          wantProvider && providerName === 'yandexpay'
            ? 'Яндекс Пэй'
            : wantProvider && providerName === 'yookassa'
              ? 'ЮKassa'
              : null;
        await this.lifecycle.addEvent(tx, {
          orderId: id,
          type: 'REFUND',
          message: full
            ? amount > 0
              ? `Полный возврат ${amount} ₽${viaLabel ? ` (${viaLabel})` : ''}`
              : isGiftPurchase
                ? 'Полный возврат (отзыв кодов покупки)'
                : 'Полный возврат (сертификат)'
            : `Частичный возврат ${amount} ₽${viaLabel ? ` (${viaLabel})` : ''}`,
          actorUserId,
          meta: {
            amount,
            reason: opts.reason ?? null,
            full,
            giftReleased,
            purchaseCodesRevoked,
            providerRequested: wantProvider,
            paymentProvider: providerName,
            providerPaymentId,
            refundId: providerRefundId,
            providerStatus: providerRefundStatus,
          },
        });

        return {
          amount,
          full,
          email: order.email,
          number: order.number,
        };
      },
      { timeout: 45_000 },
    );

    await this.lifecycle.notifyOrderRefund({
      to: outcome.email,
      orderNumber: outcome.number,
      amount: outcome.amount,
      full: outcome.full,
      kind: 'admin',
    });

    if (outcome.full) {
      scheduleAfterRlsCommitWithBypass(this.prisma, () =>
        this.orderChat.applyRetentionForOrder(id, OrderStatus.REFUNDED),
      );
    }
    this.scheduleYourichTouch(id);

    return this.getById(id);
  }

  async updateShippingAddress(
    id: string,
    actorUserId: string,
    dto: OrderShippingAddressUpdateDto,
  ) {
    const notify = dto.notifyCustomer === true;
    const mailPayload: {
      email: string;
      number: string;
      summary: string;
    } = { email: '', number: '', summary: '' };
    let shouldNotify = false;
    let pendingExternalIds: string[] = [];
    let previousTotal = 0;
    let newTotal = 0;
    let addressClarificationCleared = false;

    await this.prisma.$transaction(async (tx) => {
      await lockOrderForUpdate(tx, id);
      const order = await tx.order.findUnique({
        where: { id },
        include: {
          payments: true,
          shipments: { select: { id: true }, take: 1 },
        },
      });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.giftPurchaseDenominationId) {
        throw new BadRequestException('Заказ сертификата нельзя менять');
      }
      assertOrderEditable(order.status);
      if (order.shipments.length > 0) {
        throw new BadRequestException(
          'Адрес нельзя менять после регистрации отправления у перевозчика',
        );
      }

      const before = (order.shippingAddress ?? {}) as ShippingAddressSnap;
      const addressTouched =
        dto.city !== undefined ||
        dto.address !== undefined ||
        dto.apartment !== undefined ||
        dto.region !== undefined ||
        dto.district !== undefined ||
        dto.postalCode !== undefined ||
        dto.comment !== undefined ||
        dto.pvzCode !== undefined ||
        dto.phone !== undefined ||
        dto.recipientName !== undefined ||
        dto.shippingMethod !== undefined;
      const after: ShippingAddressSnap = {
        city: dto.city?.trim() ?? before.city ?? '',
        address: dto.address?.trim() ?? before.address ?? '',
        apartment: dto.apartment?.trim() ?? before.apartment ?? '',
        region: dto.region?.trim() ?? before.region ?? '',
        district: dto.district?.trim() ?? before.district ?? '',
        postalCode: dto.postalCode?.trim() ?? before.postalCode ?? '',
        comment: dto.comment?.trim() ?? before.comment ?? '',
        pvzCode: dto.pvzCode?.trim() ?? before.pvzCode ?? '',
        phone: dto.phone?.trim() ?? before.phone ?? '',
        recipientName: dto.recipientName?.trim() ?? before.recipientName ?? '',
        // Только смена адреса сбрасывает quote; правка суммы — оставляем снимок.
        carrierQuote: addressTouched ? undefined : before.carrierQuote,
      };
      if (!after.city?.trim() || !after.address?.trim()) {
        throw new BadRequestException('Укажите город и адрес');
      }

      let shippingMethod =
        dto.shippingMethod != null
          ? parseShipmentProvider(dto.shippingMethod)
          : order.shippingMethod;

      if (addressTouched) {
        // Синхронизируем pvzCode с мета в comment
        const resolvedPvz = resolvePvzCode(after.comment, after.pvzCode);
        if (resolvedPvz) after.pvzCode = resolvedPvz;

        if (
          /(?:^|\|)dropoff=pvz(?:\||$)/i.test(after.comment || '') &&
          !resolvePvzCode(after.comment, after.pvzCode)
        ) {
          throw new BadRequestException(
            'Укажите пункт выдачи (код ПВЗ обязателен при доставке в ПВЗ)',
          );
        }

        // Метод из comment meta, если DTO method не передан явно
        const jcosCarrier = (after.comment || '').match(
          /__(?:JCOS|VSP):carrier=(cdek|yandex|ozon)/i,
        );
        if (dto.shippingMethod == null && jcosCarrier) {
          const c = jcosCarrier[1].toLowerCase();
          shippingMethod =
            c === 'yandex'
              ? ShipmentProvider.YANDEX
              : c === 'ozon'
                ? ShipmentProvider.OZON
                : ShipmentProvider.CDEK;
        }

        if (
          shippingMethod === ShipmentProvider.CDEK ||
          shippingMethod === ShipmentProvider.YANDEX ||
          shippingMethod === ShipmentProvider.OZON
        ) {
          assertShippingCommentMatchesCarrier(
            after.comment,
            shippingMethod as CheckoutCarrier,
          );
        }
        assertCdekPvzCodePresent({
          shippingMethod,
          comment: after.comment,
          pvzCode: after.pvzCode,
        });
      }

      const shippingCost =
        dto.shippingCost != null
          ? Math.max(0, Math.round(dto.shippingCost))
          : order.shippingCost;
      previousTotal = order.total;
      newTotal = recalcOrderTotal({
        subtotal: order.subtotal,
        discountTotal: order.discountTotal,
        giftCertificateAmount: order.giftCertificateAmount,
        referralWalletAmount: order.referralWalletAmount,
        shippingCost,
      });

      /**
       * Снимаем flag только при реальном перевозчике + без marker.
       * Cost-only / адрес без shippingMethod (и без JCOS meta → method) —
       * намеренно не трогаем: иначе «поправили сумму» обойдёт ops-alert.
       * Admin UI адреса всегда шлёт method+JCOS; API/cost-only — легко промахнуться.
       */
      const clearClarification =
        order.needsAddressClarification &&
        Boolean(shippingMethod) &&
        !isClarificationComment(after.comment);
      if (clearClarification) {
        addressClarificationCleared = true;
      }

      await tx.order.update({
        where: { id },
        data: {
          shippingAddress: after as Prisma.InputJsonValue,
          shippingMethod,
          shippingCost,
          total: newTotal,
          ...(clearClarification ? { needsAddressClarification: false } : {}),
          ...(after.phone ? { phone: after.phone } : {}),
        },
      });

      if (isUnpaidEditableStatus(order.status) && newTotal !== previousTotal) {
        const pending = await tx.payment.findMany({
          where: { orderId: id, status: PaymentStatus.PENDING },
          select: { id: true, externalId: true },
        });
        pendingExternalIds = pending
          .map((p) => p.externalId)
          .filter((x): x is string => Boolean(x));
        if (pending.length) {
          await tx.payment.updateMany({
            where: { orderId: id, status: PaymentStatus.PENDING },
            data: { status: PaymentStatus.CANCELED },
          });
        }
      }

      const summary = addressTouched
        ? `Адрес: ${formatAddressOneLine(before) || '—'} → ${formatAddressOneLine(after)}; доставка ${order.shippingCost} → ${shippingCost} ₽; итого ${previousTotal} → ${newTotal} ₽`
        : `Доставка ${order.shippingCost} → ${shippingCost} ₽; итого ${previousTotal} → ${newTotal} ₽`;
      await this.lifecycle.addEvent(tx, {
        orderId: id,
        type: 'ADDRESS_UPDATED',
        message: addressTouched
          ? `Адрес обновлён (итого ${previousTotal} → ${newTotal} ₽)`
          : `Стоимость доставки изменена (итого ${previousTotal} → ${newTotal} ₽)`,
        actorUserId,
        meta: {
          before,
          after,
          previousTotal,
          total: newTotal,
          shippingCostBefore: order.shippingCost,
          shippingCostAfter: shippingCost,
          costOnly: !addressTouched,
        },
      });

      if (notify) {
        shouldNotify = true;
        mailPayload.email = order.email;
        mailPayload.number = order.number;
        mailPayload.summary = summary;
      }
    });

    if (pendingExternalIds.length) {
      await this.yookassa.cancelPaymentsBestEffort(pendingExternalIds);
    }
    if (shouldNotify && mailPayload.email) {
      await this.lifecycle.notifyOrderUpdated({
        to: mailPayload.email,
        orderNumber: mailPayload.number,
        changesSummary: mailPayload.summary,
      });
    }

    this.scheduleYourichTouch(id);

    const detail = await this.getById(id);
    return {
      ...detail,
      previousTotal,
      newTotal,
      balanceDue: detail.balanceDue,
      refundSuggested: detail.refundSuggested,
      pendingPaymentsCanceled: pendingExternalIds.length > 0,
      addressClarificationCleared,
    };
  }

  async updateItems(
    id: string,
    actorUserId: string,
    dto: OrderItemsUpdateDto,
  ) {
    if (!dto.items?.length) {
      throw new BadRequestException('Состав заказа не может быть пустым');
    }

    const notify = dto.notifyCustomer === true;
    const mailPayload: {
      email: string;
      number: string;
      summary: string;
    } = { email: '', number: '', summary: '' };
    let shouldNotify = false;
    let pendingExternalIds: string[] = [];
    let previousTotal = 0;
    let newTotal = 0;

    await this.prisma.$transaction(async (tx) => {
      await lockOrderForUpdate(tx, id);
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: true, payments: true },
      });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.giftPurchaseDenominationId) {
        throw new BadRequestException('Заказ сертификата нельзя менять');
      }
      assertOrderEditable(order.status);

      const resolved = await this.resolveAdminItemLines(tx, dto.items);
      const subtotal = resolved.reduce((s, l) => s + l.lineTotal, 0);

      // Промо / сертификат / реф. кошелёк «заморожены» при создании — clamp к новому составу.
      const discountTotal = Math.min(
        Math.max(0, order.discountTotal),
        subtotal,
      );
      const payableAfterDiscount = Math.max(
        0,
        subtotal - discountTotal + Math.max(0, order.shippingCost),
      );
      let giftCertificateAmount = Math.min(
        Math.max(0, order.giftCertificateAmount),
        payableAfterDiscount,
      );
      let giftCertificateId = order.giftCertificateId;
      let giftCertificateCode = order.giftCertificateCode;

      // Clamp на любом editable-статусе должен совпадать с ledger (CAPTURE).
      // Иначе PAID/PACKING: order.gift↓, CAPTURE прежний → ложный refundSuggested.
      if (
        order.giftCertificateId &&
        giftCertificateAmount !== order.giftCertificateAmount
      ) {
        await releaseGiftCertificateForOrder(tx, id, {
          note: 'Пересчёт при изменении состава',
        });
        if (giftCertificateAmount > 0) {
          await holdGiftCertificateForOrder(tx, {
            certificateId: order.giftCertificateId,
            orderId: id,
            applyAmount: giftCertificateAmount,
          });
        } else {
          giftCertificateId = null;
          giftCertificateCode = null;
          giftCertificateAmount = 0;
        }
      } else if (giftCertificateAmount <= 0) {
        giftCertificateId = null;
        giftCertificateCode = null;
        giftCertificateAmount = 0;
      }

      const maxWallet = Math.max(0, payableAfterDiscount - giftCertificateAmount);
      let referralWalletAmount = Math.min(
        Math.max(0, order.referralWalletAmount ?? 0),
        maxWallet,
      );
      if (
        this.referralWallet &&
        order.userId &&
        referralWalletAmount !== (order.referralWalletAmount ?? 0)
      ) {
        await this.referralWallet.replaceSpendHoldInTx(tx, {
          userId: order.userId,
          orderId: id,
          amount: referralWalletAmount,
          note: 'Пересчёт при изменении состава',
        });
      } else if (referralWalletAmount <= 0 && (order.referralWalletAmount ?? 0) > 0) {
        if (this.referralWallet) {
          await this.referralWallet.releaseSpendInTx(tx, id, {
            note: 'Снятие реф. баланса при изменении состава',
          });
        }
        referralWalletAmount = 0;
      }

      previousTotal = order.total;
      newTotal = recalcOrderTotal({
        subtotal,
        discountTotal,
        giftCertificateAmount,
        referralWalletAmount,
        shippingCost: order.shippingCost,
      });

      await adjustStockForItemEdit(
        tx,
        order.status,
        order.items.map((i) => ({
          variantId: i.variantId,
          qty: i.qty,
          title: i.title,
        })),
        resolved.map((l) => ({
          variantId: l.variantId,
          qty: l.qty,
          title: l.title,
        })),
      );

      await tx.orderItem.deleteMany({ where: { orderId: id } });
      await tx.orderItem.createMany({
        data: resolved.map((l) => ({
          orderId: id,
          variantId: l.variantId,
          shadeId: l.shadeId,
          title: l.title,
          sku: l.sku,
          qty: l.qty,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
          isGratitudeGift: l.isGratitudeGift,
        })),
      });

      await tx.order.update({
        where: { id },
        data: {
          subtotal,
          total: newTotal,
          discountTotal,
          giftCertificateAmount,
          giftCertificateId,
          giftCertificateCode,
          referralWalletAmount,
        },
      });

      if (isUnpaidEditableStatus(order.status) && newTotal !== previousTotal) {
        const pending = await tx.payment.findMany({
          where: { orderId: id, status: PaymentStatus.PENDING },
          select: { externalId: true },
        });
        pendingExternalIds = pending
          .map((p) => p.externalId)
          .filter((x): x is string => Boolean(x));
        if (pending.length) {
          await tx.payment.updateMany({
            where: { orderId: id, status: PaymentStatus.PENDING },
            data: { status: PaymentStatus.CANCELED },
          });
        }
      }

      const beforeLines = order.items
        .map((i) => `${i.title} ×${i.qty}`)
        .join('; ');
      const afterLines = resolved.map((l) => `${l.title} ×${l.qty}`).join('; ');
      const summary = `Состав: ${beforeLines} → ${afterLines}. Итого ${previousTotal} → ${newTotal} ₽`;

      await this.lifecycle.addEvent(tx, {
        orderId: id,
        type: 'ITEMS_UPDATED',
        message: `Состав обновлён (итого ${previousTotal} → ${newTotal} ₽)`,
        actorUserId,
        meta: {
          previousTotal,
          newTotal,
          discountTotal,
          giftCertificateAmount,
          before: order.items.map((i) => ({
            title: i.title,
            sku: i.sku,
            qty: i.qty,
            unitPrice: i.unitPrice,
            variantId: i.variantId,
            shadeId: i.shadeId,
          })),
          after: resolved.map((l) => ({
            title: l.title,
            sku: l.sku,
            qty: l.qty,
            unitPrice: l.unitPrice,
            variantId: l.variantId,
            shadeId: l.shadeId,
          })),
        },
      });

      if (notify) {
        shouldNotify = true;
        mailPayload.email = order.email;
        mailPayload.number = order.number;
        mailPayload.summary = summary;
      }
    });

    if (pendingExternalIds.length) {
      await this.yookassa.cancelPaymentsBestEffort(pendingExternalIds);
    }
    if (shouldNotify && mailPayload.email) {
      await this.lifecycle.notifyOrderUpdated({
        to: mailPayload.email,
        orderNumber: mailPayload.number,
        changesSummary: mailPayload.summary,
      });
    }

    this.scheduleYourichTouch(id);

    const detail = await this.getById(id);
    return {
      ...detail,
      previousTotal,
      newTotal,
      balanceDue: detail.balanceDue,
      refundSuggested: detail.refundSuggested,
      pendingPaymentsCanceled: pendingExternalIds.length > 0,
    };
  }

  /**
   * Снять промокод с заказа: discountTotal → 0, удаляет redemption (слот лимита),
   * пересчитывает total. Разница → balanceDue / refundSuggested (как updateItems).
   */
  async removePromo(
    id: string,
    actorUserId: string,
    dto: OrderRemovePromoDto = {},
  ) {
    const notify = dto.notifyCustomer === true;
    const mailPayload: {
      email: string;
      number: string;
      summary: string;
    } = { email: '', number: '', summary: '' };
    let shouldNotify = false;
    let pendingExternalIds: string[] = [];
    let previousTotal = 0;
    let newTotal = 0;

    await this.prisma.$transaction(async (tx) => {
      await lockOrderForUpdate(tx, id);
      const order = await tx.order.findUnique({
        where: { id },
        include: {
          payments: true,
          promoRedemption: { select: { id: true, promoCodeId: true } },
        },
      });
      if (!order) throw new NotFoundException('Заказ не найден');
      if (order.giftPurchaseDenominationId) {
        throw new BadRequestException('Заказ сертификата нельзя менять');
      }
      assertOrderEditable(order.status);

      if (!order.promoCode && order.discountTotal <= 0) {
        throw new BadRequestException('На заказе нет промокода');
      }

      const removedCode = order.promoCode;
      const removedDiscount = Math.max(0, order.discountTotal);
      const discountTotal = 0;

      const payableAfterDiscount = Math.max(
        0,
        order.subtotal - discountTotal + Math.max(0, order.shippingCost),
      );
      let giftCertificateAmount = Math.min(
        Math.max(0, order.giftCertificateAmount),
        payableAfterDiscount,
      );
      let giftCertificateId = order.giftCertificateId;
      let giftCertificateCode = order.giftCertificateCode;

      if (
        order.giftCertificateId &&
        giftCertificateAmount !== order.giftCertificateAmount
      ) {
        await releaseGiftCertificateForOrder(tx, id, {
          note: 'Пересчёт при снятии промокода',
        });
        if (giftCertificateAmount > 0) {
          await holdGiftCertificateForOrder(tx, {
            certificateId: order.giftCertificateId,
            orderId: id,
            applyAmount: giftCertificateAmount,
          });
        } else {
          giftCertificateId = null;
          giftCertificateCode = null;
          giftCertificateAmount = 0;
        }
      } else if (giftCertificateAmount <= 0) {
        giftCertificateId = null;
        giftCertificateCode = null;
        giftCertificateAmount = 0;
      }

      const maxWallet = Math.max(0, payableAfterDiscount - giftCertificateAmount);
      let referralWalletAmount = Math.min(
        Math.max(0, order.referralWalletAmount ?? 0),
        maxWallet,
      );
      if (
        this.referralWallet &&
        order.userId &&
        referralWalletAmount !== (order.referralWalletAmount ?? 0)
      ) {
        await this.referralWallet.replaceSpendHoldInTx(tx, {
          userId: order.userId,
          orderId: id,
          amount: referralWalletAmount,
          note: 'Пересчёт при снятии промокода',
        });
      } else if (
        referralWalletAmount <= 0 &&
        (order.referralWalletAmount ?? 0) > 0 &&
        this.referralWallet
      ) {
        await this.referralWallet.releaseSpendInTx(tx, id, {
          note: 'Снятие реф. баланса при снятии промокода',
        });
        referralWalletAmount = 0;
      }

      previousTotal = order.total;
      newTotal = recalcOrderTotal({
        subtotal: order.subtotal,
        discountTotal,
        giftCertificateAmount,
        referralWalletAmount,
        shippingCost: order.shippingCost,
      });

      await tx.promoCodeRedemption.deleteMany({ where: { orderId: id } });

      await tx.order.update({
        where: { id },
        data: {
          promoCode: null,
          discountTotal,
          total: newTotal,
          giftCertificateAmount,
          giftCertificateId,
          giftCertificateCode,
          referralWalletAmount,
        },
      });

      if (isUnpaidEditableStatus(order.status) && newTotal !== previousTotal) {
        const pending = await tx.payment.findMany({
          where: { orderId: id, status: PaymentStatus.PENDING },
          select: { externalId: true },
        });
        pendingExternalIds = pending
          .map((p) => p.externalId)
          .filter((x): x is string => Boolean(x));
        if (pending.length) {
          await tx.payment.updateMany({
            where: { orderId: id, status: PaymentStatus.PENDING },
            data: { status: PaymentStatus.CANCELED },
          });
        }
      }

      const summary = removedCode
        ? `Промокод ${removedCode} снят (−${removedDiscount} ₽). Итого ${previousTotal} → ${newTotal} ₽`
        : `Скидка по промо снята (−${removedDiscount} ₽). Итого ${previousTotal} → ${newTotal} ₽`;

      await this.lifecycle.addEvent(tx, {
        orderId: id,
        type: 'PROMO_REMOVED',
        message: summary,
        actorUserId,
        meta: {
          previousTotal,
          newTotal,
          removedCode,
          removedDiscount,
          giftCertificateAmount,
        },
      });

      if (notify) {
        shouldNotify = true;
        mailPayload.email = order.email;
        mailPayload.number = order.number;
        mailPayload.summary = summary;
      }
    });

    if (pendingExternalIds.length) {
      await this.yookassa.cancelPaymentsBestEffort(pendingExternalIds);
    }
    if (shouldNotify && mailPayload.email) {
      await this.lifecycle.notifyOrderUpdated({
        to: mailPayload.email,
        orderNumber: mailPayload.number,
        changesSummary: mailPayload.summary,
      });
    }

    this.scheduleYourichTouch(id);

    const detail = await this.getById(id);
    return {
      ...detail,
      previousTotal,
      newTotal,
      balanceDue: detail.balanceDue,
      refundSuggested: detail.refundSuggested,
      pendingPaymentsCanceled: pendingExternalIds.length > 0,
    };
  }

  /**
   * Неоплаченный заказ: redirect-ссылка ЮKassa на актуальный total.
   * По умолчанию cancel PENDING + новый платёж (кнопка после правки состава).
   * `reuseExisting: true` — для idempotent admin create: если уже есть PENDING
   * checkout с тем же amount и confirmationUrl, не трогаем ЮKassa.
   */
  async createCheckoutPayment(
    id: string,
    actorUserId: string,
    opts: { notifyCustomer?: boolean; reuseExisting?: boolean } = {},
  ) {
    const notifyCustomer = opts.notifyCustomer !== false;
    if (!this.yookassa.isConfigured()) {
      throw new BadRequestException('ЮKassa не настроена');
    }

    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.giftPurchaseDenominationId) {
      throw new BadRequestException(
        'Для заказа сертификата оплата через эту кнопку недоступна',
      );
    }
    if (order.needsAddressClarification) {
      throw new BadRequestException(
        'Сначала уточните адрес доставки, затем выставьте ссылку на оплату',
      );
    }
    assertOrderEditable(order.status);
    if (!isUnpaidEditableStatus(order.status)) {
      throw new BadRequestException(
        'Новая ссылка на оплату — только для неоплаченных заказов',
      );
    }
    if (order.total < 1) {
      throw new BadRequestException('Сумма заказа 0 ₽ — ссылка не нужна');
    }

    const amount = order.total;
    const pendingCheckout = order.payments.filter(
      (p) =>
        p.status === PaymentStatus.PENDING &&
        p.externalId &&
        p.confirmationUrl?.trim(),
    );

    if (opts.reuseExisting) {
      const reusable = pendingCheckout.find((p) => p.amount === amount);
      if (reusable?.confirmationUrl && reusable.externalId) {
        const detail = await this.getById(id);
        return {
          ...detail,
          checkout: {
            amount,
            confirmationUrl: reusable.confirmationUrl,
            paymentId: reusable.externalId,
            reused: true,
          },
        };
      }
    }

    const stalePending = order.payments.filter(
      (p) => p.status === PaymentStatus.PENDING && p.externalId,
    );
    if (stalePending.length) {
      await this.prisma.payment.updateMany({
        where: {
          orderId: id,
          status: PaymentStatus.PENDING,
        },
        data: { status: PaymentStatus.CANCELED },
      });
      await this.yookassa.cancelPaymentsBestEffort(
        stalePending.map((p) => p.externalId!).filter(Boolean),
      );
    }

    const site =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      'http://localhost:5173';
    const returnQs = new URLSearchParams({
      orderId: order.id,
      number: order.number,
    });
    const returnUrl = `${site}/order/success?${returnQs.toString()}`;

    const { payment, confirmationUrl } =
      await this.yookassa.createRedirectPayment({
        amountRub: amount,
        description: `Оплата заказа ${order.number}`,
        orderId: order.id,
        orderNumber: order.number,
        customerEmail: order.email,
        returnUrl,
        kind: 'checkout',
        receiptItems: [
          {
            description: `Заказ ${order.number}`.slice(0, 128),
            quantity: 1,
            amountRub: amount,
          },
        ],
      });

    await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'yookassa',
        status: PaymentStatus.PENDING,
        amount,
        externalId: payment.id,
        confirmationUrl,
        raw: {
          kind: 'checkout',
          yookassa: payment,
        } as Prisma.InputJsonValue,
      },
    });

    await this.lifecycle.addEvent(this.prisma, {
      orderId: id,
      type: 'NOTE',
      message: `Выставлена ссылка на оплату ${amount} ₽`,
      actorUserId,
      meta: {
        kind: 'checkout',
        amount,
        yookassaPaymentId: payment.id,
        confirmationUrl,
      },
    });

    if (notifyCustomer) {
      await this.lifecycle.notifyOrderUpdated({
        to: order.email,
        orderNumber: order.number,
        changesSummary: `Ссылка на оплату заказа на сумму ${amount} ₽. Оплатите заказ в личном кабинете или по ссылке от поддержки.`,
      });
    }

    const detail = await this.getById(id);
    return {
      ...detail,
      checkout: {
        amount,
        confirmationUrl,
        paymentId: payment.id,
        reused: false,
      },
    };
  }

  async createSurchargePayment(
    id: string,
    actorUserId: string,
    opts: { amount?: number } = {},
  ) {
    if (!this.yookassa.isConfigured()) {
      throw new BadRequestException('ЮKassa не настроена');
    }

    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.giftPurchaseDenominationId) {
      throw new BadRequestException('Для заказа сертификата доплата недоступна');
    }
    assertOrderEditable(order.status);
    if (!isPaidEditableStatus(order.status)) {
      throw new BadRequestException(
        'Доплата доступна только для оплаченных заказов (до отправки)',
      );
    }

    const netPaid = netPaidAmount(order.payments, order.refundedAmount);
    const { balanceDue } = balanceAfterTotal(order.total, netPaid);
    const amount =
      opts.amount != null ? Math.round(opts.amount) : balanceDue;
    if (amount < 1 || amount > balanceDue) {
      throw new BadRequestException(
        balanceDue < 1
          ? 'Доплата не требуется'
          : `Сумма доплаты должна быть от 1 до ${balanceDue} ₽`,
      );
    }

    const site =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      'http://localhost:5173';
    const returnUrl = `${site}/profile`;

    const { payment, confirmationUrl } =
      await this.yookassa.createRedirectPayment({
        amountRub: amount,
        description: `Доплата по заказу ${order.number}`,
        orderId: order.id,
        orderNumber: order.number,
        customerEmail: order.email,
        returnUrl,
        kind: 'surcharge',
        receiptItems: [
          {
            description: `Доплата по заказу ${order.number}`.slice(0, 128),
            quantity: 1,
            amountRub: amount,
          },
        ],
      });

    await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'yookassa',
        status: PaymentStatus.PENDING,
        amount,
        externalId: payment.id,
        confirmationUrl,
        raw: {
          kind: 'surcharge',
          yookassa: payment,
        } as Prisma.InputJsonValue,
      },
    });

    await this.lifecycle.addEvent(this.prisma, {
      orderId: id,
      type: 'NOTE',
      message: `Выставлена доплата ${amount} ₽`,
      actorUserId,
      meta: {
        kind: 'surcharge',
        amount,
        yookassaPaymentId: payment.id,
        confirmationUrl,
      },
    });

    await this.lifecycle.notifyOrderSurcharge({
      to: order.email,
      orderNumber: order.number,
      amount,
      // confirmation URL ЮKassa — только в admin response, не в письме
      paymentUrl: '',
    });

    const detail = await this.getById(id);
    return {
      ...detail,
      surcharge: {
        amount,
        confirmationUrl,
        paymentId: payment.id,
      },
    };
  }

  private async resolveAdminItemLines(
    tx: Prisma.TransactionClient,
    lines: OrderItemUpdateLineDto[],
  ) {
    const out: Array<{
      variantId: string | null;
      shadeId: string | null;
      title: string;
      sku: string;
      qty: number;
      unitPrice: number;
      lineTotal: number;
      isGratitudeGift: boolean;
    }> = [];

    for (const line of lines) {
      const qty = Math.round(line.qty);
      if (qty < 1) {
        throw new BadRequestException('Количество должно быть ≥ 1');
      }
      const variantId = line.variantId?.trim() || null;
      let title = line.title?.trim() || '';
      let sku = line.sku?.trim() || '';
      let unitPrice =
        line.unitPrice != null ? Math.max(0, Math.round(line.unitPrice)) : null;
      const isGratitudeGift = Boolean(line.isGratitudeGift);

      if (variantId) {
        const v = await tx.productVariant.findUnique({
          where: { id: variantId },
          select: {
            id: true,
            sku: true,
            price: true,
            name: true,
            product: { select: { name: true } },
          },
        });
        if (!v) {
          throw new BadRequestException(`Вариант не найден: ${variantId}`);
        }
        if (!title) {
          title = `${v.product.name} — ${v.name}`.trim();
        }
        if (!sku) sku = v.sku;
        if (unitPrice == null) unitPrice = v.price;
      }

      if (!title) {
        throw new BadRequestException('У позиции должно быть название');
      }
      if (unitPrice == null) {
        throw new BadRequestException(`Не задана цена для «${title}»`);
      }
      if (isGratitudeGift) unitPrice = 0;

      out.push({
        variantId,
        shadeId: line.shadeId?.trim() || null,
        title,
        sku: sku || '—',
        qty,
        unitPrice,
        lineTotal: unitPrice * qty,
        isGratitudeGift,
      });
    }

    return out;
  }

  private async setStatus(
    id: string,
    to: OrderStatus,
    actorUserId: string,
    message: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await lockOrderForUpdate(tx, id);
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Заказ не найден');

      if (to === OrderStatus.PACKING && !canStartPacking(order.status)) {
        throw new BadRequestException('Нельзя начать сборку');
      }
      if (to === OrderStatus.DELIVERED && !canDeliver(order.status)) {
        throw new BadRequestException('Нельзя отметить доставленным');
      }

      await tx.order.update({
        where: { id },
        data: { status: to },
      });

      await this.lifecycle.addEvent(tx, {
        orderId: id,
        type: to === OrderStatus.DELIVERED ? 'DELIVERED' : 'STATUS_CHANGED',
        message,
        actorUserId,
        meta: { from: order.status, to },
      });
    });

    scheduleAfterRlsCommitWithBypass(this.prisma, () =>
      this.orderChat.applyRetentionForOrder(id, to),
    );
  }

  private listWhere(q?: string, statusRaw?: string): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {};
    const status = statusRaw?.trim().toUpperCase();
    if (status && (Object.values(OrderStatus) as string[]).includes(status)) {
      where.status = status as OrderStatus;
    }
    const term = q?.trim();
    if (term) {
      where.OR = [
        { number: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
        { customerName: { contains: term, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private serializeCancel(order: {
    id: string;
    number: string;
    status: OrderStatus;
    promoCode: string | null;
    promoRedemption: { id: string; promoCodeId: string } | null;
  }) {
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      promoCode: order.promoCode,
      hasPromoRedemption: Boolean(order.promoRedemption),
    };
  }
}
