import { OrderStatus } from '@prisma/client';

export type YourichLeadEvent = 'NEW' | 'DEAL' | 'CANCEL';

export type YourichLeadOrderInput = {
  status: OrderStatus;
  number: string;
  subtotal: number;
  discountTotal: number;
  giftCertificateAmount: number;
  refundedAmount: number;
  customerName: string | null;
  /** Покупка только сертификата — в YouRich не отправляем */
  giftPurchaseDenominationId: string | null;
};

/** Сумма для партнёра: товары после скидки, без доставки, минус сертификат и возвраты. */
export function computeYourichLeadSum(order: YourichLeadOrderInput): number {
  const goods = Math.max(
    0,
    Math.floor(order.subtotal) - Math.max(0, Math.floor(order.discountTotal)),
  );
  const afterGift = Math.max(0, goods - Math.max(0, Math.floor(order.giftCertificateAmount)));
  return Math.max(0, afterGift - Math.max(0, Math.floor(order.refundedAmount)));
}

export function computeYourichLeadEvent(status: OrderStatus): YourichLeadEvent {
  if (status === OrderStatus.CANCELLED || status === OrderStatus.REFUNDED) {
    return 'CANCEL';
  }
  if (
    status === OrderStatus.PAID ||
    status === OrderStatus.PACKING ||
    status === OrderStatus.SHIPPED ||
    status === OrderStatus.DELIVERED
  ) {
    return 'DEAL';
  }
  return 'NEW';
}

/** Статусы, при которых покупатель уже «совершал покупку» (для firstOrderOnly). */
export const PRIOR_PURCHASE_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PACKING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
  OrderStatus.REFUNDED,
];

export function shouldSyncOrderToYourich(order: {
  giftPurchaseDenominationId: string | null;
  refHash?: string | null;
  affiliatePromo?: boolean;
}): boolean {
  if (order.giftPurchaseDenominationId) return false;
  return Boolean(order.refHash?.trim() || order.affiliatePromo);
}

export function buildLeadFieldValuesName(customerName: string | null | undefined): string {
  const name = (customerName ?? '').trim().slice(0, 200);
  return JSON.stringify([{ id: 'name', value: name || 'Покупатель' }]);
}
