import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { promoConsumingRedemptionWhere } from '../promo/promo-redemption.util';
import { ensureGiftPurchaseIssue } from '../gift-certificates/gift-certificate-purchase.util';
import { lockOrderForUpdate, parseYooKassaAmountRub } from './order-lock';
import { commitStockOnPaid } from './order-stock';
import type { OrderLifecycleService } from './order-lifecycle.service';
import { canMarkPaid } from './order-transitions';

type LockedPromo = {
  id: string;
  active: boolean;
  maxUses: number | null;
  oneShot: boolean;
};

export type YooKassaPaymentLike = {
  id?: string;
  amount?: { value?: string };
  paid?: boolean;
  status?: string;
};

export type YandexPayPaymentLike = {
  id: string;
  amountRub?: number | null;
  status?: string;
};

export type MarkPaidSource =
  | { kind: 'yookassa'; remote: YooKassaPaymentLike | null }
  | { kind: 'yandexpay'; remote: YandexPayPaymentLike | null }
  | { kind: 'admin'; actorUserId: string };

export type MarkPaidLateOrder = {
  id: string;
  number: string;
  email: string;
  total: number;
  status: OrderStatus;
};

export type ApplyPaidResult =
  | {
      kind: 'paid';
      number: string;
      email: string;
      orderId: string;
      isGiftPurchase: boolean;
    }
  | { kind: 'already' }
  | { kind: 'late'; order: MarkPaidLateOrder };

const FULFILLED: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PACKING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

export async function ensurePromoRedemption(
  tx: Prisma.TransactionClient,
  order: {
    id: string;
    promoCode: string | null;
    promoRedemption: { id: string } | null;
    discountTotal: number;
    email: string;
    userId: string | null;
    guestId: string | null;
  },
): Promise<void> {
  if (!order.promoCode || order.promoRedemption) return;
  const promo = await tx.promoCode.findFirst({
    where: { code: { equals: order.promoCode, mode: 'insensitive' } },
  });
  if (!promo) return;
  const locked = await tx.$queryRaw<LockedPromo[]>`
    SELECT id, active, "maxUses", "oneShot"
    FROM "PromoCode"
    WHERE id = ${promo.id}
    FOR UPDATE
  `;
  const row = locked[0];
  if (!row?.active) return;
  const used = await tx.promoCodeRedemption.count({
    where: { promoCodeId: row.id, ...promoConsumingRedemptionWhere },
  });
  if (row.maxUses != null && used >= row.maxUses) return;

  if (row.oneShot) {
    const or: Prisma.PromoCodeRedemptionWhereInput[] = [];
    if (order.email) or.push({ email: order.email });
    if (order.userId) or.push({ userId: order.userId });
    if (order.guestId) or.push({ guestId: order.guestId });
    if (or.length) {
      const prior = await tx.promoCodeRedemption.findFirst({
        where: {
          promoCodeId: row.id,
          ...promoConsumingRedemptionWhere,
          OR: or,
        },
        select: { id: true },
      });
      if (prior) return;
    }
  }

  await tx.promoCodeRedemption.create({
    data: {
      promoCodeId: row.id,
      orderId: order.id,
      code: order.promoCode,
      discountAmount: order.discountTotal,
      email: order.email,
      userId: order.userId,
      guestId: order.guestId,
    },
  });
}

async function recordSucceededPayment(
  tx: Prisma.TransactionClient,
  orderId: string,
  amount: number,
  remote: { id?: string },
  provider: 'yookassa' | 'yandexpay',
  raw?: unknown,
): Promise<void> {
  if (!remote.id) return;
  const rawValue = (raw ?? remote) as unknown as Prisma.InputJsonValue;
  const { count } = await tx.payment.updateMany({
    where: { orderId, externalId: remote.id },
    data: {
      status: PaymentStatus.SUCCEEDED,
      raw: rawValue,
    },
  });
  if (count === 0) {
    await tx.payment.create({
      data: {
        orderId,
        provider,
        status: PaymentStatus.SUCCEEDED,
        amount,
        externalId: remote.id,
        raw: rawValue,
      },
    });
  }
}

