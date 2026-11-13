import { PaymentStatus, Prisma } from '@prisma/client';

type Db = {
  payment: {
    upsert: (args: {
      where: { orderId_externalId: { orderId: string; externalId: string } };
      create: Prisma.PaymentCreateInput;
      update: Prisma.PaymentUpdateInput;
    }) => Promise<unknown>;
  };
};

/** Одна строка Payment на (orderId, externalId); повторная инициализация — update. */
export async function upsertPendingOrderPayment(
  db: Db,
  input: {
    orderId: string;
    provider: string;
    amount: number;
    externalId: string;
    confirmationUrl?: string | null;
    raw?: Prisma.InputJsonValue;
  },
): Promise<void> {
  const { orderId, externalId } = input;
  await db.payment.upsert({
    where: {
      orderId_externalId: { orderId, externalId },
    },
    create: {
      order: { connect: { id: orderId } },
      provider: input.provider,
      status: PaymentStatus.PENDING,
      amount: input.amount,
      externalId,
      confirmationUrl: input.confirmationUrl ?? null,
      raw: input.raw,
    },
    update: {
      provider: input.provider,
      status: PaymentStatus.PENDING,
      amount: input.amount,
      confirmationUrl: input.confirmationUrl ?? null,
      raw: input.raw,
    },
  });
}
