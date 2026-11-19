/** Общие поля retry для outbox-писем в OrderEvent.meta. */
export const MAIL_OUTBOX_RETRY_BASE_MS = 60_000;
export const MAIL_OUTBOX_RETRY_MAX_MS = 3_600_000;
/** После N неудачных SMTP → skipped + NOTE/OPS_ALERT (default 8). */
export const MAIL_OUTBOX_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.MAIL_OUTBOX_MAX_ATTEMPTS ?? 8),
);
/** Лог/метрика «высокий attempt» (default 5). */
export const MAIL_OUTBOX_HIGH_ATTEMPT_WARN = Math.max(
  1,
  Number(process.env.MAIL_OUTBOX_HIGH_ATTEMPT_WARN ?? 5),
);

export function mailOutboxBackoffMs(attempt: number): number {
  const n = Math.max(1, Math.min(attempt, 10));
  const raw = MAIL_OUTBOX_RETRY_BASE_MS * 2 ** (n - 1);
  return Math.min(MAIL_OUTBOX_RETRY_MAX_MS, raw);
}

export function isMailOutboxDueForRetry(
  meta: { mailStatus: string; nextRetryAt?: string },
  nowMs: number = Date.now(),
): boolean {
  if (meta.mailStatus === 'pending') {
    if (!meta.nextRetryAt) return true;
    const t = Date.parse(meta.nextRetryAt);
    return !Number.isFinite(t) || t <= nowMs;
  }
  if (meta.mailStatus === 'failed') {
    if (!meta.nextRetryAt) return true;
    const t = Date.parse(meta.nextRetryAt);
    return Number.isFinite(t) && t <= nowMs;
  }
  return false;
}

export function mailOutboxFailureFields(
  meta: { attempt?: number },
  lastError: string,
  nowMs: number = Date.now(),
): { attempt: number; nextRetryAt: string; lastError: string } {
  const attempt = (meta.attempt ?? 0) + 1;
  return {
    attempt,
    nextRetryAt: new Date(
      nowMs + mailOutboxBackoffMs(attempt),
    ).toISOString(),
    lastError,
  };
}

export function mailOutboxExhaustedSkip(
  meta: { attempt?: number },
  lastError: string,
  nowMs: number = Date.now(),
): {
  attempt: number;
  lastError: string;
  mailStatus: 'skipped';
  exhausted: true;
} {
  const attempt = (meta.attempt ?? 0) + 1;
  return {
    attempt,
    lastError: `exhausted (${MAIL_OUTBOX_MAX_ATTEMPTS}): ${lastError}`,
    mailStatus: 'skipped',
    exhausted: true,
  };
}

export function mailOutboxFailedOrExhausted(
  meta: { attempt?: number },
  lastError: string,
  nowMs: number = Date.now(),
):
  | ({ mailStatus: 'failed' } & ReturnType<typeof mailOutboxFailureFields>)
  | ReturnType<typeof mailOutboxExhaustedSkip> {
  const attempt = (meta.attempt ?? 0) + 1;
  if (attempt >= MAIL_OUTBOX_MAX_ATTEMPTS) {
    return mailOutboxExhaustedSkip(meta, lastError, nowMs);
  }
  return {
    mailStatus: 'failed',
    ...mailOutboxFailureFields(meta, lastError, nowMs),
  };
}

export function mailOutboxSuccessFields(nowMs: number = Date.now()): {
  sentAt: string;
  attempt?: undefined;
  nextRetryAt?: undefined;
} {
  return { sentAt: new Date(nowMs).toISOString() };
}