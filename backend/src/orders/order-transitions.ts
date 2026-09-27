import { OrderStatus, ShipmentProvider } from '@prisma/client';

/** Разрешённые ручные переходы статуса (админ). */
export const ADMIN_STATUS_TRANSITIONS: Partial<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  [OrderStatus.AWAITING_PAYMENT]: [OrderStatus.PAID, OrderStatus.CANCELLED],
  [OrderStatus.NEW]: [OrderStatus.PAID, OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [OrderStatus.PACKING],
  [OrderStatus.PACKING]: [OrderStatus.SHIPPED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  const allowed = ADMIN_STATUS_TRANSITIONS[from];
  return Boolean(allowed?.includes(to));
}

export function canCancel(status: OrderStatus): boolean {
  // Оплаченный заказ — только через refund (иначе сток вернётся, деньги останутся).
  // NEW — legacy (старые строки); новые checkout → AWAITING_PAYMENT.
  return (
    status === OrderStatus.AWAITING_PAYMENT || status === OrderStatus.NEW
  );
}

export function canMarkPaid(status: OrderStatus): boolean {
  return status === OrderStatus.AWAITING_PAYMENT || status === OrderStatus.NEW;
}

export function canStartPacking(status: OrderStatus): boolean {
  return status === OrderStatus.PAID;
}

export function canShip(status: OrderStatus): boolean {
  return status === OrderStatus.PACKING;
}

/** Письмо с треком: после отправки (и при доставке — повторно). */
export function canSendTracking(status: OrderStatus): boolean {
  return status === OrderStatus.SHIPPED || status === OrderStatus.DELIVERED;
}

export function canDeliver(status: OrderStatus): boolean {
  return status === OrderStatus.SHIPPED;
}

/** Возврат денег: после оплаты, пока не полный refund. */
export function canRefund(status: OrderStatus): boolean {
  return (
    status === OrderStatus.PAID ||
    status === OrderStatus.PACKING ||
    status === OrderStatus.SHIPPED ||
    status === OrderStatus.DELIVERED
  );
}

export function remainingRefundable(total: number, refundedAmount: number): number {
  return Math.max(0, total - Math.max(0, refundedAmount));
}

export function parseShipmentProvider(
  raw?: string | null,
): ShipmentProvider {
  const v = (raw ?? '').trim().toUpperCase();
  if (v === 'CDEK' || v === 'YANDEX' || v === 'OZON' || v === 'PICKUP') {
    return v as ShipmentProvider;
  }
  return ShipmentProvider.PICKUP;
}
