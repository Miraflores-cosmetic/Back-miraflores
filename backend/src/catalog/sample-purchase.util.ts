import { OrderStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { SamplePurchaseRejectedException } from './sample-purchase.errors';
import { isProductVariantSample } from './sample-variant.util';

type OrderItemReader =
  | Pick<PrismaClient, 'orderItem'>
  | Pick<Prisma.TransactionClient, 'orderItem'>;

/** Верхний предел qty для пробника в корзине / заказе — всегда 1. */
export function capMaxQtyForSampleVariant(
  variantName: string | null | undefined,
  maxQty: number,
  isSample?: boolean | null,
): number {
  if (maxQty <= 0) return maxQty;
  if (!isProductVariantSample({ name: variantName, isSample })) return maxQty;
  return Math.min(maxQty, 1);
}

export function resolveSampleOrderMaxQty(
  variantName: string | null | undefined,
  orderMaxQty: number | null | undefined,
  available: number,
  isSample?: boolean | null,
): number {
  let maxQty =
    orderMaxQty != null ? Math.min(orderMaxQty, available) : available;
  maxQty = capMaxQtyForSampleVariant(variantName, maxQty, isSample);
  return maxQty;
}

/**
 * Пробник «уже покупали» — оплаченный/исполненный цикл без полного возврата.
 * NEW / AWAITING_PAYMENT / CANCELLED / REFUNDED не блокируют повтор.
 *
 * История (findPurchasedSampleVariantIds): только розничные строки заказа —
 * `isGratitudeGift: false`. Бесплатный пробник в подарке благодарности не
 * расходует лимит «один платный пробник на variantId» (см. assert — там тоже skip gift).
 */
export const SAMPLE_PURCHASE_COUNTED_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PACKING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

export type FindPurchasedSampleVariantOpts = {
  /** Исключить строки текущего заказа (retry checkout / staff edit). */
  excludeOrderId?: string | null;
};

export type SamplePurchaseBlockReason = 'guest' | 'already_purchased';

export function samplePurchaseBlockReason(
  userId: string | null | undefined,
  variantName: string | null | undefined,
  purchasedVariantIds: ReadonlySet<string>,
  variantId: string,
  isSample?: boolean | null,
): SamplePurchaseBlockReason | null {
  if (!isProductVariantSample({ name: variantName, isSample })) return null;
  if (!userId?.trim()) return 'guest';
  if (purchasedVariantIds.has(variantId)) return 'already_purchased';
  return null;
}

export async function findPurchasedSampleVariantIds(
  prisma: OrderItemReader,
  userId: string,
  variantIds: string[],
  opts?: FindPurchasedSampleVariantOpts,
): Promise<Set<string>> {
  const ids = [...new Set(variantIds.filter(Boolean))];
  if (!ids.length || !userId.trim()) return new Set();

  const excludeOrderId = opts?.excludeOrderId?.trim();
  const orderWhere: Prisma.OrderWhereInput = {
    userId,
    status: { in: SAMPLE_PURCHASE_COUNTED_STATUSES },
  };
  if (excludeOrderId) {
    orderWhere.id = { not: excludeOrderId };
  }

  const rows = await prisma.orderItem.findMany({
    where: {
      variantId: { in: ids },
      isGratitudeGift: false,
      order: orderWhere,
    },
    select: { variantId: true },
    distinct: ['variantId'],
  });

  return new Set(
    rows.map((r) => r.variantId).filter((id): id is string => Boolean(id)),
  );
}

export type SampleCartRemovalReason =
  | 'sample_guest'
  | 'sample_already_purchased';

export function firstSampleCartRemoval(
  removedLines: Array<{ reason?: string }> | undefined,
): SampleCartRemovalReason | null {
  if (!removedLines?.length) return null;
  for (const line of removedLines) {
    if (line.reason === 'sample_guest' || line.reason === 'sample_already_purchased') {
      return line.reason;
    }
  }
  return null;
}

export function sampleCartRejectionMessage(
  reason: SampleCartRemovalReason,
): string {
  if (reason === 'sample_guest') {
    return 'Пробники доступны только зарегистрированным покупателям — войдите в аккаунт';
  }
  return 'Вы уже заказывали этот пробник ранее — повторная покупка недоступна';
}

export type SampleOrderLineCheck = {
  variantId: string;
  variantName?: string | null;
  qty: number;
  isSample?: boolean | null;
  /** Подарок благодарности — не subject sample purchase rules. */
  isGratitudeGift?: boolean;
};

/** Сериализация create order с пробниками: pg_advisory_xact_lock + повтор history. */
export async function lockUserForSamplePurchaseTx(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const scope = `mira_sample:${userId.trim()}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}))`;
}

/** Классификация пробника для assert: флаг из БД, snapshot name — fallback. */
async function sampleOrderLinesFromDbInTx(
  tx: Prisma.TransactionClient,
  lines: SampleOrderLineCheck[],
): Promise<SampleOrderLineCheck[]> {
  const candidates = lines.filter((l) => !l.isGratitudeGift && l.variantId);
  const ids = [...new Set(candidates.map((l) => l.variantId))];
  const rows = ids.length
    ? await tx.productVariant.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, isSample: true },
      })
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const sampleLines: SampleOrderLineCheck[] = [];
  for (const line of candidates) {
    const row = byId.get(line.variantId);
    if (
      !isProductVariantSample({
        name: row?.name ?? line.variantName,
        isSample: row?.isSample ?? line.isSample,
      })
    ) {
      continue;
    }
    sampleLines.push({
      ...line,
      variantName: row?.name ?? line.variantName,
      isSample: row?.isSample ?? line.isSample ?? true,
    });
  }
  return sampleLines;
}

export async function assertSampleOrderLinesAllowedInTx(
  tx: Prisma.TransactionClient,
  userId: string | null | undefined,
  lines: SampleOrderLineCheck[],
  opts?: FindPurchasedSampleVariantOpts,
): Promise<void> {
  const sampleLines = await sampleOrderLinesFromDbInTx(tx, lines);
  if (!sampleLines.length) return;

  if (!userId?.trim()) {
    throw new SamplePurchaseRejectedException('sample_guest');
  }

  await lockUserForSamplePurchaseTx(tx, userId);

  for (const line of sampleLines) {
    if (Math.floor(line.qty) > 1) {
      throw new SamplePurchaseRejectedException('sample_qty_limit');
    }
  }

  const purchased = await findPurchasedSampleVariantIds(
    tx,
    userId,
    sampleLines.map((l) => l.variantId),
    opts,
  );
  for (const line of sampleLines) {
    if (purchased.has(line.variantId)) {
      throw new SamplePurchaseRejectedException('sample_already_purchased');
    }
  }
}
