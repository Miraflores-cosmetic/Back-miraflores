import { OrderStatus, PaymentStatus, type Prisma } from '@prisma/client';
import {
  balanceAfterTotal,
  isPaidEditableStatus,
  netPaidAmount,
} from './order-admin-edit';

export type PaymentBalanceRow = {
  status: PaymentStatus | string;
  amount: number;
};

export function resolveOrderBalanceFields(
  order: {
    total: number;
    refundedAmount: number;
    status: OrderStatus;
    giftPurchaseDenominationId?: string | null;
  },
  payments: PaymentBalanceRow[],
): { balanceDue: number; canPayBalance: boolean } {
  const netPaid = netPaidAmount(payments, order.refundedAmount);
  const { balanceDue } = balanceAfterTotal(order.total, netPaid);
  const canPayBalance =
    balanceDue > 0 &&
    isPaidEditableStatus(order.status) &&
    !order.giftPurchaseDenominationId;
  return { balanceDue, canPayBalance };
}

export function pickReusableSurchargePayment<
  T extends {
    status: PaymentStatus;
    amount: number;
    externalId: string | null;
    confirmationUrl: string | null;
    raw: Prisma.JsonValue | null;
  },
>(payments: T[], balanceDue: number): T | undefined {
  return payments.find((p) => {
    if (p.status !== PaymentStatus.PENDING) return false;
    if (Math.round(p.amount) !== Math.round(balanceDue)) return false;
    if (!p.confirmationUrl?.trim() || !p.externalId?.trim()) return false;
    const kind = (p.raw as { kind?: string } | null)?.kind;
    return kind === 'surcharge';
  });
}
