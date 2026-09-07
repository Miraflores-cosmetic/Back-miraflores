import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  ShipmentProvider,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  releaseStockReserve,
  reserveStockForLines,
  restoreStockOnPaidCancel,
} from './order-stock';
import { lockOrderForUpdate } from './order-lock';
import { applyPaidInTx } from './mark-order-paid';
import { cancelUnpaidOrderInTx } from './cancel-unpaid-order';
import { CarrierShipmentService } from './carrier-shipment.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { releaseGiftCertificateForOrder } from '../gift-certificates/gift-certificate-hold.util';
import { giftPurchasePaidEmail } from '../gift-certificates/gift-purchase-email';
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
  OrderShippingAddressUpdateDto,
} from './dto/order-admin-actions.dto';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly yookassa: YooKassaService,
    private readonly carrier: CarrierShipmentService,
    private readonly config: ConfigService,
  ) {}

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
    } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(LIST_MAX, Math.max(1, opts.limit ?? LIST_DEFAULT));
    const where = this.listWhere(opts.q, opts.status);

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
        },
      }),
    ]);

    return { items: rows, total, page, limit };
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
        subtotal: true,
        discountTotal: true,
        giftCertificateAmount: true,
        giftCertificateCode: true,
        giftPurchaseDenominationId: true,
        giftPurchaseRecipientEmail: true,
        total: true,
        refundedAmount: true,
        promoCode: true,
        guestId: true,
        userId: true,
        createdAt: true,
        updatedAt: true,
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
            createdAt: true,
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
        promoRedemption: { select: { id: true } },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    void this.prisma.order
      .update({
        where: { id },
        data: { adminViewedAt: new Date() },
      })
      .catch(() => undefined);

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
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      giftCertificateAmount: order.giftCertificateAmount,
      giftCertificateCode: order.giftCertificateCode,
      giftPurchaseDenominationId: order.giftPurchaseDenominationId,
      giftPurchaseRecipientEmail: order.giftPurchaseRecipientEmail,
      total: order.total,
      refundedAmount: order.refundedAmount,
      refundRemaining: remaining,
      netPaid,
      balanceDue,
      refundSuggested,
      promoCode: order.promoCode,
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
      hasPromoRedemption: Boolean(order.promoRedemption),
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
        canMarkPaid: canMarkPaid(order.status),
        canStartPacking: canStartPacking(order.status),
        canShip: canShip(order.status),
        canSendTracking: canSendTracking(order.status),
        canDeliver: canDeliver(order.status),
        canRefund: canRefund(order.status) && remaining > 0,
        canEditAddress: canEditCore && !hasShipment,
        canEditItems: canEditCore,
        canCreateSurcharge:
          canEditCore &&
          isPaidEditableStatus(order.status) &&
          balanceDue > 0,
      },
      /** @deprecated use actions.canCancel */
      canCancel: canCancel(order.status),
    };
  }

  async markPaid(id: string, actorUserId: string) {
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
        const mail = giftPurchasePaidEmail({
          orderNumber: result.number,
          codes: certs.map((c) => c.code),
          faceValue: certs[0]!.faceValue,
          expiresAt: certs[0]!.expiresAt,
          recipientEmail: order.giftPurchaseRecipientEmail || order.email,
          buyerEmail: order.email,
        });
        await this.lifecycle.notifyCustomer(mail);
      }
    } else {
      await this.lifecycle.notifyOrderPaid(result.email, result.number);
    }

    return this.getById(id);
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
    if (v === 'CDEK' || v === 'YANDEX' || v === 'PICKUP') {
      return v as ShipmentProvider;
    }
    if (orderMethod) return orderMethod;

    const comment =
      (shippingAddress as { comment?: string } | null)?.comment || '';
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
      };
    });

    if (result.pendingExternalIds?.length) {
      await this.yookassa.cancelPaymentsBestEffort(result.pendingExternalIds);
    }

    if (result.email) {
      await this.lifecycle.notifyOrderCancelled(result.email, result.number);
    }

    // Полный detail (как packing/ship) — UI делает setOrder(row), slim ломает items/actions.
    const detail = await this.getById(id);
    return { ...detail, promoReleased: result.promoReleased };
  }

  /**
   * Возврат: при providerRefund ЮKassa вызывается внутри tx до записи БД —
   * ошибка PSP откатывает транзакцию (нет «в системе возвращено / на карте нет»).
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
        // Карта уже вся возвращена, но сертификат ещё можно открутить (0 ₽ заказ / gift-only).
        if (remainingCard <= 0 && !giftApplied) {
          throw new BadRequestException('По заказу уже возвращена вся сумма');
        }
        if (remainingCard <= 0 && order.status === OrderStatus.REFUNDED) {
          throw new BadRequestException('По заказу уже возвращена вся сумма');
        }

        let amount: number;
        if (remainingCard <= 0) {
          // gift-only / card already 0: только RELEASE + REFUNDED
          amount = 0;
          if (opts.amount != null && Math.round(opts.amount) !== 0) {
            throw new BadRequestException(
              'По карте возвращать нечего — оформите полный возврат (0 ₽) для открутки сертификата',
            );
          }
        } else {
          amount = opts.amount != null ? Math.round(opts.amount) : remainingCard;
          if (amount < 1 || amount > remainingCard) {
            throw new BadRequestException(
              `Сумма возврата должна быть от 1 до ${remainingCard} ₽`,
            );
          }
        }

        const wantProvider = opts.providerRefund === true;
        let yookassaRefundId: string | null = null;
        let yookassaRefundStatus: string | null = null;
        let providerPaymentId: string | null = null;

        if (wantProvider) {
          if (amount < 1) {
            throw new BadRequestException(
              'Возврат через ЮKassa требует сумму ≥ 1 ₽ (для gift-only снимите providerRefund)',
            );
          }
          if (!this.yookassa.isConfigured()) {
            throw new BadRequestException(
              'ЮKassa не настроена. Снимите providerRefund или задайте ключи.',
            );
          }
          const pay = order.payments.find(
            (p) => p.externalId && p.provider === 'yookassa',
          );
          if (!pay?.externalId) {
            throw new BadRequestException(
              'Нет успешного платежа ЮKassa для возврата через провайдера',
            );
          }
          providerPaymentId = pay.externalId;
          try {
            const refund = await this.yookassa.createRefund({
              paymentId: pay.externalId,
              amountRub: amount,
              description: opts.reason ?? `Возврат заказа ${order.number}`,
            });
            yookassaRefundId = refund.id;
            yookassaRefundStatus = refund.status;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new BadRequestException(
              `ЮKassa отклонила возврат: ${msg}. Учёт в системе не изменён.`,
            );
          }
        }

        const newRefunded = order.refundedAmount + amount;
        const paidSucceeded = sumSucceededPayments(order.payments);
        // Полный возврат: вернули все успешные платежи (или gift-only 0₽).
        const full =
          paidSucceeded <= 0
            ? amount === 0 && Boolean(giftApplied)
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

        if (full && giftApplied) {
          await releaseGiftCertificateForOrder(tx, id, {
            note: 'Возврат при полном refund заказа',
          });
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

        await this.lifecycle.addEvent(tx, {
          orderId: id,
          type: 'REFUND',
          message: full
            ? amount > 0
              ? `Полный возврат ${amount} ₽`
              : 'Полный возврат (сертификат)'
            : `Частичный возврат ${amount} ₽`,
          actorUserId,
          meta: {
            amount,
            reason: opts.reason ?? null,
            full,
            giftReleased: full && giftApplied,
            providerRequested: wantProvider,
            yookassaPaymentId: providerPaymentId,
            refundId: yookassaRefundId,
            providerStatus: yookassaRefundStatus,
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
        // Смена адреса сбрасывает старый quote-снимок — пересчёт на клиенте.
        carrierQuote: undefined,
      };
      if (!after.city?.trim() || !after.address?.trim()) {
        throw new BadRequestException('Укажите город и адрес');
      }

      const shippingMethod =
        dto.shippingMethod != null
          ? parseShipmentProvider(dto.shippingMethod)
          : order.shippingMethod;
      const shippingCost =
        dto.shippingCost != null
          ? Math.max(0, Math.round(dto.shippingCost))
          : order.shippingCost;
      previousTotal = order.total;
      newTotal = recalcOrderTotal({
        subtotal: order.subtotal,
        discountTotal: order.discountTotal,
        giftCertificateAmount: order.giftCertificateAmount,
        shippingCost,
      });

      await tx.order.update({
        where: { id },
        data: {
          shippingAddress: after as Prisma.InputJsonValue,
          shippingMethod,
          shippingCost,
          total: newTotal,
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

      const summary = `Адрес: ${formatAddressOneLine(before) || '—'} → ${formatAddressOneLine(after)}; доставка ${order.shippingCost} → ${shippingCost} ₽; итого ${previousTotal} → ${newTotal} ₽`;
      await this.lifecycle.addEvent(tx, {
        orderId: id,
        type: 'ADDRESS_UPDATED',
        message: `Адрес обновлён (итого ${previousTotal} → ${newTotal} ₽)`,
        actorUserId,
        meta: {
          before,
          after,
          previousTotal,
          total: newTotal,
          shippingCostBefore: order.shippingCost,
          shippingCostAfter: shippingCost,
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

    const detail = await this.getById(id);
    return {
      ...detail,
      previousTotal,
      newTotal,
      balanceDue: detail.balanceDue,
      refundSuggested: detail.refundSuggested,
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
      previousTotal = order.total;
      newTotal = recalcOrderTotal({
        subtotal,
        discountTotal: order.discountTotal,
        giftCertificateAmount: order.giftCertificateAmount,
        shippingCost: order.shippingCost,
      });

      await this.adjustStockForItemEdit(
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
        data: { subtotal, total: newTotal },
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
          before: order.items.map((i) => ({
            title: i.title,
            sku: i.sku,
            qty: i.qty,
            unitPrice: i.unitPrice,
            variantId: i.variantId,
          })),
          after: resolved.map((l) => ({
            title: l.title,
            sku: l.sku,
            qty: l.qty,
            unitPrice: l.unitPrice,
            variantId: l.variantId,
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

    const detail = await this.getById(id);
    return {
      ...detail,
      previousTotal,
      newTotal,
      balanceDue: detail.balanceDue,
      refundSuggested: detail.refundSuggested,
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
      paymentUrl: confirmationUrl,
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

  private async adjustStockForItemEdit(
    tx: Prisma.TransactionClient,
    status: OrderStatus,
    oldLines: Array<{
      variantId: string | null;
      qty: number;
      title?: string;
    }>,
    newLines: Array<{
      variantId: string | null;
      qty: number;
      title?: string;
    }>,
  ) {
    const qtyMap = (
      lines: Array<{ variantId: string | null; qty: number }>,
    ) => {
      const m = new Map<string, number>();
      for (const l of lines) {
        const id = l.variantId?.trim();
        if (!id || l.qty <= 0) continue;
        m.set(id, (m.get(id) ?? 0) + l.qty);
      }
      return m;
    };
    const oldMap = qtyMap(oldLines);
    const newMap = qtyMap(newLines);
    const ids = new Set([...oldMap.keys(), ...newMap.keys()]);

    const increases: Array<{ variantId: string; qty: number; title?: string }> =
      [];
    const decreases: Array<{ variantId: string; qty: number }> = [];

    for (const id of ids) {
      const delta = (newMap.get(id) ?? 0) - (oldMap.get(id) ?? 0);
      if (delta > 0) {
        const title = newLines.find((l) => l.variantId === id)?.title;
        increases.push({ variantId: id, qty: delta, title });
      } else if (delta < 0) {
        decreases.push({ variantId: id, qty: -delta });
      }
    }

    if (isUnpaidEditableStatus(status)) {
      if (decreases.length) await releaseStockReserve(tx, decreases);
      if (increases.length) await reserveStockForLines(tx, increases);
      return;
    }

    if (isPaidEditableStatus(status)) {
      if (decreases.length) await restoreStockOnPaidCancel(tx, decreases);
      for (const line of increases) {
        const rows = await tx.$queryRaw<
          Array<{ id: string; stock: number; stockReserve: number }>
        >`
          SELECT id, stock, "stockReserve"
          FROM "ProductVariant"
          WHERE id = ${line.variantId}
          FOR UPDATE
        `;
        const v = rows[0];
        if (!v) {
          throw new BadRequestException(
            `Вариант недоступен${line.title ? `: ${line.title}` : ''}`,
          );
        }
        const available = Math.max(0, v.stock - v.stockReserve);
        if (available < line.qty) {
          throw new BadRequestException(
            `Недостаточно наличия${line.title ? ` («${line.title}»)` : ''}: доступно ${available}, нужно ${line.qty}`,
          );
        }
        await tx.$executeRaw`
          UPDATE "ProductVariant"
          SET stock = GREATEST(0, stock - ${line.qty})
          WHERE id = ${line.variantId}
        `;
      }
    }
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
