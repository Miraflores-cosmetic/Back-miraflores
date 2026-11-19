import {
  parseDeliveredMailOutboxMeta,
  type DeliveredMailOutboxMeta,
} from './cdek-delivered-mail-outbox.util';
import {
  parseTrackingMailOutboxMeta,
  type TrackingMailOutboxMeta,
} from './cdek-tracking-mail-outbox.util';
import { MAIL_OUTBOX_HIGH_ATTEMPT_WARN } from './order-mail-outbox.util';

export type AdminMailOutboxSlot = {
  mailStatus: string;
  attempt: number;
  nextRetryAt: string | null;
  lastError: string | null;
  source: string;
  exhausted: boolean;
};

export type AdminOrderMailOutbox = {
  tracking: AdminMailOutboxSlot | null;
  delivered: AdminMailOutboxSlot | null;
};

function slotFromTracking(
  meta: TrackingMailOutboxMeta,
): AdminMailOutboxSlot {
  return {
    mailStatus: meta.mailStatus,
    attempt: meta.attempt ?? 0,
    nextRetryAt: meta.nextRetryAt ?? null,
    lastError: meta.lastError ?? null,
    source: meta.source,
    exhausted:
      meta.mailStatus === 'skipped' &&
      Boolean(meta.lastError?.includes('exhausted')),
  };
}

function slotFromDelivered(meta: DeliveredMailOutboxMeta): AdminMailOutboxSlot {
  return {
    mailStatus: meta.mailStatus,
    attempt: meta.attempt ?? 0,
    nextRetryAt: meta.nextRetryAt ?? null,
    lastError: meta.lastError ?? null,
    source: meta.source,
    exhausted:
      meta.mailStatus === 'skipped' &&
      Boolean(meta.lastError?.includes('exhausted')),
  };
}

/** Активный outbox по заказу для админки (последний TRACKING_SENT / DELIVERED с outbox). */
export function summarizeAdminOrderMailOutbox(
  events: Array<{ type: string; meta: unknown }>,
): AdminOrderMailOutbox {
  let tracking: AdminMailOutboxSlot | null = null;
  let delivered: AdminMailOutboxSlot | null = null;

  for (const e of events) {
    if (e.type === 'TRACKING_SENT') {
      const m = parseTrackingMailOutboxMeta(e.meta);
      if (
        m &&
        (m.mailStatus === 'pending' ||
          m.mailStatus === 'failed' ||
          (m.mailStatus === 'skipped' && m.lastError?.includes('exhausted')))
      ) {
        tracking = slotFromTracking(m);
      }
    }
    if (e.type === 'DELIVERED') {
      const m = parseDeliveredMailOutboxMeta(e.meta);
      if (
        m &&
        (m.mailStatus === 'pending' ||
          m.mailStatus === 'failed' ||
          (m.mailStatus === 'skipped' && m.lastError?.includes('exhausted')))
      ) {
        delivered = slotFromDelivered(m);
      }
    }
  }

  return { tracking, delivered };
}

export function isMailOutboxHighAttempt(attempt: number | undefined): boolean {
  return (attempt ?? 0) >= MAIL_OUTBOX_HIGH_ATTEMPT_WARN;
}