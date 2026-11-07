import type { Prisma } from '@prisma/client';

/** Сериализация ledger-операций по рефереру (clawback / post earn). */
export async function lockReferralWalletUser(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const scope = `mira_referral_wallet:${userId.trim()}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}))`;
}
