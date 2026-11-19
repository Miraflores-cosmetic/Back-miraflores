/** Коды финальной доставки СДЭК (API v2, statuses[].code). */
export const CDEK_DELIVERED_STATUS_CODES = new Set([
  'DELIVERED',
  /** Постамат: посылка получена получателем. */
  'POSTOMAT_RECEIVED',
]);

export type CdekStatusEvent = {
  code?: string;
  name?: string;
  date_time?: string;
  city?: string;
};

export type CdekOrderEntity = {
  uuid?: string;
  cdek_number?: string;
  statuses?: CdekStatusEvent[];
};

/** Парсит тело GET /v2/orders/{uuid}. */
export function parseCdekGetOrderResponse(raw: unknown): CdekOrderEntity | null {
  if (!raw || typeof raw !== 'object') return null;
  const root = raw as { entity?: CdekOrderEntity };
  if (root.entity && typeof root.entity === 'object') return root.entity;
  return raw as CdekOrderEntity;
}

export function cdekTrackingFromEntity(entity: CdekOrderEntity | null): string | null {
  const n = entity?.cdek_number?.trim();
  return n ? n : null;
}

export function isCdekDelivered(entity: CdekOrderEntity | null): boolean {
  const statuses = entity?.statuses;
  if (!statuses?.length) return false;
  return statuses.some((s) => {
    const code = (s.code ?? '').trim().toUpperCase();
    return code !== '' && CDEK_DELIVERED_STATUS_CODES.has(code);
  });
}

export function latestCdekStatus(entity: CdekOrderEntity | null): CdekStatusEvent | null {
  const statuses = entity?.statuses;
  if (!statuses?.length) return null;
  return [...statuses].sort((a, b) => {
    const ta = Date.parse(a.date_time ?? '') || 0;
    const tb = Date.parse(b.date_time ?? '') || 0;
    return tb - ta;
  })[0] ?? null;
}