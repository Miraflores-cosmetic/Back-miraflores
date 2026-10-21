import type { Prisma } from '@prisma/client';

/** Блокирует строку Order до конца транзакции (pay / refund / cancel / markPaid). */
export async function lockOrderForUpdate(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE
  `;
}

export type AwaitingRemindCandidateRow = {
  id: string;
  number: string;
  email: string;
  total: number;
  guestId: string | null;
  createdAt: Date;
  awaitingPaymentRemindStage: number;
  status: string;
};

/** Размер batch воркера: remind за tick. */
export const AWAITING_PAYMENT_REMIND_BATCH = 100;
/** Размер batch воркера: TTL-expire за tick. */
export const AWAITING_PAYMENT_EXPIRE_BATCH = 50;

export type AwaitingRemindDueOpts = {
  now: Date;
  ttlCutoff: Date;
  remind1Minutes: number;
  remind2Minutes: number;
  remind3Minutes: number;
  take?: number;
};

function dueCutoffs(opts: AwaitingRemindDueOpts) {
  return {
    due1: new Date(opts.now.getTime() - opts.remind1Minutes * 60_000),
    due2: new Date(opts.now.getTime() - opts.remind2Minutes * 60_000),
    due3: new Date(opts.now.getTime() - opts.remind3Minutes * 60_000),
  };
}

/**
 * Кандидаты на напоминание: только **due** по schedule,
 * FOR UPDATE SKIP LOCKED (два инстанса не возьмут одну строку).
 * Без due-фильтра в SQL lock'али бы «ещё рано» → next=0 в коде.
 */
export async function claimAwaitingPaymentRemindCandidates(
  tx: Prisma.TransactionClient,
  opts: AwaitingRemindDueOpts,
): Promise<AwaitingRemindCandidateRow[]> {
  const take = Math.max(
    1,
    Math.min(opts.take ?? AWAITING_PAYMENT_REMIND_BATCH, 200),
  );
  const { due1, due2, due3 } = dueCutoffs(opts);
  return tx.$queryRaw<AwaitingRemindCandidateRow[]>`
    SELECT
      id,
      number,
      email,
      total,
      "guestId",
      "createdAt",
      "awaitingPaymentRemindStage",
      status::text AS status
    FROM "Order"
    WHERE status IN ('AWAITING_PAYMENT'::"OrderStatus", 'NEW'::"OrderStatus")
      AND total > 0
      AND "awaitingPaymentRemindStage" < 3
      AND "createdAt" > ${opts.ttlCutoff}
      AND BTRIM(email) <> ''
      AND (
        ("awaitingPaymentRemindStage" < 1 AND "createdAt" <= ${due1})
        OR ("awaitingPaymentRemindStage" < 2 AND "createdAt" <= ${due2})
        OR ("awaitingPaymentRemindStage" < 3 AND "createdAt" <= ${due3})
      )
    ORDER BY "createdAt" ASC
    LIMIT ${take}
    FOR UPDATE SKIP LOCKED
  `;
}

/**
 * Сколько заказов уже должны получить следующее напоминание (due),
 * без lock — для метрики backlog / OPS_ALERT.
 */
export async function countDueAwaitingPaymentReminders(
  db: Prisma.TransactionClient | { $queryRaw: Prisma.TransactionClient['$queryRaw'] },
  opts: Omit<AwaitingRemindDueOpts, 'take'>,
): Promise<number> {
  const { due1, due2, due3 } = dueCutoffs(opts);
  const rows = await db.$queryRaw<Array<{ n: bigint | number }>>`
    SELECT COUNT(*)::bigint AS n
    FROM "Order"
    WHERE status IN ('AWAITING_PAYMENT'::"OrderStatus", 'NEW'::"OrderStatus")
      AND total > 0
      AND "awaitingPaymentRemindStage" < 3
      AND "createdAt" > ${opts.ttlCutoff}
      AND BTRIM(email) <> ''
      AND (
        ("awaitingPaymentRemindStage" < 1 AND "createdAt" <= ${due1})
        OR ("awaitingPaymentRemindStage" < 2 AND "createdAt" <= ${due2})
        OR ("awaitingPaymentRemindStage" < 3 AND "createdAt" <= ${due3})
      )
  `;
  const n = rows[0]?.n;
  if (typeof n === 'bigint') return Number(n);
  return Number(n ?? 0);
}

/** Рубли из ответа ЮKassa (`"500.00"` → 500). */
export function parseYooKassaAmountRub(
  amount: { value?: string } | null | undefined,
): number | null {
  if (!amount?.value) return null;
  const n = Math.round(Number.parseFloat(amount.value));
  return Number.isFinite(n) ? n : null;
}
