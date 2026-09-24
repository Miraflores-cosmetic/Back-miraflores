'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOrderChatPanelVisible } from '@/hooks/useOrderChatPanelVisible';
import { adminChatTargetKey } from '@/lib/orderChat/adminChatPaths';
import Link from 'next/link';
import { ChatWindow } from '@/components/ChatWindow/ChatWindow';
import { AdminListShell } from '@/components/admin/AdminListShell/AdminListShell';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import { useAdminOrderChat } from '@/hooks/useAdminOrderChat';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminDateTime } from '@/lib/adminFormat';
import type { AdminSupportThread, AdminSupportThreadsResponse } from '@/lib/orderChat/types';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import orderStyles from '../orders.module.css';

const styles = { ...catalogStyles, ...orderStyles };

const THREADS_PAGE = 30;
const THREADS_REFRESH_MAX = 100;

type ThreadFilter = 'all' | 'unread';

function supportThreadsPath(opts: {
  q: string;
  filter: ThreadFilter;
  limit: number;
  cursor?: string | null;
}): string {
  const p = new URLSearchParams({ limit: String(opts.limit) });
  if (opts.q.trim()) p.set('q', opts.q.trim());
  if (opts.filter === 'unread') p.set('filter', 'unread');
  if (opts.cursor) p.set('cursor', opts.cursor);
  return `orders/admin/chat/support-threads?${p.toString()}`;
}

export function OrderSupportChatClient({
  staffUserId,
  staffAvatarUrl,
}: {
  staffUserId?: string | null;
  staffAvatarUrl?: string | null;
}) {
  const [threads, setThreads] = useState<AdminSupportThread[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadThreadsTotal, setUnreadThreadsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [filter, setFilter] = useState<ThreadFilter>('all');

  const loadedCountRef = useRef(0);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  /** Первая страница (или перезагрузка уже подгруженного объёма при фоновом обновлении). */
  const loadThreads = useCallback(
    async (mode: 'reset' | 'refresh') => {
      const seq = ++requestSeqRef.current;
      const limit =
        mode === 'refresh'
          ? Math.min(THREADS_REFRESH_MAX, Math.max(THREADS_PAGE, loadedCountRef.current))
          : THREADS_PAGE;
      if (mode === 'reset') setLoading(true);
      setError(null);
      try {
        const data = await adminBackendJson<AdminSupportThreadsResponse>(
          supportThreadsPath({ q: qDebounced, filter, limit }),
        );
        if (seq !== requestSeqRef.current) return;
        const list = data.threads ?? [];
        loadedCountRef.current = list.length;
        setThreads(list);
        setNextCursor(data.nextCursor ?? null);
        setUnreadThreadsTotal(data.unreadThreadsTotal ?? 0);
      } catch (e) {
        if (seq !== requestSeqRef.current) return;
        if (mode === 'reset') {
          setThreads([]);
          setNextCursor(null);
          loadedCountRef.current = 0;
        }
        setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки');
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    },
    [qDebounced, filter],
  );

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const seq = requestSeqRef.current;
    setLoadingMore(true);
    try {
      const data = await adminBackendJson<AdminSupportThreadsResponse>(
        supportThreadsPath({ q: qDebounced, filter, limit: THREADS_PAGE, cursor: nextCursor }),
      );
      if (seq !== requestSeqRef.current) return;
      setThreads((prev) => {
        const seen = new Set(prev.map((t) => t.userId));
        const merged = [...prev, ...(data.threads ?? []).filter((t) => !seen.has(t.userId))];
        loadedCountRef.current = merged.length;
        return merged;
      });
      setNextCursor(data.nextCursor ?? null);
      setUnreadThreadsTotal(data.unreadThreadsTotal ?? 0);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setError(e instanceof AdminBackendRequestError ? e.message : 'Ошибка загрузки');
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, qDebounced, filter]);

  useEffect(() => {
    void loadThreads('reset');
  }, [loadThreads]);

  useEffect(() => {
    const onRefresh = () => void loadThreads('refresh');
    document.addEventListener('admin-orders-chat-unread-refresh', onRefresh);
    return () => document.removeEventListener('admin-orders-chat-unread-refresh', onRefresh);
  }, [loadThreads]);

  const [selectedSnapshot, setSelectedSnapshot] = useState<AdminSupportThread | null>(null);
  const selected = useMemo(
    () =>
      threads.find((t) => t.userId === selectedUserId) ??
      (selectedSnapshot?.userId === selectedUserId ? selectedSnapshot : null),
    [threads, selectedUserId, selectedSnapshot],
  );

  const selectThread = (t: AdminSupportThread) => {
    setSelectedUserId(t.userId);
    setSelectedSnapshot(t);
  };

  const hasQuery = qDebounced.trim().length > 0;
  const emptyText = hasQuery
    ? 'Ничего не найдено'
    : filter === 'unread'
      ? 'Непрочитанных диалогов нет'
      : 'Пока нет диалогов';

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
          <div className={styles.supportChatThreadToolbar}>
            <AdminSearchBox
              placeholder="Email, имя, телефон, текст"
              ariaLabel="Поиск диалогов"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className={styles.supportChatFilters} role="group" aria-label="Фильтр диалогов">
              <button
                type="button"
                className={`${styles.supportChatFilterBtn} ${filter === 'all' ? styles.supportChatFilterBtnActive : ''}`}
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                Все
              </button>
              <button
                type="button"
                className={`${styles.supportChatFilterBtn} ${filter === 'unread' ? styles.supportChatFilterBtnActive : ''}`}
                aria-pressed={filter === 'unread'}
                onClick={() => setFilter('unread')}
              >
                Непрочитанные
                {unreadThreadsTotal > 0 ? (
                  <span className={styles.orderChatUnreadBadge} aria-label={`${unreadThreadsTotal} непрочитанных`}>
                    {unreadThreadsTotal > 99 ? '99+' : unreadThreadsTotal}
                  </span>
                ) : null}
              </button>
            </div>
          </div>
          <AdminListShell
            loading={loading}
            error={null}
            loadingLabel="Загрузка…"
            isEmpty={!loading && threads.length === 0}
            empty={<p className={`${styles.muted} ${styles.supportChatEmpty}`}>{emptyText}</p>}
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
                    onClick={() => selectThread(t)}
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
          {nextCursor ? (
            <div className={styles.supportChatLoadMore}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? 'Загрузка…' : 'Показать ещё'}
              </button>
            </div>
          ) : null}
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
