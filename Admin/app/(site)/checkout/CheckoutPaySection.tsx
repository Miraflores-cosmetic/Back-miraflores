'use client';

import { YooKassaWidget } from '@/components/YooKassaWidget/YooKassaWidget';
import { formatRub } from '@/lib/publicCatalog';
import { GIFT_HOLD_RESERVED } from '@/lib/giftHoldCopy';
import styles from './CheckoutPage.module.css';

type Props = {
  showWidget: boolean;
  busy: boolean;
  resetting?: boolean;
  /** payableTotal = goods + shipping; null пока доставка не готова. */
  total: number | null;
  orderNumber?: string | null;
  confirmationToken: string | null;
  paymentId: string | null;
  payToken?: string | null;
  /** CAPTURE уже на балансе (gift при create). */
  giftHoldActive?: boolean;
  onPaymentSuccess: () => void;
  onPaymentError: () => void;
  onCancelPayment?: () => void;
};

export function CheckoutPaySection({
  showWidget,
  busy,
  resetting = false,
  total,
  orderNumber,
  confirmationToken,
  paymentId,
  payToken,
  giftHoldActive = false,
  onPaymentSuccess,
  onPaymentError,
  onCancelPayment,
}: Props) {
  const payLabel = busy
    ? 'Создаём платёж…'
    : total != null
      ? `Оплатить ${formatRub(total)}`
      : 'Оплатить';

  return (
    <section className={styles.section} aria-labelledby="pay-heading">
      <h2 id="pay-heading" className={styles.sectionTitle}>
        Оплата
      </h2>
      {showWidget ? (
        <>
          <p className={styles.sectionHint}>
            Заказ {orderNumber}. Оплатите картой или другим способом через ЮKassa.
            Чтобы изменить адрес или состав — отмените оплату.
          </p>
          {giftHoldActive ? (
            <p className={styles.giftHoldNote} role="status">
              {GIFT_HOLD_RESERVED}
            </p>
          ) : null}
          <YooKassaWidget
            confirmationToken={confirmationToken!}
            paymentId={paymentId}
            payToken={payToken}
            onSuccess={onPaymentSuccess}
            onError={onPaymentError}
          />
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onPaymentSuccess}
          >
            Оплата прошла? Проверить статус
          </button>
          {onCancelPayment ? (
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={resetting || busy}
              onClick={() => void onCancelPayment()}
            >
              {resetting
                ? 'Отменяем…'
                : 'Изменить заказ / Отменить оплату'}
            </button>
          ) : null}
        </>
      ) : (
        <>
          <button
            type="submit"
            className={styles.payBtn}
            disabled={busy || total == null}
          >
            {payLabel}
          </button>
          <div className={styles.paySticky}>
            <button
              type="submit"
              className={styles.payStickyBtn}
              disabled={busy || total == null}
            >
              {payLabel}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
