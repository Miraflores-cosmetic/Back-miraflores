export type {
  AdminSupportThread,
  AdminSupportThreadsResponse,
  OrderChatApiAttachment,
  OrderChatApiMessage,
  OrderChatMessagesResponse,
  OrderChatPendingUiAttachment,
} from '@miraflores/order-chat-core';

/** Внутреннее состояние useChatAttachments (админка). */
export type PendingAttachmentRef = {
  clientToken: string;
  fileUrl: string;
  filename: string;
  mimeType: string;
  kind: 'FILE' | 'IMAGE';
  localPreviewUrl?: string;
  uploading?: boolean;
};
