'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useOrderChatPanelVisible } from '@/hooks/useOrderChatPanelVisible';
import { adminChatTargetKey } from '@/lib/orderChat/adminChatPaths';
import { ChatWindow } from '@/components/ChatWindow/ChatWindow';
import { AdminCompactBtn, AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminTabs } from '@/components/AdminTabs/AdminTabs';
import { AdminSearchBox } from '@/components/SearchBox/SearchBox';
import { useAdminOrderChat } from '@/hooks/useAdminOrderChat';
import {
  AdminBackendRequestError,
  adminBackendJson,
} from '@/lib/adminBackendFetch';
import { formatAdminChatListTime, formatAdminDateTime } from '@/lib/adminFormat';
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

function threadLabel(t: Pick<AdminSupportThread, 'userDisplayName' | 'userEmail'>): string {
  return t.userDisplayName?.trim() || t.userEmail;
}

function initialsOf(label: string): string {
  const words = label.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  const letters = words.length >= 2 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

function unreadLabel(n: number): string {
  return n > 99 ? '99+' : String(n);
}

function ChatBubbleIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8.5 10.5h7M8.5 13.5h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function OrderSupportChatClient({
  staffUserId,
  staffAvatarUrl,
}: {
  staffUserId?: string | null;
  staffAvatarUrl?: string | null;
}) {
  const pathname = usePathname() ?? '/admin/orders/chat';
  const searchParams = useSearchParams();
  /** `?user=` — источник истины: ссылка на диалог переживает перезагрузку и шаринг. */
  const selectedUserId = searchParams.get('user')?.trim() || null;
  const setSelectedUserId = useCallback(
    (userId: string | null) => {
      const next = new URLSearchParams(window.location.search);
      if (userId) next.set('user', userId);
      else next.delete('user');
      const qs = next.toString();
      window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname],
  );

  const [threads, setThreads] = useState<AdminSupportThread[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadThreadsTotal, setUnreadThreadsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const threadListRef = useRef<HTMLUListElement>(null);
  const onThreadListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = Array.from(
      threadListRef.current?.querySelectorAll<HTMLButtonElement>('button[data-thread]') ?? [],
    );
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;
    e.preventDefault();
    const next = buttons[e.key === 'ArrowDown' ? idx + 1 : idx - 1];
    next?.focus();
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
  const chatTitle = selected ? threadLabel(selected) : 'Клиент';
  const showEmailLine = Boolean(selected?.userDisplayName?.trim());

  return (
    <>
      <h1 className={styles.title}>Чаты поддержки</h1>
      <p className={styles.lead}>
        Общие диалоги с покупателями без привязки к заказу. Чат по заказу — в карточке заказа.
      </p>

      <div
        className={`${styles.supportChatShell} ${selectedUserId ? styles.supportChatShellChatOpen : ''}`}
      >
        <aside className={styles.supportChatSidebar} aria-label="Диалоги">
          <div className={styles.supportChatSidebarHead}>
            <AdminSearchBox
              placeholder="Email, имя, телефон, текст"
              ariaLabel="Поиск диалогов"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <AdminTabs<ThreadFilter>
              variant="pill"
              ariaLabel="Фильтр диалогов"
              className={styles.supportChatTabs}
              activeId={filter}
              onChange={setFilter}
              items={[
                { id: 'all', label: 'Все' },
                {
                  id: 'unread',
                  label: (
                    <>
                      Непрочитанные
                      {unreadThreadsTotal > 0 ? (
                        <span className={`${styles.orderChatUnreadBadge} ${styles.supportChatBadge}`}>
                          {unreadLabel(unreadThreadsTotal)}
                        </span>
                      ) : null}
                    </>
                  ),
                  'aria-label':
                    unreadThreadsTotal > 0
                      ? `Непрочитанные: ${unreadThreadsTotal}`
                      : 'Непрочитанные',
                },
              ]}
            />
          </div>

          <div className={styles.supportChatSidebarBody}>
            {error ? (
              <div className={styles.supportChatNotice} role="alert">
                <span>{error}</span>
                <AdminCompactBtn
                  variant="outline"
                  onClick={() => void loadThreads(threads.length ? 'refresh' : 'reset')}
                >
                  Повторить
                </AdminCompactBtn>
              </div>
            ) : null}

            {loading ? (
              <p className={styles.supportChatEmpty}>Загрузка…</p>
            ) : threads.length === 0 ? (
              error ? null : <p className={styles.supportChatEmpty}>{emptyText}</p>
            ) : (
              <ul
                ref={threadListRef}
                className={styles.supportChatThreads}
                onKeyDown={onThreadListKeyDown}
              >
                {threads.map((t) => {
                  const active = t.userId === selectedUserId;
                  const unread = t.unreadCount > 0;
                  const label = threadLabel(t);
                  return (
                    <li key={t.userId}>
                      <button
                        type="button"
                        data-thread
                        className={[
                          styles.supportChatThreadBtn,
                          active ? styles.supportChatThreadBtnActive : '',
                          unread ? styles.supportChatThreadBtnUnread : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-current={active ? 'true' : undefined}
                        title={t.userEmail}
                        onClick={() => selectThread(t)}
                      >
                        <span className={styles.supportChatAvatar} aria-hidden>
                          {initialsOf(label)}
                        </span>
                        <span className={styles.supportChatThreadMain}>
                          <span className={styles.supportChatThreadRow}>
                            <span className={styles.supportChatThreadTitle}>{label}</span>
                            {t.lastMessageAt ? (
                              <time
                                className={styles.supportChatThreadTime}
                                dateTime={t.lastMessageAt}
                                title={formatAdminDateTime(t.lastMessageAt)}
                              >
                                {formatAdminChatListTime(t.lastMessageAt)}
                              </time>
                            ) : null}
                          </span>
                          <span className={styles.supportChatThreadRow}>
                            <span className={styles.supportChatThreadPreview}>
                              {t.lastMessagePreview || 'Нет сообщений'}
                            </span>
                            {unread ? (
                              <span
                                className={`${styles.orderChatUnreadBadge} ${styles.supportChatBadge}`}
                                aria-label={`${t.unreadCount} непрочитанных`}
                              >
                                {unreadLabel(t.unreadCount)}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {nextCursor && !loading ? (
              <div className={styles.supportChatLoadMore}>
                <AdminCompactBtn
                  variant="outline"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Загрузка…' : 'Показать ещё'}
                </AdminCompactBtn>
              </div>
            ) : null}
          </div>
        </aside>

        <section className={styles.supportChatMain} aria-label="Диалог">
          {selectedUserId ? (
            <>
              <header className={styles.supportChatMainHead}>
                <button
                  type="button"
                  className={styles.supportChatBackBtn}
                  onClick={() => setSelectedUserId(null)}
                  aria-label="К списку диалогов"
                >
                  <BackIcon />
                </button>
                <span className={styles.supportChatAvatar} aria-hidden>
                  {initialsOf(chatTitle)}
                </span>
                <div className={styles.supportChatMainTitleWrap}>
                  <h2 className={styles.supportChatMainTitle}>{chatTitle}</h2>
                  {showEmailLine && selected ? (
                    <p className={styles.supportChatMainSubtitle}>{selected.userEmail}</p>
                  ) : null}
                </div>
                <AdminCompactBtnLink
                  href={`/admin/users/${selectedUserId}`}
                  variant="outline"
                  className={styles.supportChatMainAction}
                >
                  Профиль клиента
                </AdminCompactBtnLink>
              </header>
              <div ref={chatPanelRef} className={styles.supportChatMainBody}>
                <ChatWindow
                  key={chatThreadKey}
                  threadKey={chatThreadKey}
                  variant="embedded"
                  embeddedLayout="fill"
                  open
                  hideCloseButton
                  title=""
                  titleTransform="none"
                  messages={chat.chatMessages}
                  messageEmptyHint={chat.chatLoading ? 'Загрузка…' : 'Сообщений пока нет — напишите первым'}
                  inputPlaceholder="Ответ клиенту…"
                  errorText={chat.chatError}
                  uiVariant="admin"
                  frameless
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
            <div className={styles.supportChatPlaceholder}>
              <ChatBubbleIcon />
              <p className={styles.supportChatPlaceholderTitle}>Выберите диалог</p>
              <p className={styles.supportChatPlaceholderText}>
                Сначала показаны диалоги с непрочитанными сообщениями.
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
