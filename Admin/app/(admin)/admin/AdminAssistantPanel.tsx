'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminModal } from '@/components/admin/AdminModal/AdminModal';
import { adminConfirm } from '@/components/admin/AdminModal/adminConfirm';
import { adminBackendFetch, adminBackendJson } from '@/lib/adminBackendFetch';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import styles from './AdminAssistantPanel.module.css';

type ChatRole = 'user' | 'assistant';

type UiMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

type ThreadItem = {
  id: string;
  title: string;
  updatedAt: string;
  preview: string;
};

type SseEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'status'; message: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; threadId: string; content: string }
  | { type: 'error'; message: string }
  | { type: 'close' };

export const ASSISTANT_OPEN_EVENT = 'miraflores:assistant-open';
export const ASSISTANT_EMOJI = '🤦‍♀️';

const SUGGESTIONS = [
  'Сколько заказов и выручка сегодня?',
  'Сравни с этим месяцем',
  'Какие товары в топе сегодня?',
  'Как воронка и отмены за месяц?',
  'Что поправить в контенте?',
  'Какие товары без наличия?',
];

const THREAD_STORAGE_KEY = 'miraflores.admin.assistant.threadId';

function newId() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function readStoredThreadId(): string | null {
  try {
    return window.localStorage.getItem(THREAD_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredThreadId(id: string | null) {
  try {
    if (id) window.localStorage.setItem(THREAD_STORAGE_KEY, id);
    else window.localStorage.removeItem(THREAD_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function formatThreadTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/** Turn `/admin/...` paths in plain text into links. */
function linkifyAdminPaths(text: string): ReactNode {
  const re = /(\/admin\/[a-zA-Z0-9/_?=&%-]+)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) != null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const href = match[1];
    nodes.push(
      <Link key={`l-${key++}`} href={href} className={styles.inlineLink}>
        {href}
      </Link>,
    );
    last = match.index + href.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length === 1 ? nodes[0] : nodes;
}

function AssistantChatBody({
  open,
  staffName,
  abortRef,
  onTitleChange,
}: {
  open: boolean;
  staffName: string;
  abortRef: MutableRefObject<AbortController | null>;
  onTitleChange: (title: string) => void;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [mobileTab, setMobileTab] = useState<'chat' | 'history'>('chat');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bootedRef = useRef(false);

  const persistThreadId = useCallback((id: string | null) => {
    setThreadId(id);
    writeStoredThreadId(id);
  }, []);

  const activeThreadTitle = useMemo(() => {
    if (!threadId) return `${ASSISTANT_EMOJI} Ассистент`;
    const t = threads.find((x) => x.id === threadId);
    return t?.title?.trim() || `${ASSISTANT_EMOJI} Ассистент`;
  }, [threadId, threads]);

  useEffect(() => {
    onTitleChange(activeThreadTitle);
  }, [activeThreadTitle, onTitleChange]);

  const refreshThreads = useCallback(async () => {
    try {
      const data = await adminBackendJson<{ items: ThreadItem[] }>(
        'assistant/admin/threads',
      );
      setThreads(data.items ?? []);
      return data.items ?? [];
    } catch {
      return [] as ThreadItem[];
    }
  }, []);

  const loadThread = useCallback(
    async (id: string) => {
      setHistoryLoading(true);
      setError(null);
      try {
        const data = await adminBackendJson<{
          id: string;
          title?: string | null;
          messages: Array<{ id: string; role: ChatRole; content: string }>;
        }>(`assistant/admin/threads/${id}`);
        persistThreadId(data.id);
        setMessages(
          data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          })),
        );
        setStatus(null);
        setMobileTab('chat');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось открыть диалог');
        persistThreadId(null);
        setMessages([]);
      } finally {
        setHistoryLoading(false);
      }
    },
    [persistThreadId],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      if (!bootedRef.current) {
        setHistoryLoading(true);
        const items = await refreshThreads();
        if (cancelled) return;
        const stored = readStoredThreadId();
        if (stored && items.some((t) => t.id === stored)) {
          await loadThread(stored);
        } else if (stored) {
          writeStoredThreadId(null);
          setHistoryLoading(false);
        } else {
          setHistoryLoading(false);
        }
        bootedRef.current = true;
      } else {
        void refreshThreads();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, refreshThreads, loadThread]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status, open]);

  const startNewChat = useCallback(() => {
    if (busy) abortRef.current?.abort();
    persistThreadId(null);
    setMessages([]);
    setStatus(null);
    setError(null);
    setInput('');
    setMobileTab('chat');
  }, [busy, persistThreadId, abortRef]);

  const clearHistory = useCallback(async () => {
    const ok = await adminConfirm({
      title: 'Очистить историю',
      message: 'Удалить всю историю диалогов с ассистентом? Это действие необратимо.',
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await adminBackendJson('assistant/admin/threads', { method: 'DELETE' });
      persistThreadId(null);
      setMessages([]);
      setThreads([]);
      setStatus(null);
      setMobileTab('chat');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось очистить');
    }
  }, [persistThreadId]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, [abortRef]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      setBusy(true);
      setError(null);
      setStatus('Отправляю…');
      setInput('');
      setMobileTab('chat');
      const userMsg: UiMessage = { id: newId(), role: 'user', content: trimmed };
      const assistantId = newId();
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: 'assistant', content: '' },
      ]);

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await adminBackendFetch('assistant/admin/chat', {
          method: 'POST',
          body: JSON.stringify({
            message: trimmed,
            ...(threadId ? { threadId } : {}),
          }),
          signal: ac.signal,
        });

        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || `HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('Нет потока ответа');

        const decoder = new TextDecoder();
        let buffer = '';
        let gotError: string | null = null;
        let completed = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const part of parts) {
            const line = part
              .split('\n')
              .map((l) => l.trim())
              .find((l) => l.startsWith('data:'));
            if (!line) continue;
            const raw = line.slice(5).trim();
            if (!raw) continue;
            let event: SseEvent;
            try {
              event = JSON.parse(raw) as SseEvent;
            } catch {
              continue;
            }

            if (event.type === 'thread') {
              persistThreadId(event.threadId);
            } else if (event.type === 'status') {
              setStatus(event.message);
            } else if (event.type === 'delta') {
              const chunk = event.text;
              setStatus(null);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + chunk }
                    : m,
                ),
              );
            } else if (event.type === 'done') {
              const full = event.content;
              persistThreadId(event.threadId);
              setStatus(null);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: full } : m,
                ),
              );
              completed = true;
            } else if (event.type === 'error') {
              gotError = event.message;
              setError(event.message);
              setStatus(null);
            }
          }
        }

        if (gotError || !completed) {
          setMessages((prev) =>
            prev.filter((m) => m.id !== assistantId || m.content.trim()),
          );
        }
        void refreshThreads();
      } catch (e) {
        if (ac.signal.aborted) {
          setStatus(null);
          setMessages((prev) =>
            prev.filter((m) => m.id !== assistantId || m.content.trim()),
          );
        } else {
          setError(e instanceof Error ? e.message : 'Ошибка запроса');
          setMessages((prev) =>
            prev.filter((m) => m.id !== assistantId || m.content.trim()),
          );
        }
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
        setBusy(false);
        setStatus(null);
      }
    },
    [busy, threadId, persistThreadId, refreshThreads, abortRef],
  );

  const greetingName = staffName.trim() || 'коллега';
  const showChips = messages.length === 0 && !historyLoading;

  return (
    <div className={styles.chatRoot}>
      <div className={styles.mobileTabs} role="tablist" aria-label="Разделы ассистента">
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'chat'}
          className={`${styles.mobileTab} ${
            mobileTab === 'chat' ? styles.mobileTabActive : ''
          }`}
          onClick={() => setMobileTab('chat')}
        >
          Чат
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'history'}
          className={`${styles.mobileTab} ${
            mobileTab === 'history' ? styles.mobileTabActive : ''
          }`}
          onClick={() => setMobileTab('history')}
        >
          История
        </button>
      </div>

      <div className={styles.layout}>
        <aside
          className={`${styles.history} ${
            mobileTab === 'chat' ? styles.hideOnMobile : ''
          }`}
          aria-label="История диалогов"
        >
          <div className={styles.historyHead}>
            <p className={styles.historyTitle}>История</p>
            <AdminCompactBtn
              type="button"
              variant="outline"
              disabled={busy}
              onClick={startNewChat}
              aria-label="Новый диалог"
              title="Новый диалог"
            >
              +
            </AdminCompactBtn>
          </div>
          <ul className={styles.threadList}>
            {threads.length === 0 ? (
              <li className={styles.threadEmpty}>Пока пусто</li>
            ) : (
              threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`${styles.threadItem} ${
                      t.id === threadId ? styles.threadItemActive : ''
                    }`}
                    disabled={busy || historyLoading}
                    onClick={() => void loadThread(t.id)}
                  >
                    <span className={styles.threadItemTitle}>
                      {t.title || 'Диалог'}
                    </span>
                    <span className={styles.threadItemMeta}>
                      {formatThreadTime(t.updatedAt)}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
          <AdminCompactBtn
            type="button"
            variant="outline"
            disabled={busy || threads.length === 0}
            onClick={() => void clearHistory()}
          >
            Очистить всё
          </AdminCompactBtn>
        </aside>

        <div
          className={`${styles.main} ${
            mobileTab === 'history' ? styles.hideOnMobile : ''
          }`}
        >
          <div className={styles.toolbar}>
            <p className={styles.greeting}>
              Привет, {greetingName}, чем помочь?
            </p>
          </div>

          {showChips ? (
            <div className={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={styles.chip}
                  disabled={busy}
                  onClick={() => void send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          <div className={styles.messages}>
            {historyLoading && messages.length === 0 ? (
              <p className={styles.status}>Загружаю диалог…</p>
            ) : null}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`${styles.bubble} ${
                  m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant
                }`}
              >
                {m.content
                  ? linkifyAdminPaths(m.content)
                  : busy
                    ? '…'
                    : ''}
              </div>
            ))}
            {status ? <p className={styles.status}>{status}</p> : null}
            {error ? (
              <p className={catalogStyles.error} role="alert">
                {error}
              </p>
            ) : null}
            <div ref={bottomRef} />
          </div>

          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              ref={inputRef}
              className={styles.input}
              rows={2}
              value={input}
              disabled={busy}
              placeholder="Вопрос по магазину…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            {busy ? (
              <AdminCompactBtn type="button" variant="outline" onClick={stop}>
                Стоп
              </AdminCompactBtn>
            ) : (
              <AdminCompactBtn type="submit" disabled={!input.trim()}>
                Отправить
              </AdminCompactBtn>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

/** Sticky launcher + modal — на всю админку (кроме login). */
export function AdminAssistantHost({
  staffName,
  enabled = true,
}: {
  staffName?: string | null;
  enabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState(`${ASSISTANT_EMOJI} Ассистент`);
  const abortRef = useRef<AbortController | null>(null);
  const name = staffName?.trim() || 'коллега';

  const close = useCallback(() => {
    abortRef.current?.abort();
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onOpen = () => setOpen(true);
    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        className={styles.fab}
        aria-label={`Открыть ассистента ${ASSISTANT_EMOJI}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className={styles.fabEmoji} aria-hidden>
          {ASSISTANT_EMOJI}
        </span>
      </button>

      <AdminModal
        open={open}
        title={modalTitle}
        size="assistant"
        keepMounted
        onClose={close}
      >
        <AssistantChatBody
          open={open}
          staffName={name}
          abortRef={abortRef}
          onTitleChange={setModalTitle}
        />
      </AdminModal>
    </>
  );
}
