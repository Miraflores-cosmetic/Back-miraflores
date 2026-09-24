'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminBackendJson } from '@/lib/adminBackendFetch';

export type AdminChatUnreadCounts = {
  /** Чаты поддержки (инбокс /admin/orders/chat). */
  support: number;
  /** Чаты заказов (карточки заказов). */
  orders: number;
};

const EMPTY: AdminChatUnreadCounts = { support: 0, orders: 0 };

function positive(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Счётчики непрочитанных реплик клиентов для staff: отдельно поддержка и чаты заказов. */
export function useAdminOrderChatUnreadCount(enabled: boolean): AdminChatUnreadCounts {
  const [counts, setCounts] = useState<AdminChatUnreadCounts>(EMPTY);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setCounts(EMPTY);
      return;
    }
    try {
      const data = await adminBackendJson<{ count?: number; support?: number; orders?: number }>(
        'orders/admin/chat/unread-count',
      );
      const next =
        typeof data.support === 'number' || typeof data.orders === 'number'
          ? { support: positive(data.support), orders: positive(data.orders) }
          : { support: positive(data.count), orders: 0 };
      setCounts((prev) =>
        prev.support === next.support && prev.orders === next.orders ? prev : next,
      );
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

  return counts;
}
