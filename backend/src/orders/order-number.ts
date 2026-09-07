import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Префикс публичного номера заказа: AA-000001, AA-000002, … */
export const ORDER_NUMBER_PREFIX = 'AA';
const ORDER_NUMBER_DIGITS = 6;
const ORDER_NUMBER_MAX = 10 ** ORDER_NUMBER_DIGITS - 1;

/** Advisory lock key — сериализация выдачи номеров в транзакции. */
const ORDER_NUMBER_LOCK_KEY = 872_014_01;

export function formatOrderNumber(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > ORDER_NUMBER_MAX) {
    throw new BadRequestException('Исчерпан диапазон номеров заказов');
  }
  return `${ORDER_NUMBER_PREFIX}-${String(seq).padStart(ORDER_NUMBER_DIGITS, '0')}`;
}

/**
 * Следующий порядковый номер `AA-000001`… внутри транзакции (pg_advisory_xact_lock).
 * Учитывает только номера с префиксом AA-; старые MF-/JCOS- не мешают счётчику.
 */
export async function allocateNextOrderNumber(
  tx: Prisma.TransactionClient,
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ORDER_NUMBER_LOCK_KEY})`;

  const rows = await tx.$queryRaw<Array<{ max_n: bigint | number | null }>>`
    SELECT MAX(CAST(SUBSTRING(number FROM 4) AS INTEGER)) AS max_n
    FROM "Order"
    WHERE number ~ '^AA-[0-9]{6}$'
  `;

  const raw = rows[0]?.max_n;
  const maxN = raw == null ? 0 : Number(raw);
  return formatOrderNumber(maxN + 1);
}
