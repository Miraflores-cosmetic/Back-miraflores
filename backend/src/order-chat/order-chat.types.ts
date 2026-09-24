import type { ChatAttachmentKind, ChatMessageAuthorRole } from '@prisma/client';

export type OrderChatAttachmentOut = {
  id: string;
  fileUrl: string;
  filename: string;
  mimeType: string | null;
  kind: ChatAttachmentKind;
};

export type OrderChatMessageOut = {
  id: string;
  conversationId: string;
  authorUserId: string | null;
  authorRole: ChatMessageAuthorRole;
  authorLabel: string;
  authorAvatarUrl: string | null;
  body: string;
  deletedAt: string | null;
  createdAt: string;
  attachments: OrderChatAttachmentOut[];
};

export type ChatThreadListItem = {
  kind: 'SUPPORT' | 'ORDER';
  conversationId: string | null;
  orderId?: string;
  orderNumber?: string;
  title: string;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
};

export type ChatCustomerPresenceContext =
  | { kind: 'ORDER'; orderId: string; customerUserId: string }
  | { kind: 'SUPPORT'; customerUserId: string };

export interface OrderChatRealtimeEmitter {
  broadcastOrderMessage(orderId: string, payload: OrderChatMessageOut): void;
  broadcastOrderMessageDeleted(orderId: string, payload: { id: string }): void;
  broadcastSupportMessage(userId: string, payload: OrderChatMessageOut): void;
  broadcastSupportMessageDeleted(userId: string, payload: { id: string }): void;
  broadcastStaffInboxUpdated(): void;
  isCustomerChatOnline(ctx: ChatCustomerPresenceContext): Promise<boolean>;
}
