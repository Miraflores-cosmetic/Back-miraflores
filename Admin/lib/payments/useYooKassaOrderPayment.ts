'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readApiError } from '@/lib/readApiError';

export type PayStartResult = {
  alreadyPaid?: boolean;
  orderId: string;
  number: string;
  total?: number;
  paymentId?: string;
  confirmationToken?: string;
  message?: string | string[];
};

export type PaidInfo = {
  orderId: string;
  number: string;
  message?: string;
};

type Options = {
  /** Интервал опроса статуса, мс (default 4000). */
  pollMs?: number;
  /** Писать miraflores.pending* в sessionStorage. */
  persistSession?: boolean;
  onPaid: (info: PaidInfo) => void;
  onError?: (message: string) => void;
};

function writePendingSession(input: {
  orderId: string;
  number: string;
  paymentId?: string;
  payToken?: string;
  confirmed?: boolean;
}) {
  try {
    if (input.confirmed) {
      sessionStorage.setItem('miraflores.pendingPaidConfirmed', input.orderId || '1');
    }
    sessionStorage.setItem('miraflores.pendingOrderId', input.orderId);
    sessionStorage.setItem('miraflores.pendingOrderNumber', input.number);
    if (input.paymentId) {
      sessionStorage.setItem('miraflores.pendingPaymentId', input.paymentId);
    }
    if (input.payToken) {
      sessionStorage.setItem('miraflores.pendingPayToken', input.payToken);
    }
  } catch {
    /* ignore */
  }
}

export function clearPendingPaymentSession() {
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

/**
 * Общий поток: POST …/pay → confirmationToken + poll status.
 * Используется checkout / account / certificates.
 */
export function useYooKassaOrderPayment(opts: Options) {
  const pollMs = opts.pollMs ?? 4000;
  const persistSession = opts.persistSession ?? true;
  const onPaidRef = useRef(opts.onPaid);
  const onErrorRef = useRef(opts.onError);
  onPaidRef.current = opts.onPaid;
  onErrorRef.current = opts.onError;

  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);
  const paidRef = useRef(false);
  const [confirmationToken, setConfirmationToken] = useState<string | null>(
    null,
  );
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [payToken, setPayToken] = useState<string | null>(null);
  const [orderMeta, setOrderMeta] = useState<{
    orderId: string;
    number: string;
  } | null>(null);

  const markPaid = useCallback((info: PaidInfo) => {
    if (paidRef.current) return;
    paidRef.current = true;
    setPaid(true);
    setConfirmationToken(null);
    onPaidRef.current(info);
  }, []);

  const checkPaid = useCallback(async () => {
    if (!paymentId || paidRef.current) return false;
    const token =
      payToken ||
      (typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem('miraflores.pendingPayToken')
        : null);
    if (!token) return false;
    try {
      const res = await fetch(
        `/api/public/orders/payments/${encodeURIComponent(paymentId)}/status?payToken=${encodeURIComponent(token)}`,
        { cache: 'no-store' },
      );
      const data = (await res.json().catch(() => ({}))) as {
        paid?: boolean;
        number?: string;
        orderId?: string;
        message?: string;
      };
      if (!res.ok || !data.paid) {
        // Не спамим onError при обычном poll «ещё не оплачено»
        if (!res.ok && data.message) onErrorRef.current?.(data.message);
        return false;
      }
      markPaid({
        orderId: data.orderId || orderMeta?.orderId || '',
        number: data.number || orderMeta?.number || '',
        message: data.message,
      });
      return true;
    } catch {
      return false;
    }
  }, [markPaid, orderMeta?.number, orderMeta?.orderId, payToken, paymentId]);

  const startPay = useCallback(
    async (orderId: string, token: string) => {
      setBusy(true);
      try {
        const res = await fetch(
          `/api/public/orders/${encodeURIComponent(orderId)}/pay`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ payToken: token }),
            cache: 'no-store',
          },
        );
        const data = (await res.json().catch(() => ({}))) as PayStartResult;
        if (!res.ok) {
          onErrorRef.current?.(readApiError(data, 'Не удалось создать платёж'));
          return null;
        }
        setPayToken(token);
        setOrderMeta({ orderId: data.orderId, number: data.number });

        if (data.alreadyPaid) {
          if (persistSession) {
            writePendingSession({
              orderId: data.orderId,
              number: data.number,
              payToken: token,
              confirmed: true,
            });
          }
          markPaid({ orderId: data.orderId, number: data.number });
          return data;
        }

        if (!data.confirmationToken || !data.paymentId) {
          onErrorRef.current?.('Сервер не вернул данные оплаты');
          return null;
        }

        setConfirmationToken(data.confirmationToken);
        setPaymentId(data.paymentId);
        if (persistSession) {
          writePendingSession({
            orderId: data.orderId,
            number: data.number,
            paymentId: data.paymentId,
            payToken: token,
          });
        }
        return data;
      } catch {
        onErrorRef.current?.('Сеть недоступна');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [markPaid, persistSession],
  );

  const resetPayment = useCallback(() => {
    paidRef.current = false;
    setPaid(false);
    setConfirmationToken(null);
    setPaymentId(null);
    setPayToken(null);
    setOrderMeta(null);
    if (persistSession) clearPendingPaymentSession();
  }, [persistSession]);

  useEffect(() => {
    if (!paymentId || paid) return;
    const id = window.setInterval(() => {
      void checkPaid();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [checkPaid, paid, paymentId, pollMs]);

  return {
    busy,
    paid,
    confirmationToken,
    paymentId,
    payToken,
    orderMeta,
    showWidget: Boolean(confirmationToken && paymentId && !paid),
    startPay,
    checkPaid,
    resetPayment,
    markPaid,
  };
}
