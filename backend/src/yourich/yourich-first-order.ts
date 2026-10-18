import { OrderStatus, Prisma } from '@prisma/client';
import { PRIOR_PURCHASE_STATUSES } from './yourich-lead';

type Tx = Prisma.TransactionClient | {
  order: {
    count: (args: Prisma.OrderCountArgs) => Promise<number>;
  };
};

/**
 * Есть ли у покупателя уже товарная покупка (не digital gift-only).
 * Вызывать с RLS bypass — иначе гостевые заказы другого userId не видны.
 */
export async function hasPriorGoodsPurchase(
  tx: Tx,
  identity: { email: string; phone?: string | null; userId?: string | null },
): Promise<boolean> {
  const email = identity.email.trim().toLowerCase();
  const phone = identity.phone?.trim() || null;
  const userId = identity.userId?.trim() || null;
  const or: Prisma.OrderWhereInput[] = [{ email }];
  if (phone) or.push({ phone });
  if (userId) or.push({ userId });

  const n = await tx.order.count({
    where: {
      OR: or,
      status: { in: PRIOR_PURCHASE_STATUSES },
      giftPurchaseDenominationId: null,
    },
  });
  return n > 0;
}

export function priorPurchaseWhere(
  identity: { email: string; phone?: string | null; userId?: string | null },
): Prisma.OrderWhereInput {
  const email = identity.email.trim().toLowerCase();
  const phone = identity.phone?.trim() || null;
  const userId = identity.userId?.trim() || null;
  const or: Prisma.OrderWhereInput[] = [{ email }];
  if (phone) or.push({ phone });
  if (userId) or.push({ userId });
  return {
    OR: or,
    status: { in: [...PRIOR_PURCHASE_STATUSES] as OrderStatus[] },
    giftPurchaseDenominationId: null,
  };
}
