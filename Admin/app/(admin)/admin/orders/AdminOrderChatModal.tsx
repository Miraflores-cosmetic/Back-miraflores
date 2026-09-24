'use client';

import { AdminModal } from '@/components/admin/AdminModal/AdminModal';
import { AdminOrderSideChat } from './AdminOrderSideChat';

export function AdminOrderChatModal({
  open,
  onClose,
  orderId,
  buyerUserId,
  staffUserId,
  staffAvatarUrl,
}: {
  open: boolean;
  onClose: () => void;
  orderId: string;
  buyerUserId: string | null;
  staffUserId?: string | null;
  staffAvatarUrl?: string | null;
}) {
  return (
    <AdminModal
      open={open}
      title="Чат с клиентом"
      size="assistant"
      bodyFlush
      keepMounted
      onClose={onClose}
    >
      <AdminOrderSideChat
        orderId={orderId}
        buyerUserId={buyerUserId}
        staffUserId={staffUserId}
        staffAvatarUrl={staffAvatarUrl}
        active={open}
        inModal
      />
    </AdminModal>
  );
}
