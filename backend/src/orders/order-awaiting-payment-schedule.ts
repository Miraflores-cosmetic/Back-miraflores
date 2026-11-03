/**
 * Расписание писем для AWAITING_PAYMENT (без авто-отмены).
 *
 * 1) 5 мин  → order_awaiting_payment
 * 2) 24 ч   → order_awaiting_payment_24h
 * 3) 48 ч   → order_awaiting_payment_48h
 * 4) 72 ч   → порог «просрочено» для админки (отмена только руками)
 *
 * TTL: ORDER_AWAITING_TTL_MINUTES (default 4320 = 72 ч) — только UI overdue.
 * Интервалы: ORDER_PAY_REMIND_{1,2,3}_MINUTES.
 *
 * Catch-up (осознанно): за tick — только **высший** overdue stage;
 * тексты 5м/24ч пропускаются, OrderEvent.meta.skipped фиксирует это.
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

  // Держим порядок: 1 < 2 < 3 < ttl (ttl — только порог «просрочено» в админке)
  if (remind1Minutes >= ttlMinutes) remind1Minutes = Math.max(1, ttlMinutes - 3);
  if (remind2Minutes <= remind1Minutes) remind2Minutes = remind1Minutes + 1;
  // место под remind3 и strict < ttl
  if (remind2Minutes >= ttlMinutes - 1) {
    remind2Minutes = Math.max(remind1Minutes + 1, ttlMinutes - 2);
  }
  if (remind3Minutes <= remind2Minutes) remind3Minutes = remind2Minutes + 1;
  if (remind3Minutes >= ttlMinutes) remind3Minutes = ttlMinutes - 1;

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

/** Текст OrderEvent PAYMENT_REMIND для карточки заказа в Admin. */
export function paymentRemindEventMessage(
  stage: 1 | 2 | 3,
  skipped: number[] = [],
): string {
  let base: string;
  if (stage === 1) base = 'Письмо-напоминание об оплате (5 мин)';
  else if (stage === 2) base = 'Письмо-напоминание об оплате (24 ч)';
  else base = 'Письмо-напоминание об оплате (48 ч)';
  if (skipped.length === 0) return base;
  const labels = skipped
    .map((s) => (s === 1 ? '5 мин' : s === 2 ? '24 ч' : `${s}`))
    .join(', ');
  return `${base}; catch-up (пропущены: ${labels})`;
}

export function formatAwaitingDurationLabel(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} мин`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours} ч`;
  if (minutes % 60 === 0) return `${hours} ч`;
  return `${Math.round(minutes)} мин`;
}

/** upcoming | due (порог прошёл, письма нет) | done (sent) | failed | overdue (TTL). */
export type AwaitingPaymentChipTone =
  | 'upcoming'
  | 'due'
  | 'done'
  | 'failed'
  | 'overdue';

export type RemindMailStatus = 'pending' | 'sent' | 'skipped' | 'failed';

/** mailStatus по stage из OrderEvent PAYMENT_REMIND (не путать с remindStage bump). */
export type RemindMailByStage = Partial<Record<1 | 2 | 3, RemindMailStatus>>;

export type AwaitingPaymentChip = {
  key: 'remind1' | 'remind2' | 'remind3' | 'ttl';
  label: string;
  minutes: number;
  at: string;
  reached: boolean;
  /** true только если SMTP sent (✓ в UI). */
  mailed: boolean;
  tone: AwaitingPaymentChipTone;
};

export type AwaitingPaymentTimeline = {
  overdue: boolean;
  ageMinutes: number;
  remindStage: number;
  ttlMinutes: number;
  chips: AwaitingPaymentChip[];
};

/**
 * Свести PAYMENT_REMIND events → статус по stage.
 * При нескольких event на stage: sent > failed > pending > skipped.
 */
export function remindMailByStageFromEvents(
  events: Array<{ meta: unknown }>,
): RemindMailByStage {
  const rank: Record<RemindMailStatus, number> = {
    skipped: 1,
    pending: 2,
    failed: 3,
    sent: 4,
  };
  const out: RemindMailByStage = {};
  for (const ev of events) {
    if (!ev.meta || typeof ev.meta !== 'object' || Array.isArray(ev.meta)) continue;
    const o = ev.meta as Record<string, unknown>;
    const stage = o.stage;
    if (stage !== 1 && stage !== 2 && stage !== 3) continue;
    const raw = o.mailStatus;
    const status: RemindMailStatus =
      raw === 'sent' ||
      raw === 'failed' ||
      raw === 'pending' ||
      raw === 'skipped'
        ? raw
        : 'pending';
    const prev = out[stage];
    if (!prev || rank[status] >= rank[prev]) out[stage] = status;
  }
  return out;
}

/** Таймлайн для списка/карточки заказа (только AWAITING_PAYMENT / NEW). */
export function buildAwaitingPaymentTimeline(
  createdAt: Date,
  status: string,
  remindStage: number,
  schedule: AwaitingRemindSchedule,
  now = new Date(),
  mailByStage: RemindMailByStage | null = null,
): AwaitingPaymentTimeline | null {
  if (status !== 'AWAITING_PAYMENT' && status !== 'NEW') return null;
  const createdMs = createdAt.getTime();
  const ageMinutes = Math.max(0, (now.getTime() - createdMs) / 60_000);
  const overdue = ageMinutes >= schedule.ttlMinutes;
  const defs: Array<{
    key: AwaitingPaymentChip['key'];
    minutes: number;
    stage: number | null;
  }> = [
    { key: 'remind1', minutes: schedule.remind1Minutes, stage: 1 },
    { key: 'remind2', minutes: schedule.remind2Minutes, stage: 2 },
    { key: 'remind3', minutes: schedule.remind3Minutes, stage: 3 },
    { key: 'ttl', minutes: schedule.ttlMinutes, stage: null },
  ];

  const chips: AwaitingPaymentChip[] = defs.map((d) => {
    const reached = ageMinutes >= d.minutes;
    const mailStatus =
      d.stage != null ? mailByStage?.[d.stage as 1 | 2 | 3] : undefined;
    const mailed = mailStatus === 'sent';
    let tone: AwaitingPaymentChipTone = 'upcoming';
    if (d.key === 'ttl') {
      tone = reached ? 'overdue' : 'upcoming';
    } else if (mailed) {
      tone = 'done';
    } else if (mailStatus === 'failed') {
      tone = 'failed';
    } else if (reached) {
      // порог прошёл, успешного sent нет (pending / skipped catch-up / ещё не claim)
      tone = 'due';
    }
    return {
      key: d.key,
      label: formatAwaitingDurationLabel(d.minutes),
      minutes: d.minutes,
      at: new Date(createdMs + d.minutes * 60_000).toISOString(),
      reached,
      mailed,
      tone,
    };
  });

  return {
    overdue,
    ageMinutes: Math.round(ageMinutes * 10) / 10,
    remindStage,
    ttlMinutes: schedule.ttlMinutes,
    chips,
  };
}
