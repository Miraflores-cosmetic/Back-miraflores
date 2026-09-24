'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminBackendJson } from '@/lib/adminBackendFetch';

export const ADMIN_ORDERS_UNVIEWED_REFRESH_EVENT = 'admin-orders-unviewed-refresh';

const POLL_MS = 30_000;

export function dispatchAdminOrdersUnviewedRefresh(): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new Event(ADMIN_ORDERS_UNVIEWED_REFRESH_EVENT));
}

/** Оплаченные заказы, которые ещё никто из сотрудников не открывал (бейдж «Заказы» в сайдбаре). */
export function useAdminUnviewedOrdersCount(enabled: boolean, pathname: string): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setCount(0);
      return;
    }
    try {
      const res = await adminBackendJson<{ count?: number }>('orders/admin/unviewed-count');
      const n = typeof res.count === 'number' && res.count > 0 ? Math.floor(res.count) : 0;
      setCount(n);
    } catch {
      /* сеть / 403 — оставляем последнее значение */
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onRefresh = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    document.addEventListener(ADMIN_ORDERS_UNVIEWED_REFRESH_EVENT, onRefresh);
    window.addEventListener('focus', onRefresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener(ADMIN_ORDERS_UNVIEWED_REFRESH_EVENT, onRefresh);
      window.removeEventListener('focus', onRefresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, refresh]);

  return count;
}
