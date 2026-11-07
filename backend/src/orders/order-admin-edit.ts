import { BadRequestException } from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';

export const ORDER_EDITABLE_STATUSES: readonly OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.AWAITING_PAYMENT,
  OrderStatus.PAID,
  OrderStatus.PACKING,
] as const;

export function assertOrderEditable(status: OrderStatus): void {
  if (!ORDER_EDITABLE_STATUSES.includes(status)) {
    throw new BadRequestException(
      'Заказ нельзя изменить в текущем статусе (доступно до отправки)',
    );
  }
}

export function isUnpaidEditableStatus(status: OrderStatus): boolean {
  return status === OrderStatus.NEW || status === OrderStatus.AWAITING_PAYMENT;
}

export function isPaidEditableStatus(status: OrderStatus): boolean {
  return status === OrderStatus.PAID || status === OrderStatus.PACKING;
}

export function sumSucceededPayments(
  payments: Array<{ status: PaymentStatus | string; amount: number }>,
): number {
  return payments
    .filter((p) => p.status === PaymentStatus.SUCCEEDED || p.status === 'SUCCEEDED')
    .reduce((s, p) => s + Math.max(0, p.amount), 0);
}

/** Успешные платежи минус уже возвращённое. */
export function netPaidAmount(
  payments: Array<{ status: PaymentStatus | string; amount: number }>,
  refundedAmount: number,
): number {
  return Math.max(0, sumSucceededPayments(payments) - Math.max(0, refundedAmount));
}

export function balanceAfterTotal(
  total: number,
  netPaid: number,
): { balanceDue: number; refundSuggested: number } {
  const t = Math.max(0, Math.round(total));
  const paid = Math.max(0, Math.round(netPaid));
  return {
    balanceDue: Math.max(0, t - paid),
    refundSuggested: Math.max(0, paid - t),
  };
}

export function recalcOrderTotal(opts: {
  subtotal: number;
  discountTotal: number;
  giftCertificateAmount: number;
  /** Списание реф. кошелька (XOR с gift; при clamp тоже вычитаем). */
  referralWalletAmount?: number;
  shippingCost: number;
}): number {
  return Math.max(
    0,
    Math.round(opts.subtotal) -
      Math.max(0, Math.round(opts.discountTotal)) -
      Math.max(0, Math.round(opts.giftCertificateAmount)) -
      Math.max(0, Math.round(opts.referralWalletAmount ?? 0)) +
      Math.max(0, Math.round(opts.shippingCost)),
  );
}

export function formatAddressOneLine(a: {
  region?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  apartment?: string | null;
  postalCode?: string | null;
}): string {
  return [
    a.region,
    a.city,
    a.district,
    a.address,
    a.apartment ? `кв./оф. ${a.apartment}` : null,
    a.postalCode,
  ]
    .filter(Boolean)
    .join(', ');
}