/** Уже принятый / возвращённый платёж по этому заказу (идемпотентный webhook). */
async function hasSettledPaymentForExternalId(
  tx: Prisma.TransactionClient,
  orderId: string,
  externalId: string,
): Promise<boolean> {
  const row = await tx.payment.findFirst({
    where: {
      orderId,
      externalId,
      status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED] },
    },
    select: { id: true },
  });
  return row != null;
}

/**
 * Единый переход в PAID: lock → stock → promo → payment → event.
 * Public (yookassa): late/mismatch → kind late (возврат снаружи).
 * Admin: не-оплачиваемый статус → BadRequest.
 */
export async function applyPaidInTx(
  tx: Prisma.TransactionClient,
  lifecycle: {
    addEvent: OrderLifecycleService['addEvent'];
  },
  orderId: string,
  source: MarkPaidSource,
): Promise<ApplyPaidResult> {
  await lockOrderForUpdate(tx, orderId);
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      promoRedemption: { select: { id: true } },
    },
  });
  if (!order) throw new NotFoundException('Заказ не найден');

  const yooRemote = source.kind === 'yookassa' ? source.remote : null;
  const ypRemote = source.kind === 'yandexpay' ? source.remote : null;
  const remoteAmount =
    source.kind === 'yookassa' && yooRemote
      ? parseYooKassaAmountRub(yooRemote.amount)
      : source.kind === 'yandexpay' && ypRemote?.amountRub != null
        ? Math.round(ypRemote.amountRub)
        : null;
  const amountMismatch =
    (source.kind === 'yookassa' || source.kind === 'yandexpay') &&
    remoteAmount != null &&
    order.total > 0 &&
    remoteAmount !== order.total;
  const providerRemoteId =
    yooRemote?.id || ypRemote?.id || undefined;

  /**
   * Уже PAID/PACKING/…:
   * - тот же externalId SUCCEEDED/REFUNDED → already (идемпотентный webhook);
   * - другое списание (exclusive cancel не успел) → late + автовозврат снаружи.
   */
  if (FULFILLED.includes(order.status)) {
    if (source.kind === 'admin') {
      return { kind: 'already' };
    }
    if (
      providerRemoteId &&
      (await hasSettledPaymentForExternalId(tx, orderId, providerRemoteId))
    ) {
      return { kind: 'already' };
    }
    if (source.kind === 'yookassa' && yooRemote) {
      await recordSucceededPayment(
        tx,
        orderId,
        remoteAmount ?? order.total,
        yooRemote,
        'yookassa',
      );
    } else if (source.kind === 'yandexpay' && ypRemote) {
      await recordSucceededPayment(
        tx,
        orderId,
        remoteAmount ?? order.total,
        ypRemote,
        'yandexpay',
      );
    }
    await lifecycle.addEvent(tx, {
      orderId,
      type: 'NOTE',
      message: `Повторная оплата при уже ${order.status}: заказ не меняем, нужен возврат`,
      meta: {
        paymentProvider: source.kind,
        paymentId: providerRemoteId ?? null,
        orderStatus: order.status,
        duplicateAfterPaid: true,
        remoteAmount: remoteAmount ?? null,
      },
    });
    return {
      kind: 'late',
      order: {
        id: order.id,
        number: order.number,
        email: order.email,
        total: order.total,
        status: order.status,
      },
    };
  }

  if (!canMarkPaid(order.status)) {
    if (source.kind === 'admin') {
      throw new BadRequestException('Заказ нельзя отметить оплаченным');
    }
    if (source.kind === 'yookassa' && yooRemote) {
      await recordSucceededPayment(
        tx,
        orderId,
        order.total,
        yooRemote,
        'yookassa',
      );
    } else if (source.kind === 'yandexpay' && ypRemote) {
      await recordSucceededPayment(
        tx,
        orderId,
        order.total,
        ypRemote,
        'yandexpay',
      );
    }
    await lifecycle.addEvent(tx, {
      orderId,
      type: 'NOTE',
      message: `Оплата после ${order.status}: заказ не активирован, нужен возврат`,
      meta: providerRemoteId
        ? {
            paymentProvider: source.kind,
            paymentId: providerRemoteId,
            orderStatus: order.status,
          }
        : { orderStatus: order.status },
    });
    return {
      kind: 'late',
      order: {
        id: order.id,
        number: order.number,
        email: order.email,
        total: order.total,
        status: order.status,
      },
    };
  }

  if (amountMismatch) {
    if (source.kind === 'yookassa' && yooRemote) {
      await recordSucceededPayment(
        tx,
        orderId,
        remoteAmount ?? order.total,
        yooRemote,
        'yookassa',
      );
    } else if (source.kind === 'yandexpay' && ypRemote) {
      await recordSucceededPayment(
        tx,
        orderId,
        remoteAmount ?? order.total,
        ypRemote,
        'yandexpay',
      );
    }
    await lifecycle.addEvent(tx, {
      orderId,
      type: 'NOTE',
      message: `Сумма платежа ${remoteAmount} ₽ ≠ заказу ${order.total} ₽ — заказ не активирован`,
      meta: {
        paymentProvider: source.kind,
        paymentId: providerRemoteId ?? null,
        remoteAmount,
        orderTotal: order.total,
      },
    });
    return {
      kind: 'late',
      order: {
        id: order.id,
        number: order.number,
        email: order.email,
        total: remoteAmount ?? order.total,
        status: order.status,
      },
    };
  }

  await commitStockOnPaid(
    tx,
    order.items.map((i) => ({ variantId: i.variantId, qty: i.qty })),
  );

  await tx.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.PAID,
      // Первая оплата — якорь для DAYS_AFTER_PAID quarantine.
      paidAt: new Date(),
      // Оплата через ЮKassa — снова «новый» заказ для бейджа, даже если карточку открывали до оплаты.
      adminViewedAt: source.kind === 'admin' ? new Date() : null,
    },
  });

  await ensurePromoRedemption(tx, order);
  await ensureGiftPurchaseIssue(tx, {
    id: order.id,
    email: order.email,
    giftPurchaseDenominationId: order.giftPurchaseDenominationId,
    giftPurchaseRecipientEmail: order.giftPurchaseRecipientEmail,
    items: order.items.map((i) => ({ sku: i.sku, qty: i.qty })),
  });

  if (source.kind === 'yookassa' || source.kind === 'yandexpay') {
    if (source.kind === 'yookassa' && yooRemote?.id) {
      await recordSucceededPayment(
        tx,
        orderId,
        order.total,
        yooRemote,
        'yookassa',
      );
    } else if (source.kind === 'yandexpay' && ypRemote?.id) {
      await recordSucceededPayment(
        tx,
        orderId,
        order.total,
        ypRemote,
        'yandexpay',
      );
    } else {
      await tx.payment.updateMany({
        where: { orderId, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.SUCCEEDED },
      });
    }
    await lifecycle.addEvent(tx, {
      orderId,
      type: 'PAID',
      message:
        source.kind === 'yandexpay'
          ? 'Оплата получена (Яндекс Пэй)'
          : 'Оплата получена',
      meta: providerRemoteId
        ? {
            paymentProvider: source.kind,
            paymentId: providerRemoteId,
          }
        : undefined,
    });
  } else {
    await tx.payment.updateMany({
      where: { orderId, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.SUCCEEDED },
    });
    const anyPayment = await tx.payment.findFirst({ where: { orderId } });
    if (!anyPayment) {
      await tx.payment.create({
        data: {
          orderId,
          provider: 'manual',
          status: PaymentStatus.SUCCEEDED,
          amount: order.total,
          raw: {
            source: 'admin_mark_paid',
            actorUserId: source.actorUserId,
          } as Prisma.InputJsonValue,
        },
      });
    }
    await lifecycle.addEvent(tx, {
      orderId,
      type: 'MARK_PAID',
      message: 'Оплата отмечена вручную (админ)',
      actorUserId: source.actorUserId,
      meta: { from: order.status, to: OrderStatus.PAID },
    });
  }

  return {
    kind: 'paid',
    number: order.number,
    email: order.email,
    orderId: order.id,
    isGiftPurchase: Boolean(order.giftPurchaseDenominationId),
  };
}
