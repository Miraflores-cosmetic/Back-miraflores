'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCart } from '@/lib/cart/CartContext';
import { useBuyerAuth } from '@/lib/BuyerAuthProvider';
import styles from '../CheckoutPage.module.css';

type StatusPayload = {
  number?: string;
  orderId?: string;
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
    if (res.ok && data.paid) {
      return { ...data, ok: true };
    }
    if (res.status === 403 || res.status === 401) {
      return {
        ...data,
        message:
          typeof data.message === 'string' && data.message
            ? data.message
            : 'Нет доступа к статусу оплаты. Откройте ссылку из оплаты или войдите в аккаунт.',
        ok: false,
      };
    }
    if (res.status === 404) {
      return { ...data, ok: false };
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return { ...last, ok: false };
}

export function CheckoutSuccessClient() {
  const searchParams = useSearchParams();
  const numberParam = searchParams.get('number')?.trim() || '';
  const orderIdParam = searchParams.get('orderId')?.trim() || '';
  const payTokenParam = searchParams.get('payToken')?.trim() || '';
  const { clearCart } = useCart();
  const { authenticated: buyerAuthed } = useBuyerAuth();
  const [number, setNumber] = useState(numberParam);
  const [orderId, setOrderId] = useState(orderIdParam);
  const [checking, setChecking] = useState(true);
  const [paidOk, setPaidOk] = useState(false);
  const [failMessage, setFailMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const payToken =
          payTokenParam ||
          (typeof sessionStorage !== 'undefined'
            ? sessionStorage.getItem('miraflores.pendingPayToken')
            : null);

        const paymentId =
          typeof sessionStorage !== 'undefined'
            ? sessionStorage.getItem('miraflores.pendingPaymentId')
            : null;
        const storedNumber =
          typeof sessionStorage !== 'undefined'
            ? sessionStorage.getItem('miraflores.pendingOrderNumber')
            : null;
        const storedOrderId =
          typeof sessionStorage !== 'undefined'
            ? sessionStorage.getItem('miraflores.pendingOrderId')
            : null;
        const paidConfirmed =
          typeof sessionStorage !== 'undefined'
            ? sessionStorage.getItem('miraflores.pendingPaidConfirmed')
            : null;

        if (paidConfirmed) {
          if (!cancelled) {
            if (storedNumber) setNumber(storedNumber);
            else if (numberParam) setNumber(numberParam);
            if (storedOrderId) setOrderId(storedOrderId);
            else if (orderIdParam) setOrderId(orderIdParam);
            setPaidOk(true);
            clearCart();
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
            setOrderId(data.orderId || storedOrderId || orderIdParam);
            setPaidOk(true);
            clearCart();
          } else {
            setFailMessage(
              typeof data.message === 'string' && data.message
                ? data.message
                : 'Оплата ещё не подтверждена. Завершите платёж на странице оформления.',
            );
          }
          return;
        }

        const oid = orderIdParam || storedOrderId || '';
        if (oid) {
          const data = await pollCheckoutStatus(oid, payToken);
          if (cancelled) return;
          if (data.ok && data.paid) {
            setNumber(data.number || storedNumber || numberParam);
            setOrderId(data.orderId || oid);
            setPaidOk(true);
            clearCart();
          } else {
            setFailMessage(
              typeof data.message === 'string' && data.message
                ? data.message
                : 'Оплата ещё не подтверждена. Завершите платёж на странице оформления.',
            );
            if (data.number || numberParam) {
              setNumber(data.number || numberParam);
            }
            setOrderId(data.orderId || oid);
          }
          return;
        }

        if (!cancelled) {
          setFailMessage('Нет данных об оплате. Вернитесь к оформлению.');
        }
      } catch {
        if (!cancelled) {
          setFailMessage('Не удалось проверить статус оплаты');
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checking) {
    return (
      <div>
        <p className={styles.successEyebrow}>Оплата</p>
        <h1 className={styles.successTitle}>
          <span className={styles.successSpinner} aria-hidden />
          Подтверждаем оплату…
        </h1>
        <p className={styles.successTextMuted}>
          Обычно это занимает несколько секунд. Не закрывайте страницу.
        </p>
      </div>
    );
  }

  if (!paidOk) {
    return (
      <div>
        <p className={styles.successEyebrow}>Оплата</p>
        <h1 className={styles.successTitle}>Оплата не подтверждена</h1>
        <p className={styles.successText}>{failMessage}</p>
        <div className={styles.successActions}>
          <Link href="/checkout" className={styles.successPrimaryLink}>
            Вернуться к оформлению
          </Link>
          <div className={styles.successSecondaryRow}>
            <Link href="/catalog" className={styles.successLink}>
              В каталог
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className={styles.successEyebrow}>Заказ оформлен</p>
      <h1 className={styles.successTitle}>Спасибо за заказ</h1>
      <p className={styles.successText}>
        Оплата принята. Подтверждение отправим на email.
      </p>

      {number ? (
        <div className={styles.successCard}>
          <p className={styles.successCardLabel}>Номер заказа</p>
          <p className={styles.successCardValue}>{number}</p>
        </div>
      ) : null}

      <p className={styles.successTextMuted}>
        Сохраните номер — по нему можно уточнить статус у поддержки.
      </p>

      <div className={styles.successActions}>
        {buyerAuthed && orderId ? (
          <Link
            href={`/account/orders/${encodeURIComponent(orderId)}`}
            className={styles.successPrimaryLink}
          >
            К заказу
          </Link>
        ) : buyerAuthed ? (
          <Link href="/account/orders" className={styles.successPrimaryLink}>
            Мои заказы
          </Link>
        ) : (
          <Link href="/register" className={styles.successPrimaryLink}>
            Создать аккаунт
          </Link>
        )}
        <div className={styles.successSecondaryRow}>
          {buyerAuthed && orderId ? (
            <Link href="/account/orders" className={styles.successLink}>
              Мои заказы
            </Link>
          ) : null}
          <Link href="/catalog" className={styles.successLink}>
            В каталог
          </Link>
        </div>
      </div>
    </div>
  );
}
