/** Согласовано с Nest ORDER_AWAITING_TTL_MINUTES (default 60) — CAPTURE при create. */
export const GIFT_HOLD_TTL_MINUTES = 60;

/** До create: soft validate в корзине/чекауте. */
export const GIFT_HOLD_WILL_RESERVE = `При оформлении заказа код сертификата резервируется до оплаты или отмены (~${GIFT_HOLD_TTL_MINUTES} мин). Пока резерв активен, тот же код нельзя применить в другом заказе.`;

/** После create: hard CAPTURE уже списан с баланса. */
export const GIFT_HOLD_RESERVED = `Код сертификата зарезервирован. Оплатите в течение ~${GIFT_HOLD_TTL_MINUTES} мин — иначе резерв снимется.`;

export const GIFT_HOLD_APPLIED_TOAST = `Сертификат применён. При оформлении код будет зарезервирован (~${GIFT_HOLD_TTL_MINUTES} мин).`;

export const GIFT_HOLD_CAPTURED_TOAST = GIFT_HOLD_RESERVED;

/** Личный кабинет / неоплаченный заказ с CAPTURE. */
export const GIFT_HOLD_ACCOUNT_UNPAID = `С сертификата уже списан резерв по этому заказу. Код заморожен до оплаты или отмены (~${GIFT_HOLD_TTL_MINUTES} мин с создания заказа).`;

/**
 * Политика partial refund при gift:
 * запрет — только полный возврат карты возвращает сертификат (RELEASE).
 */
export const GIFT_PARTIAL_REFUND_POLICY =
  'Заказ с подарочным сертификатом: только полный возврат. Частичный возврат картой недоступен — баланс сертификата не меняется до полного refund. Ручная корректировка — в разделе «Сертификаты».';
