/**
 * Merchant orderId в Яндекс Пэй.
 * Нельзя навсегда = Order.id: после смены total / rollback повторный create
 * с тем же id → reject / stuck URL. Versioned: `{orderId}:{attempt}`.
 *
 * Legacy: externalId === orderId (attempt 1) или `yp-{orderId}-{uuid}`.
 */
export function parseYandexPayAttempt(
  orderId: string,
  externalId: string | null | undefined,
): number | null {
  const id = (externalId || '').trim();
  if (!id) return null;
  if (id === orderId) return 1;
  const prefix = `${orderId}:`;
  if (id.startsWith(prefix)) {
    const n = Number.parseInt(id.slice(prefix.length), 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  }
  // Старый random `yp-{orderId}-…` — учитываем как занятый слот через count.
  if (id.startsWith(`yp-${orderId}-`)) return null;
  return null;
}

/** Следующий merchant orderId: `{orderId}:{maxAttempt+1}`. */
export function nextYandexPayMerchantOrderId(
  orderId: string,
  existingExternalIds: Array<string | null | undefined>,
): string {
  let max = 0;
  let unknownSlots = 0;
  for (const raw of existingExternalIds) {
    const attempt = parseYandexPayAttempt(orderId, raw);
    if (attempt != null) {
      if (attempt > max) max = attempt;
    } else if ((raw || '').trim()) {
      unknownSlots += 1;
    }
  }
  const next = Math.max(max, unknownSlots) + 1;
  return `${orderId}:${next}`;
}
