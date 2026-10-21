import { describe, expect, it } from 'vitest';
import {
  formatCancelAtLabel,
  nextAwaitingRemindStage,
  ORDER_AWAITING_TTL_DEFAULT_MINUTES,
  paymentRemindEventMessage,
  resolveAwaitingRemindSchedule,
} from './order-awaiting-payment-schedule';

describe('order-awaiting-payment-schedule', () => {
  it('default: 5м / 24ч / 48ч / TTL 72ч', () => {
    const s = resolveAwaitingRemindSchedule({ get: () => undefined });
    expect(s.remind1Minutes).toBe(5);
    expect(s.remind2Minutes).toBe(24 * 60);
    expect(s.remind3Minutes).toBe(48 * 60);
    expect(s.ttlMinutes).toBe(ORDER_AWAITING_TTL_DEFAULT_MINUTES);
  });

  it('nextAwaitingRemindStage: нормальный ход и catch-up к высшему overdue', () => {
    const s = resolveAwaitingRemindSchedule({ get: () => undefined });
    expect(nextAwaitingRemindStage(4, 0, s)).toBe(0);
    expect(nextAwaitingRemindStage(5, 0, s)).toBe(1);
    expect(nextAwaitingRemindStage(100, 1, s)).toBe(0);
    expect(nextAwaitingRemindStage(24 * 60, 1, s)).toBe(2);
    expect(nextAwaitingRemindStage(48 * 60, 2, s)).toBe(3);
    expect(nextAwaitingRemindStage(48 * 60, 3, s)).toBe(0);
    // catch-up: после простоя не начинаем с stage 1
    expect(nextAwaitingRemindStage(24 * 60, 0, s)).toBe(2);
    expect(nextAwaitingRemindStage(48 * 60, 0, s)).toBe(3);
    expect(nextAwaitingRemindStage(48 * 60, 1, s)).toBe(3);
  });

  it('paymentRemindEventMessage различает stages и catch-up', () => {
    expect(paymentRemindEventMessage(1)).toContain('5 мин');
    expect(paymentRemindEventMessage(2)).toContain('24 ч');
    expect(paymentRemindEventMessage(3, '23.10.2026, 15:00')).toContain(
      'авто-отмена',
    );
    expect(paymentRemindEventMessage(3, '23.10.2026, 15:00', [1, 2])).toContain(
      'catch-up',
    );
  });

  it('formatCancelAtLabel — ru-RU МСК', () => {
    const label = formatCancelAtLabel(new Date('2026-10-23T12:00:00.000Z'));
    expect(label).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    expect(label.length).toBeGreaterThan(10);
  });
});
