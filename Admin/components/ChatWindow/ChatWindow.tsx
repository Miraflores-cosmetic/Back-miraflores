'use client';

import {
  ChatWindow as OrderChatWindowBase,
  type ChatDeleteConfirmRenderProps,
  type ChatDocAttachment,
  type ChatImageAttachment,
  type ChatWindowMessage,
} from '@miraflores/order-chat-ui';
import { AdminConfirmDialog } from '@/components/admin/AdminModal/AdminConfirmDialog';
import { openOrderChatPhotoSwipe } from '@/lib/orderChat/openOrderChatPhotoSwipe';
import type { ComponentProps } from 'react';

export type { ChatDocAttachment, ChatImageAttachment, ChatWindowMessage };

type Props = ComponentProps<typeof OrderChatWindowBase>;

function renderAdminDeleteConfirm({ open, onCancel, onConfirm }: ChatDeleteConfirmRenderProps) {
  return (
    <AdminConfirmDialog
      open={open}
      title="Удалить сообщение?"
      message="Сообщение будет скрыто для всех участников. Это действие нельзя отменить."
      confirmLabel="Удалить"
      danger
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export function ChatWindow(props: Props) {
  return (
    <OrderChatWindowBase
      renderDeleteConfirm={renderAdminDeleteConfirm}
      {...props}
      onOpenImageGallery={(urls, index) => void openOrderChatPhotoSwipe(urls, index)}
    />
  );
}
