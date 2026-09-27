/** Русские лейблы OrderStatus для админки и ЛК. */
const ORDER_STATUS_LABELS: Record<string, string> = {
  /** @deprecated legacy checkout; новые заказы — AWAITING_PAYMENT */
  NEW: 'Новый',
  AWAITING_PAYMENT: 'Ожидает оплаты',
  PAID: 'Оплачен',
  PACKING: 'Собирается',
  SHIPPED: 'Отправлен',
  DELIVERED: 'Доставлен',
  CANCELLED: 'Отменён',
  REFUNDED: 'Возвращён',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Ожидает',
  SUCCEEDED: 'Успешно',
  CANCELED: 'Отменён',
  REFUNDED: 'Возвращён',
};

const ORDER_EVENT_TYPE_LABELS: Record<string, string> = {
  CREATED: 'Создан',
  PAID: 'Оплата',
  MARK_PAID: 'Отмечен оплаченным',
  STATUS_CHANGED: 'Статус',
  CANCELLED: 'Отмена',
  SHIPPED: 'Отправка',
  TRACKING_SENT: 'Трек отправлен',
  DELIVERED: 'Доставлен',
  REFUND: 'Возврат средств',
  NOTE: 'Заметка',
  OPS_ALERT: 'Ops-алерт',
  CARRIER_REGISTERED: 'Отправление у перевозчика',
  CARRIER_COST: 'Стоимость доставки (факт)',
  ADDRESS_UPDATED: 'Адрес изменён',
  ITEMS_UPDATED: 'Состав изменён',
  SURCHARGE_PAID: 'Доплата получена',
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? status;
}

export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABELS[status] ?? status;
}

export function orderEventTypeLabel(type: string): string {
  return ORDER_EVENT_TYPE_LABELS[type] ?? type;
}

/** CSS-модуль badge-классы (catalogAdmin.module.css). */
export function orderStatusBadgeClass(
  status: string,
  styles: Record<string, string>,
): string {
  switch (status) {
    case 'PAID':
      return styles.badgeOrderPaid ?? styles.badgeOn ?? '';
    case 'PACKING':
      return styles.badgeOrderPacking ?? styles.badgeScheduled ?? '';
    case 'SHIPPED':
      return styles.badgeOrderShipped ?? styles.badgeScheduled ?? '';
    case 'DELIVERED':
      return styles.badgeOrderDelivered ?? styles.badgeOn ?? '';
    case 'AWAITING_PAYMENT':
    case 'NEW':
      return styles.badgeOrderAwaiting ?? styles.badgeDraft ?? '';
    case 'CANCELLED':
      return styles.badgeOrderCancelled ?? styles.badgeOff ?? '';
    case 'REFUNDED':
      return styles.badgeOrderRefunded ?? styles.badgeExpired ?? '';
    default:
      return styles.badgeOff ?? '';
  }
}

export function paymentStatusBadgeClass(
  status: string,
  styles: Record<string, string>,
): string {
  switch (status) {
    case 'SUCCEEDED':
      return styles.badgeOrderPaid ?? styles.badgeOn ?? '';
    case 'PENDING':
      return styles.badgeOrderAwaiting ?? styles.badgeDraft ?? '';
    case 'CANCELED':
      return styles.badgeOrderCancelled ?? styles.badgeOff ?? '';
    case 'REFUNDED':
      return styles.badgeOrderRefunded ?? styles.badgeExpired ?? '';
    default:
      return styles.badgeOff ?? '';
  }
}
