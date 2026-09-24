'use client';

import { useMemo, useRef } from 'react';
import { useOrderChatPanelVisible } from '@/hooks/useOrderChatPanelVisible';
import { adminChatTargetKey } from '@/lib/orderChat/adminChatPaths';
import { ChatWindow } from '@/components/ChatWindow/ChatWindow';
import { useAdminOrderChat } from '@/hooks/useAdminOrderChat';
import orderStyles from './orders.module.css';

export function AdminOrderSideChat({
  orderId,
  staffUserId,
  staffAvatarUrl,
}: {
  orderId: string;
  staffUserId?: string | null;
  staffAvatarUrl?: string | null;
}) {
  const chatTarget = useMemo(
    () => ({ kind: 'order' as const, orderId }),
    [orderId],
  );

  const chatPanelRef = useRef<HTMLDivElement>(null);
  const chatPanelVisible = useOrderChatPanelVisible(chatPanelRef);
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
    enabled: true,
    staffUserId,
    staffAvatarUrl,
    panelVisible: chatPanelVisible,
  });

  return (
    <div ref={chatPanelRef} className={orderStyles.orderDetailChatWrap}>
      <ChatWindow
        key={chatThreadKey}
        threadKey={chatThreadKey}
        variant="embedded"
        embeddedLayout="fill"
        open
        hideCloseButton
        title="Чат с клиентом"
        titleTransform="none"
        messages={chatMessages}
        messageEmptyHint={chatLoading ? 'Загрузка…' : 'Сообщений пока нет'}
        inputPlaceholder="Напишите клиенту…"
        errorText={chatError}
        uiVariant="admin"
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
