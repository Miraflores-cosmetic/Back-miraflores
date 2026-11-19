import { describe, expect, it } from 'vitest';
import {
  isMailOutboxDueForRetry,
  mailOutboxBackoffMs,
  mailOutboxFailedOrExhausted,
  mailOutboxFailureFields,
  MAIL_OUTBOX_MAX_ATTEMPTS,
} from './order-mail-outbox.util';

describe('order-mail-outbox.util', () => {
  it('backoff растёт экспоненциально', () => {
    expect(mailOutboxBackoffMs(1)).toBe(60_000);
    expect(mailOutboxBackoffMs(2)).toBe(120_000);
  });

  it('failed с nextRetryAt в будущем — не due', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(
      isMailOutboxDueForRetry({
        mailStatus: 'failed',
        nextRetryAt: future,
      }),
    ).toBe(false);
  });

  it('после max attempts → skipped exhausted', () => {
    const out = mailOutboxFailedOrExhausted(
      { attempt: MAIL_OUTBOX_MAX_ATTEMPTS - 1 },
      'smtp down',
      Date.UTC(2026, 0, 1),
    );
    expect(out.mailStatus).toBe('skipped');
    expect(out.lastError).toContain('exhausted');
  });

  it('mailOutboxFailureFields задаёт nextRetryAt', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const f = mailOutboxFailureFields({ attempt: 1 }, 'err', now);
    expect(f.attempt).toBe(2);
    expect(Date.parse(f.nextRetryAt)).toBeGreaterThan(now);
  });
});