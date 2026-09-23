'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { YooKassaWidget } from '@/components/YooKassaWidget/YooKassaWidget';
import { useYooKassaOrderPayment } from '@/lib/payments/useYooKassaOrderPayment';
import styles from '@/app/(site)/checkout/CheckoutPage.module.css';

/**
 * Deep-link из письма «ожидает оплаты».
 * payToken в query — осознанный exception; сразу в sessionStorage и чистим URL.
 */
function OrderPayInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const started = useRef(false);
  const [bootError, setBootError] = useState<string | null>(null);

  const orderId = (searchParams.get('orderId') || '').trim();
  const payTokenParam = (searchParams.get('payToken') || '').trim();
  const orderNumber = (searchParams.get('number') || '').trim();

  const payment = useYooKassaOrderPayment({
    onPaid: (info) => {
      const qs = new URLSearchParams({
        orderId: info.orderId,
        number: info.number,
      });
      router.replace(`/checkout/success?${qs.toString()}`);
    },
    onError: (message) => setBootError(message),
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (typeof window !== 'undefined' && payTokenParam) {
      const url = new URL(window.location.href);
      if (url.searchParams.has('payToken')) {
        url.searchParams.delete('payToken');
        const qs = url.searchParams.toString();
        window.history.replaceState(
          null,
          '',
          `${url.pathname}${qs ? `?${qs}` : ''}`,
        );
      }
    }

    if (!orderId || !payTokenParam) {
      setBootError(
        'Ссылка на оплату неполная или устарела. Откройте заказ в личном кабинете.',
      );
      return;
    }

    void (async () => {
      const res = await payment.startPay(orderId, payTokenParam);
      if (!res) {
        setBootError(
          (prev) =>
            prev ||
            'Не удалось открыть оплату. Попробуйте из личного кабинета.',
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount
  }, []);

  if (payment.confirmationToken) {
    return (
      <div>
        <p className={styles.successEyebrow}>Оплата</p>
        <h1 className={styles.successTitle}>Оплата заказа</h1>
        <p className={styles.sectionHint}>
          {orderNumber ? `Заказ ${orderNumber}. ` : ''}
          Завершите оплату в виджете ниже.
        </p>
        <YooKassaWidget
          confirmationToken={payment.confirmationToken}
          paymentId={payment.paymentId}
          payToken={payment.payToken || payTokenParam}
        />
      </div>
    );
  }

  if (bootError && !payment.busy) {
    return (
      <div>
        <p className={styles.successEyebrow}>Оплата</p>
        <h1 className={styles.successTitle}>Не удалось оплатить</h1>
        <p className={styles.sectionHint}>{bootError}</p>
        <Link href="/account/orders" className={styles.backLink}>
          К заказам
        </Link>
      </div>
    );
  }

  return (
    <div>
      <p className={styles.successEyebrow}>Оплата</p>
      <h1 className={styles.successTitle}>
        <span className={styles.successSpinner} aria-hidden />
        Открываем оплату…
      </h1>
      <p className={styles.sectionHint}>Подождите несколько секунд.</p>
    </div>
  );
}

export function OrderPayClient() {
  return (
    <Suspense
      fallback={
        <div>
          <p className={styles.successEyebrow}>Оплата</p>
          <h1 className={styles.successTitle}>
            <span className={styles.successSpinner} aria-hidden />
            Открываем оплату…
          </h1>
        </div>
      }
    >
      <OrderPayInner />
    </Suspense>
  );
}
