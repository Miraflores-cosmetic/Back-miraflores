'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminBackendJson } from '@/lib/adminBackendFetch';

/** Непрочитанные staff'ом реплики клиента в чате конкретного заказа. */
export function useAdminOrderChatUnreadForOrder(orderId: string, enabled: boolean): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled || !orderId) {
      setCount(0);
      return;
    }
    try {
      const data = await adminBackendJson<{ count?: number }>(
        `orders/admin/${encodeURIComponent(orderId)}/chat/unread-count`,
      );
      const raw = data.count;
      const n =
        typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
      setCount(n);
    } catch {
      /* бейдж необязателен */
    }
  }, [orderId, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onRefresh = () => void refresh();
    document.addEventListener('admin-orders-chat-unread-refresh', onRefresh);
    window.addEventListener('focus', onRefresh);
    document.addEventListener('visibilitychange', onRefresh);
    return () => {
      document.removeEventListener('admin-orders-chat-unread-refresh', onRefresh);
      window.removeEventListener('focus', onRefresh);
      document.removeEventListener('visibilitychange', onRefresh);
    };
  }, [enabled, refresh]);

  return count;
}
