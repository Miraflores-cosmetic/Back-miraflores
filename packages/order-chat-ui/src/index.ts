export {
  ChatWindow,
  type ChatWindowMessage,
  type ChatDocAttachment,
  type ChatImageAttachment,
} from './ChatWindow/ChatWindow';
export { useChatAttachments, type ChatPendingAttachmentRef } from './hooks/useChatAttachments';
export { linkifyChatMessageContent } from './lib/linkifyChatMessageContent';
export {
  ORDER_CHAT_ALLOWED_UPLOAD_MIMES,
  ORDER_CHAT_FILE_INPUT_ACCEPT,
  ORDER_CHAT_UNSUPPORTED_FILE_MESSAGE,
  isAllowedChatUploadFile,
} from './lib/chatUploadAccept';
