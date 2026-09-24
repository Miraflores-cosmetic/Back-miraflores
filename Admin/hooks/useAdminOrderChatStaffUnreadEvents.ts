'use client';

import { useEffect } from 'react';
import { ORDER_CHAT_SOCKET_UPDATED_EVENT } from '@/lib/orderChat/constants';
import {
  fetchOrderChatWsToken,
  getOrCreateSharedOrderChatSocket,
  registerOrderChatWsSession,
  waitOrderChatSocketConnect,
  type OrderChatSocket,
} from '@/lib/orderChat/orderChatWsShared';

const DOM_REFRESH_ORDERS = 'admin-orders-chat-unread-refresh';
/** Событие `order_chat_updated` может лететь часто; суммируем в один refresh суммаризации. */
const DEBOUNCE_MS = 500;

function dispatchUnreadRefreshDebounced(ref: {
  bounce: ReturnType<typeof setTimeout> | undefined;
}) {
  if (typeof document === 'undefined') return;
  if (ref.bounce != null) clearTimeout(ref.bounce);
  ref.bounce = setTimeout(() => {
    ref.bounce = undefined;
    document.dispatchEvent(new Event(DOM_REFRESH_ORDERS));
  }, DEBOUNCE_MS);
}

/**
 * Глушка на «широкий» канал **`order_chat_updated`** (комната `staffOrderChat` у всех подключённых админов/модераторов):
 * поддерживается общий admin Socket.IO-слой через refcount с `useOrderChat`, при событии — debounce → DOM **admin-orders-chat-unread-refresh**.
 * При большой нагрузке см. `docs/order-chat-structure.md` (узкие комнаты / офисный контекст).
 */
export function useAdminOrderChatStaffUnreadEvents(isLoginRoute: boolean) {
  useEffect(() => {
    if (isLoginRoute || typeof window === 'undefined') return undefined;

    let cancelled = false;
    const debounceRef: { bounce: ReturnType<typeof setTimeout> | undefined } = { bounce: undefined };
    let unregisterSession: (() => void) | undefined;
    let detachSocketHandlers: (() => void) | undefined;
    let removeLayerListener: (() => void) | undefined;

    void (async () => {
      try {
        const wsAuth = await fetchOrderChatWsToken('admin');
        if (cancelled) return;
        unregisterSession = registerOrderChatWsSession('admin', wsAuth);
        if (cancelled) {
          unregisterSession();
          unregisterSession = undefined;
          return;
        }
        const socket = await getOrCreateSharedOrderChatSocket('admin', wsAuth);
        await waitOrderChatSocketConnect(socket).catch(() => undefined);
        if (cancelled) {
          unregisterSession?.();
          unregisterSession = undefined;
          return;
        }

        const attach = (sock: OrderChatSocket): void => {
          detachSocketHandlers?.();
          const onWideStaff = (): void => {
            dispatchUnreadRefreshDebounced(debounceRef);
          };
          const onSupport = (): void => {
            dispatchUnreadRefreshDebounced(debounceRef);
          };
          sock.on('support_chat_updated', onSupport);
          sock.on('staff_inbox_updated', onWideStaff);
          detachSocketHandlers = () => {
            sock.off('support_chat_updated', onSupport);
            sock.off('staff_inbox_updated', onWideStaff);
            detachSocketHandlers = undefined;
          };
        };

        attach(socket);

        const onSocketLayerUpdated = ((ev: Event) => {
          const ce = ev as CustomEvent<{ variant?: string; socket?: OrderChatSocket }>;
          if (ce.detail?.variant !== 'admin' || !ce.detail.socket) return;
          attach(ce.detail.socket);
        }) as EventListener;

        window.addEventListener(ORDER_CHAT_SOCKET_UPDATED_EVENT, onSocketLayerUpdated);
        removeLayerListener = () => window.removeEventListener(ORDER_CHAT_SOCKET_UPDATED_EVENT, onSocketLayerUpdated);
      } catch {
        /* токена нет или сеть — бейджи обновятся по переходам */
      }
    })();

    return () => {
      cancelled = true;
      if (debounceRef.bounce != null) clearTimeout(debounceRef.bounce);
      detachSocketHandlers?.();
      removeLayerListener?.();
      unregisterSession?.();
    };
  }, [isLoginRoute]);
}
