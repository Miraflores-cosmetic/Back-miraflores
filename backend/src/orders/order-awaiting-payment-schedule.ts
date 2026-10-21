/**
 * Расписание писем / авто-отмены для AWAITING_PAYMENT.
 *
 * 1) 5 мин  → order_awaiting_payment
 * 2) 24 ч   → order_awaiting_payment_24h
 * 3) 48 ч   → order_awaiting_payment_48h (+ дата авто-отмены)
 * 4) 72 ч   → CANCELLED + order_cancelled
 *
 * TTL: ORDER_AWAITING_TTL_MINUTES (default 4320 = 72 ч).
 * Интервалы: ORDER_PAY_REMIND_{1,2,3}_MINUTES.
 *
 * Catch-up (осознанно): за tick — только **высший** overdue stage;
 * тексты 5м/24ч пропускаются, OrderEvent.meta.skipped фиксирует это.
 * Иначе после даунтайма 48ч+ клиент получил бы 3 письма за ~3 мин.
 */

export const ORDER_AWAITING_TTL_DEFAULT_MINUTES = 72 * 60; // 4320
export const ORDER_PAY_REMIND_1_DEFAULT_MINUTES = 5;
export const ORDER_PAY_REMIND_2_DEFAULT_MINUTES = 24 * 60; // 1440
export const ORDER_PAY_REMIND_3_DEFAULT_MINUTES = 48 * 60; // 2880

export type AwaitingRemindSchedule = {
  remind1Minutes: number;
  remind2Minutes: number;
  remind3Minutes: number;
  ttlMinutes: number;
};

function parseMinutes(raw: string | undefined, fallback: number, min: number): number {
  const n = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}

export function resolveAwaitingRemindSchedule(env: {
  get(key: string): string | undefined;
}): AwaitingRemindSchedule {
  const ttlMinutes = parseMinutes(
    env.get('ORDER_AWAITING_TTL_MINUTES'),
    ORDER_AWAITING_TTL_DEFAULT_MINUTES,
    5,
  );
  let remind1Minutes = parseMinutes(
    env.get('ORDER_PAY_REMIND_1_MINUTES'),
    ORDER_PAY_REMIND_1_DEFAULT_MINUTES,
    1,
  );
  let remind2Minutes = parseMinutes(
    env.get('ORDER_PAY_REMIND_2_MINUTES'),
    ORDER_PAY_REMIND_2_DEFAULT_MINUTES,
    1,
  );
  let remind3Minutes = parseMinutes(
    env.get('ORDER_PAY_REMIND_3_MINUTES'),
    ORDER_PAY_REMIND_3_DEFAULT_MINUTES,
    1,
  );

  // Держим порядок: 1 < 2 < 3 < ttl
  if (remind1Minutes >= ttlMinutes) remind1Minutes = Math.max(1, ttlMinutes - 3);
  if (remind2Minutes <= remind1Minutes) remind2Minutes = remind1Minutes + 1;
  if (remind2Minutes >= ttlMinutes) remind2Minutes = Math.max(remind1Minutes + 1, ttlMinutes - 2);
  if (remind3Minutes <= remind2Minutes) remind3Minutes = remind2Minutes + 1;
  if (remind3Minutes >= ttlMinutes) remind3Minutes = Math.max(remind2Minutes + 1, ttlMinutes - 1);

  return { remind1Minutes, remind2Minutes, remind3Minutes, ttlMinutes };
}

/**
 * Следующий stage по возрасту заказа (0 = ничего).
 * Catch-up: сразу высший overdue stage, без цепочки 1→2→3 по минутам.
 */
export function nextAwaitingRemindStage(
  ageMinutes: number,
  currentStage: number,
  schedule: AwaitingRemindSchedule,
): 1 | 2 | 3 | 0 {
  let due: 1 | 2 | 3 | 0 = 0;
  if (ageMinutes >= schedule.remind3Minutes) due = 3;
  else if (ageMinutes >= schedule.remind2Minutes) due = 2;
  else if (ageMinutes >= schedule.remind1Minutes) due = 1;
  if (due === 0 || due <= currentStage) return 0;
  return due;
}

/** Stage'и между current и next (не отправляются при catch-up). */
export function skippedAwaitingRemindStages(
  currentStage: number,
  next: 1 | 2 | 3,
): number[] {
  const skipped: number[] = [];
  for (let s = currentStage + 1; s < next; s += 1) skipped.push(s);
  return skipped;
}

/** Дата/время авто-отмены для письма на stage 3 (МСК). */
export function formatCancelAtLabel(cancelAt: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(cancelAt);
}

/** Текст OrderEvent PAYMENT_REMIND для карточки заказа в Admin. */
export function paymentRemindEventMessage(
  stage: 1 | 2 | 3,
  cancelAtLabel?: string,
  skipped: number[] = [],
): string {
  let base: string;
  if (stage === 1) base = 'Письмо-напоминание об оплате (5 мин)';
  else if (stage === 2) base = 'Письмо-напоминание об оплате (24 ч)';
  else if (cancelAtLabel) {
    base = `Письмо-напоминание об оплате (48 ч), авто-отмена ${cancelAtLabel} (МСК)`;
  } else {
    base = 'Письмо-напоминание об оплате (48 ч)';
  }
  if (skipped.length === 0) return base;
  const labels = skipped
    .map((s) => (s === 1 ? '5 мин' : s === 2 ? '24 ч' : `${s}`))
    .join(', ');
  return `${base}; catch-up (пропущены: ${labels})`;
}
