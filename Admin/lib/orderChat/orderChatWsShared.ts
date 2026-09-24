'use client';

import {
  createOrderChatSocketManager,
  type OrderChatSocket,
  type OrderChatVariant,
  type OrderChatWsAuth,
} from '@miraflores/order-chat-core';
import { readUpstreamJsonErrorMessage } from '@/lib/readUpstreamJsonError';
import { getWsOrigin } from '@/lib/orderChat/wsOrigin';

const manager = createOrderChatSocketManager({
  getWsOrigin,
  loadIo: () => import('socket.io-client'),
  fetchWsToken: async (variant: OrderChatVariant) => {
    const res = await fetch('/api/admin/ws-token', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error(await readUpstreamJsonErrorMessage(res));
    const j = (await res.json()) as { token?: string; sub?: string | null; exp?: number | null };
    const token = j.token?.trim();
    if (!token) throw new Error('Нет токена для чата');
    const sub = j.sub === undefined || j.sub === null ? null : String(j.sub);
    let exp: number | null = null;
    if (typeof j.exp === 'number' && Number.isFinite(j.exp)) exp = j.exp;
    return { token, sub: sub === '' ? null : sub, exp };
  },
});

export type { OrderChatWsAuth, OrderChatSocket };
export const ORDER_CHAT_WS_SESSION_EXPIRED_EVENT = manager.ORDER_CHAT_WS_SESSION_EXPIRED_EVENT;

export const isOrderChatWsAuthFailed = manager.isOrderChatWsAuthFailed;
export const disposeSharedOrderChatSocket = manager.disposeSharedOrderChatSocket;
export const teardownOrderChatWsForLogout = manager.teardownOrderChatWsForLogout;
export const fetchOrderChatWsToken = manager.fetchWsToken;
export const waitOrderChatSocketConnect = manager.waitOrderChatSocketConnect;
export const emitOrderChatRoomJoin = manager.emitOrderChatRoomJoin;
export const getOrCreateSharedOrderChatSocket = manager.getOrCreateSharedOrderChatSocket;
export const registerOrderChatWsSession = manager.registerOrderChatWsSession;
