import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { scheduleAfterRlsCommit } from '../rls/rls-after-commit';
import type { ReferralWalletService } from './referral-wallet.service';

/**
 * Outbox upsert в tx смены статуса (до commit).
 * После commit — только touch/worker; без in-tx enqueue потеря DELIVERED при crash.
 */
export async function enqueueReferralTouchInTx(
  tx: Prisma.TransactionClient,
  wallet: ReferralWalletService | null | undefined,
  orderId: string,
): Promise<void> {
  if (!wallet) return;
  await wallet.enqueueTouchInTx(tx as never, orderId);
}

/**
 * После commit — touch (earn/clawback). Outbox уже должен быть из enqueueReferralTouchInTx.
 * Ошибки: mark ERROR/DEAD + worker retry.
 */
export function scheduleReferralTouch(
  _prisma: PrismaService,
  wallet: ReferralWalletService | null | undefined,
  orderId: string,
): void {
  if (!wallet) return;
  scheduleAfterRlsCommit(() => wallet.runScheduledTouch(orderId));
}
