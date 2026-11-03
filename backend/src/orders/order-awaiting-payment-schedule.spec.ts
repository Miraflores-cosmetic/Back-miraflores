import { describe, expect, it } from 'vitest';
import {
  buildAwaitingPaymentTimeline,
  nextAwaitingRemindStage,
  ORDER_AWAITING_TTL_DEFAULT_MINUTES,
  paymentRemindEventMessage,
  remindMailByStageFromEvents,
  resolveAwaitingRemindSchedule,
} from './order-awaiting-payment-schedule';

describe('order-awaiting-payment-schedule', () => {
  it('default: 5м / 24ч / 48ч / TTL 72ч', () => {
    const s = resolveAwaitingRemindSchedule({ get: () => undefined });
    expect(s.remind1Minutes).toBe(5);
    expect(s.remind2Minutes).toBe(24 * 60);
    expect(s.remind3Minutes).toBe(48 * 60);
    expect(s.ttlMinutes).toBe(ORDER_AWAITING_TTL_DEFAULT_MINUTES);
    expect(s.remind1Minutes).toBeLessThan(s.remind2Minutes);
    expect(s.remind2Minutes).toBeLessThan(s.remind3Minutes);
    expect(s.remind3Minutes).toBeLessThan(s.ttlMinutes);
  });

  it('clamp: remind3 ≥ ttl → remind3 = ttl−1 (строго < TTL)', () => {
    const s = resolveAwaitingRemindSchedule({
      get: (k) => {
        if (k === 'ORDER_AWAITING_TTL_MINUTES') return '100';
        if (k === 'ORDER_PAY_REMIND_1_MINUTES') return '10';
        if (k === 'ORDER_PAY_REMIND_2_MINUTES') return '20';
        if (k === 'ORDER_PAY_REMIND_3_MINUTES') return '500';
        return undefined;
      },
    });
    expect(s.ttlMinutes).toBe(100);
    expect(s.remind3Minutes).toBe(99);
    expect(s.remind2Minutes).toBeLessThan(s.remind3Minutes);
    expect(s.remind3Minutes).toBeLessThan(s.ttlMinutes);
  });

  it('clamp: remind2 слишком близко к ttl — место под remind3', () => {
    const s = resolveAwaitingRemindSchedule({
      get: (k) => {
        if (k === 'ORDER_AWAITING_TTL_MINUTES') return '50';
        if (k === 'ORDER_PAY_REMIND_1_MINUTES') return '5';
        if (k === 'ORDER_PAY_REMIND_2_MINUTES') return '49';
        if (k === 'ORDER_PAY_REMIND_3_MINUTES') return '50';
        return undefined;
      },
    });
    expect(s.remind1Minutes).toBeLessThan(s.remind2Minutes);
    expect(s.remind2Minutes).toBeLessThan(s.remind3Minutes);
    expect(s.remind3Minutes).toBeLessThan(s.ttlMinutes);
  });

  it('nextAwaitingRemindStage: нормальный ход и catch-up к высшему overdue', () => {
    const s = resolveAwaitingRemindSchedule({ get: () => undefined });
    expect(nextAwaitingRemindStage(4, 0, s)).toBe(0);
    expect(nextAwaitingRemindStage(5, 0, s)).toBe(1);
    expect(nextAwaitingRemindStage(100, 1, s)).toBe(0);
    expect(nextAwaitingRemindStage(24 * 60, 1, s)).toBe(2);
    expect(nextAwaitingRemindStage(48 * 60, 2, s)).toBe(3);
    expect(nextAwaitingRemindStage(48 * 60, 3, s)).toBe(0);
    expect(nextAwaitingRemindStage(24 * 60, 0, s)).toBe(2);
    expect(nextAwaitingRemindStage(48 * 60, 0, s)).toBe(3);
    expect(nextAwaitingRemindStage(48 * 60, 1, s)).toBe(3);
  });

  it('paymentRemindEventMessage без авто-отмены', () => {
    expect(paymentRemindEventMessage(1)).toContain('5 мин');
    expect(paymentRemindEventMessage(2)).toContain('24 ч');
    expect(paymentRemindEventMessage(3)).toContain('48 ч');
    expect(paymentRemindEventMessage(3)).not.toContain('авто-отмена');
    expect(paymentRemindEventMessage(3, [1, 2])).toContain('catch-up');
  });

  it('remindMailByStageFromEvents: sent побеждает pending/failed', () => {
    const map = remindMailByStageFromEvents([
      { meta: { stage: 1, mailStatus: 'pending' } },
      { meta: { stage: 1, mailStatus: 'sent' } },
      { meta: { stage: 2, mailStatus: 'failed' } },
      { meta: { stage: 3, mailStatus: 'skipped' } },
    ]);
    expect(map[1]).toBe('sent');
    expect(map[2]).toBe('failed');
    expect(map[3]).toBe('skipped');
  });

  it('buildAwaitingPaymentTimeline: due≠done; ✓/done только sent; overdue TTL', () => {
    const s = resolveAwaitingRemindSchedule({ get: () => undefined });
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const mid = buildAwaitingPaymentTimeline(
      createdAt,
      'AWAITING_PAYMENT',
      2,
      s,
      new Date('2026-01-02T12:00:00.000Z'),
      { 1: 'sent', 2: 'pending' },
    );
    expect(mid?.overdue).toBe(false);
    expect(mid?.chips).toHaveLength(4);
    const r1 = mid?.chips.find((c) => c.key === 'remind1');
    const r2 = mid?.chips.find((c) => c.key === 'remind2');
    expect(r1?.tone).toBe('done');
    expect(r1?.mailed).toBe(true);
    expect(r2?.tone).toBe('due');
    expect(r2?.mailed).toBe(false);
    expect(mid?.chips.find((c) => c.key === 'ttl')?.tone).toBe('upcoming');

    const reachedNoMail = buildAwaitingPaymentTimeline(
      createdAt,
      'AWAITING_PAYMENT',
      0,
      s,
      new Date('2026-01-01T01:00:00.000Z'),
      null,
    );
    expect(reachedNoMail?.chips.find((c) => c.key === 'remind1')?.tone).toBe(
      'due',
    );
    expect(reachedNoMail?.chips.find((c) => c.key === 'remind1')?.mailed).toBe(
      false,
    );

    const failed = buildAwaitingPaymentTimeline(
      createdAt,
      'AWAITING_PAYMENT',
      1,
      s,
      new Date('2026-01-01T01:00:00.000Z'),
      { 1: 'failed' },
    );
    expect(failed?.chips.find((c) => c.key === 'remind1')?.tone).toBe('failed');
    expect(failed?.chips.find((c) => c.key === 'remind1')?.mailed).toBe(false);

    const late = buildAwaitingPaymentTimeline(
      createdAt,
      'AWAITING_PAYMENT',
      3,
      s,
      new Date('2026-01-05T00:00:00.000Z'),
      { 1: 'sent', 2: 'sent', 3: 'sent' },
    );
    expect(late?.overdue).toBe(true);
    expect(late?.chips.find((c) => c.key === 'ttl')?.tone).toBe('overdue');
    expect(buildAwaitingPaymentTimeline(createdAt, 'PAID', 0, s)).toBeNull();
  });
});
