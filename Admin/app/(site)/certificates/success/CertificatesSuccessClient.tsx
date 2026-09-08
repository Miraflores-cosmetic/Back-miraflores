'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import styles from '../../checkout/CheckoutPage.module.css';

type StatusPayload = {
  number?: string;
  paid?: boolean;
  message?: string;
};

async function pollCheckoutStatus(
  orderId: string,
  payToken: string | null,
  attempts = 8,
  delayMs = 1500,
): Promise<StatusPayload & { ok: boolean }> {
  let last: StatusPayload = {};
  const qs = payToken
    ? `?payToken=${encodeURIComponent(payToken)}`
    : '';
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(
      `/api/public/orders/${encodeURIComponent(orderId)}/checkout-status${qs}`,
      { cache: 'no-store', credentials: 'same-origin' },
    );
    const data = (await res.json().catch(() => ({}))) as StatusPayload;
    last = data;
    if (res.ok && data.paid) return { ...data, ok: true };
    if (res.status === 403 || res.status === 401) {
      return {
        ...data,
        message:
          typeof data.message === 'string' && data.message
            ? data.message
            : 'Нет доступа к статусу оплаты.',
        ok: false,
      };
    }
    if (res.status === 404) return { ...data, ok: false };
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return { ...last, ok: false };
}

export function CertificatesSuccessClient() {
  const searchParams = useSearchParams();
  const numberParam = searchParams.get('number')?.trim() || '';
  const orderIdParam = searchParams.get('orderId')?.trim() || '';
  const payTokenParam = searchParams.get('payToken')?.trim() || '';
  const [number, setNumber] = useState(numberParam);
  const [checking, setChecking] = useState(true);
  const [paidOk, setPaidOk] = useState(false);
  const [failMessage, setFailMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const paymentId =
          typeof sessionStorage !== 'undefined'
            ? sessionStorage.getItem('miraflores.pendingPaymentId')
            : null;
        const payToken =
          payTokenParam ||
          (typeof sessionStorage !== 'undefined'
            ? sessionStorage.getItem('miraflores.pendingPayToken')
            : null);
        const storedNumber =
          typeof sessionStorage !== 'undefined'
            ? sessionStorage.getItem('miraflores.pendingOrderNumber')
            : null;
        const paidConfirmed =
          typeof sessionStorage !== 'undefined'
            ? sessionStorage.getItem('miraflores.pendingPaidConfirmed')
            : null;

        if (paidConfirmed) {
          if (!cancelled) {
            setNumber(storedNumber || numberParam);
            setPaidOk(true);
          }
          return;
        }

        if (paymentId && payToken) {
          const res = await fetch(
            `/api/public/orders/payments/${encodeURIComponent(paymentId)}/status?payToken=${encodeURIComponent(payToken)}`,
            { cache: 'no-store' },
          );
          const data = (await res.json().catch(() => ({}))) as StatusPayload;
          if (cancelled) return;
          if (res.ok && data.paid) {
            setNumber(data.number || storedNumber || numberParam);
            setPaidOk(true);
          } else {
            setFailMessage(
              typeof data.message === 'string' && data.message
                ? data.message
                : 'Оплата ещё не подтверждена. Если списание прошло — код придёт на email.',
            );
            if (storedNumber || numberParam) {
              setNumber(storedNumber || numberParam);
            }
          }
          return;
        }

        if (orderIdParam) {
          const data = await pollCheckoutStatus(orderIdParam, payToken);
          if (cancelled) return;
          if (data.ok && data.paid) {
            setNumber(data.number || numberParam);
            setPaidOk(true);
          } else {
            setFailMessage(
              typeof data.message === 'string' && data.message
                ? data.message
                : 'Если оплата прошла, код уже на email. Можно закрыть эту страницу.',
            );
            if (data.number || numberParam) {
              setNumber(data.number || numberParam);
            }
          }
          return;
        }

        if (!cancelled) {
          setFailMessage('Нет данных об оплате. Вернитесь к покупке сертификата.');
        }
      } catch {
        if (!cancelled) setFailMessage('Не удалось проверить статус оплаты');
      } finally {
        if (!cancelled) {
          setChecking(false);
          try {
            sessionStorage.removeItem('miraflores.pendingPaymentId');
            sessionStorage.removeItem('miraflores.pendingOrderId');
            sessionStorage.removeItem('miraflores.pendingOrderNumber');
            sessionStorage.removeItem('miraflores.pendingPayToken');
            sessionStorage.removeItem('miraflores.pendingPaidConfirmed');
          } catch {
            /* ignore */
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numberParam, orderIdParam, payTokenParam]);

  return (
    <main className={`padding-global ${styles.successMain}`}>
      <h1 className={styles.successTitle}>
        {checking
          ? 'Проверяем оплату…'
          : paidOk
            ? 'Сертификат оплачен'
            : 'Оплата сертификата'}
      </h1>
      {number ? <p className={styles.successText}>Заказ {number}</p> : null}
      {checking ? (
        <p className={styles.successText}>Подождите несколько секунд.</p>
      ) : paidOk ? (
        <p className={styles.successText}>
          Код отправлен на email. Введите его при оформлении заказа в поле
          «Промокод или сертификат».
        </p>
      ) : failMessage ? (
        <p className={styles.successText}>{failMessage}</p>
      ) : null}
      <p className={styles.successActions}>
        <Link href="/catalog" className={styles.successLink}>
          В каталог
        </Link>
        <Link href="/certificates" className={styles.successLink}>
          Купить ещё
        </Link>
      </p>
    </main>
  );
}
