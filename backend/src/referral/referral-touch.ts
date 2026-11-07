import type { PrismaService } from '../prisma/prisma.service';
import { scheduleAfterRlsCommitWithBypass } from '../rls/rls-after-commit';
import type { ReferralWalletService } from './referral-wallet.service';

/** После commit — пересчитать earn/clawback по заказу (как Yourich touch). */
export function scheduleReferralTouch(
  prisma: PrismaService,
  wallet: ReferralWalletService | null | undefined,
  orderId: string,
): void {
  if (!wallet) return;
  scheduleAfterRlsCommitWithBypass(prisma, () => wallet.touch(orderId));
}
