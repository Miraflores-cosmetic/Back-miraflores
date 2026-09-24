'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminBackendJson } from '@/lib/adminBackendFetch';

/** Счётчик непрочитанных реплик клиента в чатах заказов (глобально для staff). */
export function useAdminOrderChatUnreadCount(enabled: boolean) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setCount(0);
      return;
    }
    try {
      const data = await adminBackendJson<{ count?: number }>('orders/admin/chat/unread-count');
      setCount(typeof data.count === 'number' && data.count > 0 ? data.count : 0);
    } catch {
      /* sidebar badge optional */
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onRefresh = () => void refresh();
    document.addEventListener('admin-orders-chat-unread-refresh', onRefresh);
    return () => document.removeEventListener('admin-orders-chat-unread-refresh', onRefresh);
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [enabled, refresh]);

  return count;
}
