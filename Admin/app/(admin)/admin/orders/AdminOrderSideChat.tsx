'use client';

import { useMemo, useRef } from 'react';
import { useOrderChatPanelVisible } from '@/hooks/useOrderChatPanelVisible';
import { adminChatTargetKey } from '@/lib/orderChat/adminChatPaths';
import { ChatWindow } from '@/components/ChatWindow/ChatWindow';
import { useAdminOrderChat } from '@/hooks/useAdminOrderChat';
import orderStyles from './orders.module.css';

export function AdminOrderSideChat({
  orderId,
  buyerUserId,
  staffUserId,
  staffAvatarUrl,
  active = true,
  inModal = false,
}: {
  orderId: string;
  /** Зарегистрированный покупатель; без него чат по заказу недоступен (гостевой заказ). */
  buyerUserId: string | null;
  staffUserId?: string | null;
  staffAvatarUrl?: string | null;
  /** Панель видима (модалка открыта) — WS и mark-read. */
  active?: boolean;
  inModal?: boolean;
}) {
  const chatAvailable = Boolean(buyerUserId?.trim());
  const chatTarget = useMemo(
    () => ({ kind: 'order' as const, orderId }),
    [orderId],
  );

  const chatPanelRef = useRef<HTMLDivElement>(null);
  const chatPanelVisible = useOrderChatPanelVisible(chatPanelRef, active && chatAvailable);
  const chatThreadKey = adminChatTargetKey(chatTarget);

  const {
    chatMessages,
    chatLoading,
    chatError,
    chatComposerDisabled,
    chatSendDisabled,
    chatAttachPickerDisabled,
    pendingAttachmentsHint,
    pendingOutgoingAttachments,
    canSendAttachmentMessage,
    sendChatText,
    attachChatFiles,
    removePendingChatAttachment,
    deleteChatMessage,
    chatHasOlderHistory,
    chatLoadingOlderHistory,
    loadOlderChatMessages,
  } = useAdminOrderChat({
    target: chatTarget,
    enabled: chatAvailable && active,
    staffUserId,
    staffAvatarUrl,
    panelVisible: chatPanelVisible,
  });

  if (!chatAvailable) {
    return (
      <div
        ref={chatPanelRef}
        className={
          inModal ? orderStyles.orderDetailChatModalBody : orderStyles.orderDetailChatWrap
        }
      >
        <p className={orderStyles.orderDetailChatGuestHint}>
          Чат недоступен: у заказа нет аккаунта покупателя (гостевой заказ).
        </p>
      </div>
    );
  }

  return (
    <div
      ref={chatPanelRef}
      className={
        inModal ? orderStyles.orderDetailChatModalBody : orderStyles.orderDetailChatWrap
      }
    >
      <ChatWindow
        key={chatThreadKey}
        threadKey={chatThreadKey}
        variant="embedded"
        embeddedLayout="fill"
        open
        hideCloseButton
        title={inModal ? '' : 'Чат с клиентом'}
        titleTransform="none"
        messages={chatMessages}
        messageEmptyHint={chatLoading ? 'Загрузка…' : 'Сообщений пока нет'}
        inputPlaceholder="Напишите клиенту…"
        errorText={chatError}
        uiVariant="admin"
        frameless
        confirmBeforeDelete
        composerDisabled={chatComposerDisabled}
        sendDisabled={chatSendDisabled}
        attachPickerDisabled={chatAttachPickerDisabled}
        attachmentsEnabled
        pendingAttachmentsHint={pendingAttachmentsHint}
        pendingOutgoing={pendingOutgoingAttachments}
        allowEmptySend={canSendAttachmentMessage}
        onSend={sendChatText}
        onAttachFiles={attachChatFiles}
        onRemovePendingAttachment={removePendingChatAttachment}
        onDeleteMessage={deleteChatMessage}
        hasOlderHistory={chatHasOlderHistory}
        loadingOlderHistory={chatLoadingOlderHistory}
        onLoadOlderHistory={loadOlderChatMessages}
        loadOlderHistoryLabel="Показать раньше"
        messageDayLocale="ru-RU"
        onClose={() => {}}
      />
    </div>
  );
}
