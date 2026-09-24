export type OrderChatAuthorRole = 'CUSTOMER' | 'STAFF';

export type OrderChatApiAttachment = {
  id: string;
  fileUrl: string;
  filename: string;
  mimeType: string | null;
  kind: 'FILE' | 'IMAGE';
};

export type OrderChatApiMessage = {
  id: string;
  conversationId?: string;
  authorUserId: string | null;
  authorRole: OrderChatAuthorRole;
  authorLabel: string;
  authorAvatarUrl?: string | null;
  body: string;
  deletedAt: string | null;
  createdAt: string;
  attachments: OrderChatApiAttachment[];
};

export type OrderChatMessagesResponse = {
  conversationId: string | null;
  messages: OrderChatApiMessage[];
  hasOlder?: boolean;
};

export type OrderChatPendingUiAttachment = {
  clientKey: string;
  filename: string;
  kind: 'FILE' | 'IMAGE';
  imageSrc?: string | null;
  uploading?: boolean;
};

export type OrderChatUiDocAttachment = {
  id: string;
  filename: string;
  url?: string;
};

export type OrderChatUiImageAttachment = {
  id: string;
  src: string;
  alt?: string;
};

export type OrderChatUiMessage = {
  id: string;
  senderName: string;
  senderAvatarUrl?: string | null;
  timeLabel: string;
  content?: string;
  documents?: OrderChatUiDocAttachment[];
  images?: OrderChatUiImageAttachment[];
  isDeleted?: boolean;
  deletable?: boolean;
  ocAuthorUserId?: string;
  ocAuthorRole?: OrderChatAuthorRole;
  ocCreatedAtIso?: string;
  isPending?: boolean;
};

export type OrderChatThread = {
  kind: 'SUPPORT' | 'ORDER';
  conversationId: string | null;
  orderId?: string;
  orderNumber?: string;
  title: string;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
};

export type OrderChatStartableOrder = {
  orderId: string;
  orderNumber: string;
  createdAt: string;
};

export type OrderChatThreadsResponse = {
  threads: OrderChatThread[];
  /** Последние заказы без переписки — для «Начать чат по заказу». */
  startableOrders?: OrderChatStartableOrder[];
};

export type AdminSupportThread = {
  userId: string;
  userEmail: string;
  userDisplayName: string | null;
  conversationId: string;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
};

export type AdminSupportThreadsResponse = {
  threads: AdminSupportThread[];
  nextCursor: string | null;
  unreadThreadsTotal: number;
};
