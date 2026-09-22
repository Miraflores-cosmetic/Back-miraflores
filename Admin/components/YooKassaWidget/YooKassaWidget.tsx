'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './YooKassaWidget.module.css';

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    YooMoneyCheckoutWidget: any;
  }
}

export type YooKassaPaymentResult = {
  paymentId?: string;
  status?: string;
  paid?: boolean;
};

type Props = {
  confirmationToken: string;
  paymentId?: string | null;
  /** HMAC для /payments/:id/status (без него verify 400). */
  payToken?: string | null;
  onSuccess?: (result: YooKassaPaymentResult) => void;
  onError?: (error: unknown) => void;
  onClose?: () => void;
};

export function YooKassaWidget({
  confirmationToken,
  paymentId = null,
  payToken = null,
  onSuccess,
  onError,
  onClose,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const widgetRef = useRef<any>(null);
  const paymentHandledRef = useRef(false);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const onCloseRef = useRef(onClose);
  const paymentIdRef = useRef(paymentId);
  const payTokenRef = useRef(payToken);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;
  onCloseRef.current = onClose;
  paymentIdRef.current = paymentId;
  payTokenRef.current = payToken;

  const finishWithSuccess = useCallback((result: YooKassaPaymentResult = {}) => {
    if (paymentHandledRef.current) return;
    paymentHandledRef.current = true;
    onSuccessRef.current?.({
      paymentId: result.paymentId || paymentIdRef.current || undefined,
      status: result.status || 'succeeded',
      paid: true,
    });
  }, []);

  const verifyPaymentStatus = useCallback(async () => {
    const id = paymentIdRef.current;
    if (!id) return false;
    const token = payTokenRef.current?.trim() || '';
    try {
      const url = token
        ? `/api/public/orders/payments/${encodeURIComponent(id)}/status?payToken=${encodeURIComponent(token)}`
        : `/api/public/orders/payments/${encodeURIComponent(id)}/status`;
      const res = await fetch(url, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { status?: string; paid?: boolean };
      if (data.status === 'succeeded' || data.paid) {
        finishWithSuccess({ paymentId: id, status: data.status, paid: true });
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }, [finishWithSuccess]);

  const verifyWithRetry = useCallback(
    async (maxAttempts = 5, delayMs = 2000) => {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (paymentHandledRef.current) return true;
        if (await verifyPaymentStatus()) return true;
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      return false;
    },
    [verifyPaymentStatus],
  );

  useEffect(() => {
    if (!confirmationToken) {
      setError('Не указан токен подтверждения');
      setLoading(false);
      return;
    }

    paymentHandledRef.current = false;
    let cancelled = false;

    const loadWidget = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!window.YooMoneyCheckoutWidget) {
          const existing = document.getElementById('YooMoneyCheckoutWidget');
          if (!existing) {
            const script = document.createElement('script');
            script.id = 'YooMoneyCheckoutWidget';
            script.src = 'https://yookassa.ru/checkout-widget/v1/checkout-widget.js';
            script.async = true;
            await new Promise<void>((resolve, reject) => {
              script.onload = () => resolve();
              script.onerror = () =>
                reject(new Error('Не удалось загрузить виджет ЮKassa'));
              document.head.appendChild(script);
            });
          }
          let attempts = 0;
          while (!window.YooMoneyCheckoutWidget && attempts < 20) {
            await new Promise((r) => setTimeout(r, 100));
            attempts++;
          }
          if (!window.YooMoneyCheckoutWidget) {
            throw new Error('Виджет ЮKassa не загрузился');
          }
        }

        if (!containerRef.current) {
          throw new Error('Контейнер виджета не найден');
        }

        if (widgetRef.current) {
          try {
            widgetRef.current.destroy?.();
          } catch {
            /* ignore */
          }
        }

        // return_url не передаём в виджет — иначе success/complete не приходят в embedded.
        // Цвета под UI Jcos (PrimaryBtn / checkout).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const config: any = {
          confirmation_token: confirmationToken,
          customization: {
            colors: {
              control_primary: '#111111',
              control_primary_content: '#FFFFFF',
              control_secondary: '#F5F5F5',
              background: '#FFFFFF',
              text: '#111111',
              border: '#E5E5E5',
            },
          },
          error_callback: (err: unknown) => {
            setError('Ошибка при обработке платежа');
            onErrorRef.current?.(err);
          },
        };

        widgetRef.current = new window.YooMoneyCheckoutWidget(config);
        widgetRef.current.on('success', (result: YooKassaPaymentResult) => {
          finishWithSuccess(result);
        });
        widgetRef.current.on('complete', () => {
          void verifyWithRetry();
        });
        widgetRef.current.on('fail', () => {
          /* пользователь может повторить в виджете */
        });
        widgetRef.current.on('modal_close', () => {
          if (paymentHandledRef.current) return;
          void verifyWithRetry().then((handled) => {
            if (!handled) onCloseRef.current?.();
          });
        });

        if (!containerRef.current.id) {
          containerRef.current.id = `yookassa-widget-${Date.now()}`;
        }
        await widgetRef.current.render(containerRef.current.id);
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Ошибка загрузки виджета');
          setLoading(false);
          onErrorRef.current?.(err);
        }
      }
    };

    const t = setTimeout(() => void loadWidget(), 80);
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (widgetRef.current) {
        try {
          widgetRef.current.destroy?.();
        } catch {
          /* ignore */
        }
      }
    };
  }, [confirmationToken, finishWithSuccess, verifyWithRetry]);

  if (error) {
    return (
      <div className={styles.errorBox} role="alert">
        <p className={styles.errorTitle}>Не удалось загрузить оплату</p>
        <p className={styles.errorText}>{error}</p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.container} />
      {loading ? (
        <div className={styles.loading} aria-live="polite">
          Загрузка формы оплаты…
        </div>
      ) : null}
    </div>
  );
}
