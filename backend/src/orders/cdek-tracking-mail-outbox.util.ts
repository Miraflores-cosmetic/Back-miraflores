import {
  isMailOutboxDueForRetry,
  mailOutboxFailedOrExhausted,
  mailOutboxSuccessFields,
} from './order-mail-outbox.util';

export type CdekTrackingMailStatus =
  | 'pending'
  | 'sent'
  | 'failed'
  | 'skipped';

export type TrackingMailOutboxSource = 'cdek_sync' | 'admin_manual';

export type TrackingMailOutboxMeta = {
  tracking: string;
  source: TrackingMailOutboxSource;
  mailStatus: CdekTrackingMailStatus;
  attempt?: number;
  nextRetryAt?: string;
  sentAt?: string;
  lastError?: string;
  exhausted?: boolean;
};

/** @deprecated alias */
export type CdekTrackingMailMeta = TrackingMailOutboxMeta & {
  source: 'cdek_sync';
};

export function parseTrackingMailOutboxMeta(
  raw: unknown,
): TrackingMailOutboxMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const source = o.source;
  if (source !== 'cdek_sync' && source !== 'admin_manual') return null;
  const tracking = typeof o.tracking === 'string' ? o.tracking.trim() : '';
  if (!tracking) return null;
  const mailStatus = o.mailStatus;
  const status: CdekTrackingMailStatus =
    mailStatus === 'sent' ||
    mailStatus === 'failed' ||
    mailStatus === 'skipped' ||
    mailStatus === 'pending'
      ? mailStatus
      : 'pending';
  return {
    tracking,
    source: source as TrackingMailOutboxSource,
    mailStatus: status,
    ...(typeof o.attempt === 'number' && o.attempt >= 0
      ? { attempt: o.attempt }
      : {}),
    ...(typeof o.nextRetryAt === 'string' ? { nextRetryAt: o.nextRetryAt } : {}),
    ...(typeof o.sentAt === 'string' ? { sentAt: o.sentAt } : {}),
    ...(typeof o.lastError === 'string' ? { lastError: o.lastError } : {}),
  };
}

export function parseCdekTrackingMailMeta(
  raw: unknown,
): CdekTrackingMailMeta | null {
  const m = parseTrackingMailOutboxMeta(raw);
  if (!m || m.source !== 'cdek_sync') return null;
  return m as CdekTrackingMailMeta;
}

/** Legacy `{ tracking }` без outbox — считаем отправленным. */
export function isLegacyTrackingMailMeta(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false;
  const o = meta as Record<string, unknown>;
  if (o.source === 'cdek_sync' || o.source === 'admin_manual') return false;
  if (o.mailStatus != null) return false;
  return typeof o.tracking === 'string' && o.tracking.trim() !== '';
}

/** Ручной legacy или outbox settled — повтор из sync не нужен. */
export function isTrackingMailSettled(meta: unknown): boolean {
  if (isLegacyTrackingMailMeta(meta)) return true;
  const outbox = parseTrackingMailOutboxMeta(meta);
  if (outbox) {
    return outbox.mailStatus === 'sent' || outbox.mailStatus === 'skipped';
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return true;
  }
  return false;
}

export function isTrackingMailDueForRetry(meta: unknown, nowMs?: number): boolean {
  const outbox = parseTrackingMailOutboxMeta(meta);
  if (!outbox) return false;
  return isMailOutboxDueForRetry(outbox, nowMs);
}

export function trackingMailMetaAfterFinalize(
  meta: TrackingMailOutboxMeta,
  result: 'sent' | 'skipped' | 'failed',
  extra: { lastError?: string } = {},
  nowMs: number = Date.now(),
): TrackingMailOutboxMeta {
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

export function trackingMailOutboxMessage(
  meta: TrackingMailOutboxMeta,
  result: 'sent' | 'skipped' | 'failed',
): string {
  const { tracking, source } = meta;
  if (source === 'admin_manual') {
    if (result === 'sent') return `Трек отправлен клиенту: ${tracking}`;
    if (result === 'skipped') {
      if (meta.lastError?.includes('exhausted')) {
        return `Трек: письмо не отправлено (исчерпаны попытки), ${tracking}`;
      }
      return `Трек: письмо не отправлено (нет SMTP), ${tracking}`;
    }
    return `Трек: ошибка SMTP, повтор позже, ${tracking}`;
  }
  if (result === 'sent') {
    return `Трек отправлен клиенту (СДЭК, авто): ${tracking}`;
  }
  if (result === 'skipped') {
    return `Трек СДЭК (авто): письмо не отправлено (нет SMTP), ${tracking}`;
  }
  return `Трек СДЭК (авто): ошибка SMTP, повтор позже, ${tracking}`;
}