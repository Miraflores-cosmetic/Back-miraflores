import type { PendingProviderPayment } from './cancel-unpaid-order';

type YooLike = {
  cancelPaymentsBestEffort: (ids: string[]) => Promise<void>;
};

type YpLike = {
  cancelOrdersBestEffort: (ids: string[]) => Promise<void>;
};

/**
 * После cancelUnpaidOrderInTx: cancel/rollback PENDING у PSP по provider.
 */
export async function cancelPendingAtProviders(
  payments: PendingProviderPayment[],
  deps: { yookassa: YooLike; yandexPay: YpLike },
): Promise<void> {
  if (!payments.length) return;
  const yooIds = payments
    .filter((p) => p.provider === 'yookassa')
    .map((p) => p.externalId);
  const ypIds = payments
    .filter((p) => p.provider === 'yandexpay')
    .map((p) => p.externalId);
  if (yooIds.length) {
    await deps.yookassa.cancelPaymentsBestEffort(yooIds);
  }
  if (ypIds.length) {
    await deps.yandexPay.cancelOrdersBestEffort(ypIds);
  }
}
