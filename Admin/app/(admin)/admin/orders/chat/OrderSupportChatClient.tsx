'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOrderChatPanelVisible } from '@/hooks/useOrderChatPanelVisible';
import { adminChatTargetKey } from '@/lib/orderChat/adminChatPaths';
import Link from 'next/link';
import { ChatWindow } from '@/components/ChatWindow/ChatWindow';
import { AdminListShell } from '@/components/admin/AdminListShell/AdminListShell';
import { useAdminOrderChat } from '@/hooks/useAdminOrderChat';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminDateTime } from '@/lib/adminFormat';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import orderStyles from '../orders.module.css';

const styles = { ...catalogStyles, ...orderStyles };

type SupportThread = {
  userId: string;
  userEmail: string;
  userDisplayName: string | null;
  conversationId: string;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
};

export function OrderSupportChatClient({
  staffUserId,
  staffAvatarUrl,
}: {
  staffUserId?: string | null;
  staffAvatarUrl?: string | null;
}) {
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const loadThreads = useCallback(async () => {
    setError(null);
    try {
      const data = await adminBackendJson<{ threads: SupportThread[] }>(
        'orders/admin/chat/support-threads?limit=80',
      );
      setThreads(data.threads ?? []);
      setSelectedUserId((cur) =>
        cur && data.threads.some((t) => t.userId === cur) ? cur : null,
      );
    } catch (e) {
      setThreads([]);
      setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    const onRefresh = () => void loadThreads();
    document.addEventListener('admin-orders-chat-unread-refresh', onRefresh);
    return () => document.removeEventListener('admin-orders-chat-unread-refresh', onRefresh);
  }, [loadThreads]);

  const selected = useMemo(
    () => threads.find((t) => t.userId === selectedUserId) ?? null,
    [threads, selectedUserId],
  );

  const chatTarget = useMemo(
    () => (selectedUserId ? { kind: 'support' as const, userId: selectedUserId } : null),
    [selectedUserId],
  );

  const chatPanelRef = useRef<HTMLDivElement>(null);
  const chatPanelVisible = useOrderChatPanelVisible(chatPanelRef, Boolean(selectedUserId));

  const chat = useAdminOrderChat({
    target: chatTarget,
    enabled: Boolean(selectedUserId),
    staffUserId,
    staffAvatarUrl,
    panelVisible: chatPanelVisible && Boolean(selectedUserId),
  });

  const chatThreadKey = chatTarget ? adminChatTargetKey(chatTarget) : '';

  const chatTitle = selected
    ? selected.userDisplayName?.trim() || selected.userEmail
    : 'Диалог';

  return (
    <div className={styles.supportChatPage}>
      <div className={styles.supportChatHeader}>
        <h1 className={styles.sectionTitle}>Чаты поддержки</h1>
        <p className={styles.muted}>
          Общие диалоги без привязки к заказу. Чат по заказу — в карточке заказа.
        </p>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.supportChatLayout}>
        <div className={styles.supportChatThreadList}>
          <AdminListShell
            loading={loading}
            error={null}
            loadingLabel="Загрузка…"
            isEmpty={!loading && threads.length === 0}
            empty={<p className={styles.muted}>Пока нет диалогов</p>}
            wrapContent={false}
            styles={styles}
          >
          <ul className={styles.supportChatThreads}>
            {threads.map((t) => {
              const active = t.userId === selectedUserId;
              const label = t.userDisplayName?.trim() || t.userEmail;
              return (
                <li key={t.userId}>
                  <button
                    type="button"
                    className={`${styles.supportChatThreadBtn} ${active ? styles.supportChatThreadBtnActive : ''}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => setSelectedUserId(t.userId)}
                  >
                    <span className={styles.supportChatThreadTitle}>
                      {label}
                      {t.unreadCount > 0 ? (
                        <span className={styles.orderChatUnreadBadge} aria-hidden>
                          {t.unreadCount > 99 ? '99+' : t.unreadCount}
                        </span>
                      ) : null}
                    </span>
                    {t.lastMessagePreview ? (
                      <span className={styles.supportChatThreadPreview}>{t.lastMessagePreview}</span>
                    ) : null}
                    {t.lastMessageAt ? (
                      <span className={styles.supportChatThreadTime}>
                        {formatAdminDateTime(t.lastMessageAt)}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          </AdminListShell>
        </div>
        <div className={styles.supportChatPanel}>
          {selected ? (
            <>
              <div className={styles.supportChatPanelHead}>
                <strong>{chatTitle}</strong>
                <Link href={`/admin/users/${selected.userId}`} className={styles.orderInlineLink}>
                  Профиль
                </Link>
              </div>
              <div ref={chatPanelRef} className={styles.supportChatPanelBody}>
                <ChatWindow
                  key={chatThreadKey}
                  threadKey={chatThreadKey}
                  variant="embedded"
                  embeddedLayout="fill"
                  open
                  hideCloseButton
                  title={chatTitle}
                  titleTransform="none"
                  messages={chat.chatMessages}
                  messageEmptyHint={chat.chatLoading ? 'Загрузка…' : 'Напишите первым'}
                  inputPlaceholder="Ответ клиенту…"
                  errorText={chat.chatError}
                  uiVariant="admin"
                  confirmBeforeDelete
                  composerDisabled={chat.chatComposerDisabled}
                  sendDisabled={chat.chatSendDisabled}
                  attachPickerDisabled={chat.chatAttachPickerDisabled}
                  attachmentsEnabled
                  pendingAttachmentsHint={chat.pendingAttachmentsHint}
                  pendingOutgoing={chat.pendingOutgoingAttachments}
                  allowEmptySend={chat.canSendAttachmentMessage}
                  onSend={chat.sendChatText}
                  onAttachFiles={chat.attachChatFiles}
                  onRemovePendingAttachment={chat.removePendingChatAttachment}
                  onDeleteMessage={chat.deleteChatMessage}
                  hasOlderHistory={chat.chatHasOlderHistory}
                  loadingOlderHistory={chat.chatLoadingOlderHistory}
                  onLoadOlderHistory={chat.loadOlderChatMessages}
                  loadOlderHistoryLabel="Показать раньше"
                  messageDayLocale="ru-RU"
                  onClose={() => {}}
                />
              </div>
            </>
          ) : (
            <p className={styles.muted}>Выберите диалог слева</p>
          )}
        </div>
      </div>
    </div>
  );
}
