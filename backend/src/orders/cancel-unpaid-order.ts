import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { releaseGiftCertificateForOrder } from '../gift-certificates/gift-certificate-hold.util';
import { enqueueReferralTouchInTx } from '../referral/referral-touch';
import type { ReferralWalletService } from '../referral/referral-wallet.service';
import { releaseStockReserve } from './order-stock';

type Tx = Prisma.TransactionClient;

export type CancelUnpaidOrderOpts = {
  orderId: string;
  fromStatus: OrderStatus;
  items: Array<{ variantId: string | null; qty: number }>;
  /** Сообщение в OrderEvent */
  message?: string;
  actorUserId?: string | null;
  giftNote?: string;
  /** Доп. meta события (reason: abandon | account | admin). ttl — legacy, не используется. */
  reason?: string;
  /** Release SPEND_HOLD реф. кошелька (если был). */
  referralWallet?: ReferralWalletService | null;
};

export type PendingProviderPayment = {
  provider: string;
  externalId: string;
};

export type CancelUnpaidOrderResult = {
  id: string;
  status: OrderStatus;
  /**
   * PENDING с externalId — cancel/rollback у провайдера после tx.
   * @deprecated предпочитайте pendingPayments (provider-aware).
   */
  pendingExternalIds: string[];
  pendingPayments: PendingProviderPayment[];
};

/**
 * Единый путь отмены неоплаченного заказа (AWAITING/NEW):
 * stockReserve → gift RELEASE → PENDING payments CANCELED → status CANCELLED → event.
 * Вызывать внутри tx после lockOrderForUpdate и проверки статуса.
 */
export async function cancelUnpaidOrderInTx(
  tx: Tx,
  opts: CancelUnpaidOrderOpts,
): Promise<CancelUnpaidOrderResult> {
  const pending = await tx.payment.findMany({
    where: {
      orderId: opts.orderId,
      status: PaymentStatus.PENDING,
      externalId: { not: null },
    },
    select: { externalId: true, provider: true },
  });
  const pendingPayments: PendingProviderPayment[] = pending
    .map((p) => ({
      provider: (p.provider || 'yookassa').trim() || 'yookassa',
      externalId: p.externalId?.trim() || '',
    }))
    .filter((p) => Boolean(p.externalId));
  const pendingExternalIds = pendingPayments.map((p) => p.externalId);

  await releaseStockReserve(
    tx,
    opts.items.map((i) => ({ variantId: i.variantId, qty: i.qty })),
  );
  await releaseGiftCertificateForOrder(tx, opts.orderId, {
    note: opts.giftNote?.trim() || 'Возврат при отмене заказа',
  });
  if (opts.referralWallet) {
    await opts.referralWallet.releaseSpendInTx(tx, opts.orderId, {
      note: 'Возврат реф. баланса при отмене заказа',
    });
  }
  // Снимаем hold промокода (иначе слот останется до CASCADE при удалении заказа).
  await tx.promoCodeRedemption.deleteMany({ where: { orderId: opts.orderId } });
  await tx.payment.updateMany({
    where: { orderId: opts.orderId, status: PaymentStatus.PENDING },
    data: { status: PaymentStatus.CANCELED },
  });
  const updated = await tx.order.update({
    where: { id: opts.orderId },
    data: { status: OrderStatus.CANCELLED },
  });
  await tx.orderEvent.create({
    data: {
      orderId: opts.orderId,
      type: 'CANCELLED',
      message: opts.message?.trim() || 'Заказ отменён',
      actorUserId: opts.actorUserId ?? null,
      meta: {
        from: opts.fromStatus,
        ...(opts.reason ? { reason: opts.reason } : {}),
      },
    },
  });
  await enqueueReferralTouchInTx(tx, opts.referralWallet, opts.orderId);
  return {
    id: updated.id,
    status: updated.status,
    pendingExternalIds,
    pendingPayments,
  };
}
