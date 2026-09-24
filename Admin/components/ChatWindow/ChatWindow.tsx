'use client';

import {
  ChatWindow as OrderChatWindowBase,
  type ChatDocAttachment,
  type ChatImageAttachment,
  type ChatWindowMessage,
} from '@miraflores/order-chat-ui';
import { openOrderChatPhotoSwipe } from '@/lib/orderChat/openOrderChatPhotoSwipe';
import type { ComponentProps } from 'react';

export type { ChatDocAttachment, ChatImageAttachment, ChatWindowMessage };

type Props = ComponentProps<typeof OrderChatWindowBase>;

export function ChatWindow(props: Props) {
  return (
    <OrderChatWindowBase
      {...props}
      onOpenImageGallery={(urls, index) => void openOrderChatPhotoSwipe(urls, index)}
    />
  );
}
