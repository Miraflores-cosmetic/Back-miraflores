/** Socket.IO namespace (Nest gateway). */
export const ORDER_CHAT_SOCKET_NAMESPACE = '/order-chat';

export const ROOM_STAFF_ORDER_CHAT = 'staffOrderChat';

export const CHAT_MESSAGES_PAGE_DEFAULT = 50;
export const CHAT_MESSAGES_PAGE_MAX = 100;

export const ORDER_CHAT_POST_BODY_MAX_CHARS = 12000;
export const ORDER_CHAT_ATTACHMENTS_MAX = 12;
export const ORDER_CHAT_ATTACHMENT_REFS_PAYLOAD_MAX_CHARS = 65536;
export const ORDER_CHAT_UPLOAD_MAX_FILE_BYTES = 35 * 1024 * 1024;
export const ORDER_CHAT_DELETE_WITHIN_MS = 24 * 60 * 60 * 1000;
export const ORDER_CHAT_STAFF_REPLY_EMAIL_MIN_INTERVAL_MS = 10 * 60 * 1000;

export type OrderChatVariant = 'account' | 'admin';

export const ORDER_CHAT_WS_REFRESH_BUFFER_MS = 45_000;
export const ORDER_CHAT_WS_REFRESH_FALLBACK_MS = 20 * 60_000;

export const ORDER_CHAT_SOCKET_UPDATED_EVENT = 'order-chat-ws-socket-updated';
export const ORDER_CHAT_WS_SESSION_EXPIRED_EVENT = 'order-chat-ws-session-expired';

export function roomOrderChat(orderId: string): string {
  return `orderChat:${orderId}`;
}

export function roomSupportChat(userId: string): string {
  return `supportChat:${userId}`;
}

/** Все WS-сессии пользователя (logout / смена пароля → disconnect). */
export function roomUserChatSessions(userId: string): string {
  return `userChatSessions:${userId}`;
}

export function chatUploadKeyPrefixOrder(orderId: string): string {
  return `chat/orders/${orderId}/`;
}

export function chatUploadKeyPrefixSupport(userId: string): string {
  return `chat/support/${userId}/`;
}

export function isOrderChatMessageWithinDeleteWindow(
  createdAtIso: string,
  nowMs: number = Date.now(),
): boolean {
  const t = Date.parse(createdAtIso);
  if (Number.isNaN(t)) return false;
  return nowMs - t <= ORDER_CHAT_DELETE_WITHIN_MS;
}
