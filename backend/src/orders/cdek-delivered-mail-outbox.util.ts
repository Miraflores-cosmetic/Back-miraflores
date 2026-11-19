import type { CdekTrackingMailStatus } from './cdek-tracking-mail-outbox.util';
import {
  isMailOutboxDueForRetry,
  mailOutboxFailedOrExhausted,
  mailOutboxSuccessFields,
} from './order-mail-outbox.util';

export type DeliveredMailOutboxSource = 'cdek_sync' | 'admin_manual';

export type DeliveredMailOutboxMeta = {
  source: DeliveredMailOutboxSource;
  from: string;
  to: string;
  mailStatus: CdekTrackingMailStatus;
  /** СДЭК status code или MANUAL для админки */
  cdekStatus: string;
  attempt?: number;
  nextRetryAt?: string;
  sentAt?: string;
  lastError?: string;
  exhausted?: boolean;
};

/** @deprecated alias */
export type CdekDeliveredMailMeta = DeliveredMailOutboxMeta & {
  source: 'cdek_sync';
};

export function parseDeliveredMailOutboxMeta(
  raw: unknown,
): DeliveredMailOutboxMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const source = o.source;
  if (source !== 'cdek_sync' && source !== 'admin_manual') return null;
  const cdekStatus =
    typeof o.cdekStatus === 'string' && o.cdekStatus.trim() !== ''
      ? o.cdekStatus.trim()
      : source === 'admin_manual'
        ? 'MANUAL'
        : '';
  if (!cdekStatus) return null;
  const from = typeof o.from === 'string' ? o.from : '';
  const to = typeof o.to === 'string' ? o.to : '';
  const mailStatus = o.mailStatus;
  const status: CdekTrackingMailStatus =
    mailStatus === 'sent' ||
    mailStatus === 'failed' ||
    mailStatus === 'skipped' ||
    mailStatus === 'pending'
      ? mailStatus
      : 'pending';
  return {
    source: source as DeliveredMailOutboxSource,
    cdekStatus,
    from,
    to,
    mailStatus: status,
    ...(typeof o.attempt === 'number' && o.attempt >= 0
      ? { attempt: o.attempt }
      : {}),
    ...(typeof o.nextRetryAt === 'string' ? { nextRetryAt: o.nextRetryAt } : {}),
    ...(typeof o.sentAt === 'string' ? { sentAt: o.sentAt } : {}),
    ...(typeof o.lastError === 'string' ? { lastError: o.lastError } : {}),
  };
}

export function parseCdekDeliveredMailMeta(
  raw: unknown,
): CdekDeliveredMailMeta | null {
  const m = parseDeliveredMailOutboxMeta(raw);
  if (!m || m.source !== 'cdek_sync') return null;
  return m as CdekDeliveredMailMeta;
}

/** Legacy DELIVERED { from, to } без outbox — считаем письмо отправленным. */
export function isLegacyDeliveredMailMeta(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false;
  const o = meta as Record<string, unknown>;
  if (o.source === 'cdek_sync' || o.source === 'admin_manual') return false;
  if (o.mailStatus != null) return false;
  return typeof o.from === 'string' && typeof o.to === 'string';
}

export function isDeliveredMailDueForRetry(meta: unknown, nowMs?: number): boolean {
  const m = parseDeliveredMailOutboxMeta(meta);
  if (!m) return false;
  return isMailOutboxDueForRetry(m, nowMs);
}

export function deliveredMailMetaAfterFinalize(
  meta: DeliveredMailOutboxMeta,
  result: 'sent' | 'skipped' | 'failed',
  extra: { lastError?: string } = {},
  nowMs: number = Date.now(),
): DeliveredMailOutboxMeta {
  if (result === 'sent') {
    const { attempt: _a, nextRetryAt: _n, lastError: _e, ...rest } = meta;
    return {
      ...rest,
      mailStatus: 'sent',
      ...mailOutboxSuccessFields(nowMs),
    };
  }
  if (result === 'skipped') {
    return {
      ...meta,
      mailStatus: 'skipped',
      ...(extra.lastError ? { lastError: extra.lastError } : {}),
    };
  }
  const outcome = mailOutboxFailedOrExhausted(
    meta,
    extra.lastError ?? 'smtp failed',
    nowMs,
  );
  if (outcome.mailStatus === 'skipped') {
    const { attempt: _a, nextRetryAt: _n, ...rest } = meta;
    return {
      ...rest,
      mailStatus: 'skipped',
      attempt: outcome.attempt,
      lastError: outcome.lastError,
      exhausted: true,
    };
  }
  return {
    ...meta,
    mailStatus: 'failed',
    attempt: outcome.attempt,
    nextRetryAt: outcome.nextRetryAt,
    lastError: outcome.lastError,
  };
}

export function deliveredMailOutboxMessage(
  meta: DeliveredMailOutboxMeta,
  result: 'sent' | 'skipped' | 'failed',
): string {
  if (meta.source === 'admin_manual') {
    if (result === 'sent') return 'Заказ доставлен, письмо отправлено';
    if (result === 'skipped') {
      if (meta.lastError?.includes('exhausted')) {
        return 'Заказ доставлен: письмо не отправлено (исчерпаны попытки)';
      }
      return 'Заказ доставлен: письмо не отправлено (нет SMTP)';
    }
    return 'Заказ доставлен: ошибка SMTP, повтор позже';
  }
  const code = meta.cdekStatus;
  if (result === 'sent') {
    return `Заказ доставлен (СДЭК: ${code}), письмо отправлено`;
  }
  if (result === 'skipped') {
    if (meta.lastError?.includes('exhausted')) {
      return `Заказ доставлен (СДЭК: ${code}): письмо не отправлено (исчерпаны попытки)`;
    }
    return `Заказ доставлен (СДЭК: ${code}): письмо не отправлено (нет SMTP)`;
  }
  return `Заказ доставлен (СДЭК: ${code}): ошибка SMTP, повтор позже`;
}

/** Legacy или успешный outbox — повтор не нужен. */
export function isDeliveredMailSettled(meta: unknown): boolean {
  if (isLegacyDeliveredMailMeta(meta)) return true;
  const outbox = parseDeliveredMailOutboxMeta(meta);
  if (outbox) {
    return outbox.mailStatus === 'sent' || outbox.mailStatus === 'skipped';
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return true;
  }
  return false;
}