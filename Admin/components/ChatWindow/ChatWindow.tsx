'use client';

import { createPortal } from 'react-dom';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { OrderChatPendingUiAttachment } from '@/lib/orderChat/types';
import {
  formatOrderChatDaySeparatorLabel,
  orderChatLocalDayKey,
} from '@/lib/orderChat/formatOrderChatDaySeparator';
import { openOrderChatPhotoSwipe } from '@/lib/orderChat/openOrderChatPhotoSwipe';
import { linkifyChatMessageContent } from '@/lib/orderChat/linkifyChatMessageContent';
import {
  isOrderChatMessageWithinDeleteWindow,
  ORDER_CHAT_POST_BODY_MAX_CHARS,
} from '@/lib/orderChat/constants';
import { ORDER_CHAT_FILE_INPUT_ACCEPT } from '@/lib/orderChat/chatUploadAccept';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import styles from './ChatWindow.module.css';

export type ChatDocAttachment = { id: string; filename: string; url?: string };
export type ChatImageAttachment = { id: string; src: string; alt?: string };

export type ChatWindowMessage = {
  id: string;
  senderName: string;
  senderAvatarUrl?: string | null;
  timeLabel: string;
  content?: string;
  documents?: ChatDocAttachment[];
  images?: ChatImageAttachment[];
  /** Сообщение удалено (soft delete на сервере) */
  isDeleted?: boolean;
  /** Показать кнопку удаления (если задан onDeleteMessage) */
  deletable?: boolean;
  /** Доп. блок в шапке сообщения (бейдж статуса и т.п.) */
  headExtra?: ReactNode;
  /** Доп. блок под телом сообщения (модерация, действия) */
  footerSlot?: ReactNode;
  /** Только order chat: для пересчёта кнопки «удалить» по истечении окна (24 ч). */
  ocAuthorUserId?: string;
  ocAuthorRole?: 'CUSTOMER' | 'STAFF';
  ocCreatedAtIso?: string;
  /** Локальная отправка (до ответа API). */
  isPending?: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  messages?: ChatWindowMessage[];
  /** Вызывается при нажатии «Отправить»; черновик очищается только при `true`. */
  onSend?: (text: string) => boolean | Promise<boolean>;
  /** Сброс черновика при смене треда (передайте стабильный ключ диалога). */
  threadKey?: string;
  /** Боковая колонка: без портала и без fixed-позиционирования */
  variant?: 'portal' | 'embedded';
  /**
   * Только при `variant="embedded"`: как встроить чат в родителя.
   * `fill` — колонка на высоту контейнера (админка).
   * `overlay` — у нижнего правого края родителя, как в режиме портала, но остаётся в DOM родителя (ловушка фокуса).
   */
  embeddedLayout?: 'fill' | 'overlay';
  hideCloseButton?: boolean;
  messageEmptyHint?: string;
  inputPlaceholder?: string;
  /** Баннер ошибки над лентой сообщений */
  errorText?: string | null;
  /** Заблокировать ввод и отправку */
  composerDisabled?: boolean;
  /** Блокировка только для поля выбора файла (напр. не блокировать на время loading чата) */
  attachPickerDisabled?: boolean;
  /** Показать кнопку вложений и вызывать при выборе файлов */
  attachmentsEnabled?: boolean;
  /** Подсказка под полем (напр. файлы к отправке) */
  pendingAttachmentsHint?: string | null;
  /** Баннер в области композера (напр. «войдите, чтобы написать») */
  composerBanner?: ReactNode;
  /** Превью вложений до нажатия «Отправить» */
  pendingOutgoing?: OrderChatPendingUiAttachment[];
  /** Разрешить отправку пустого текста (когда есть вложения «к отправке» у родителя) */
  allowEmptySend?: boolean;
  onAttachFiles?: (files: File[]) => void | Promise<void>;
  /** Убрать файл из очереди перед отправкой (по clientKey из pendingOutgoing) */
  onRemovePendingAttachment?: (clientKey: string) => void;
  onDeleteMessage?: (messageId: string) => void | Promise<void>;
  /** Есть сообщения старее верха списка (пагинация). */
  hasOlderHistory?: boolean;
  loadingOlderHistory?: boolean;
  onLoadOlderHistory?: () => void | Promise<void>;
  /** Подпись кнопки «раньше» (например по локали админки). По умолчанию — русский для ЛК. */
  loadOlderHistoryLabel?: string;
  /**
   * Локаль для заголовков дня («Сегодня», «Вчера», формат крайних дат) между блоками сообщений.
   * Должна совпадать с локалью времени в сообщениях (напр. **`ru-RU`** / **`zh-CN`** для админки).
   */
  messageDayLocale?: string;
  /** По умолчанию заголовок в uppercase (стиль заказов). */
  titleTransform?: 'uppercase' | 'none';
  /** `admin` — плоская панель без glass; стили пузырей по роли автора. */
  uiVariant?: 'glass' | 'admin';
  /** Подтверждение перед soft-delete. */
  confirmBeforeDelete?: boolean;
  /** Блокировать только кнопку «Отправить» (не textarea). */
  sendDisabled?: boolean;
};

/** Безопасная подстановка id в атрибут / селектор. */
function escapeAttrSelectorSegment(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M5 5L15 15M15 5L5 15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MessageBetweenDivider() {
  return (
    <div className={styles.dividerWrap} aria-hidden>
      <div className={styles.dividerLine} />
    </div>
  );
}

function DaySeparatorRibbon({ iso, locale }: { iso: string; locale: string }) {
  const [, dayTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => dayTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const label = formatOrderChatDaySeparatorLabel(iso, locale);
  if (!label.trim()) return null;
  return (
    <div className={styles.daySeparatorWrap}>
      <p className={styles.daySeparatorText}>{label}</p>
    </div>
  );
}

function SendDirectIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 33 33" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M17.0717 8.42582L6.29151 15.8639C3.73132 17.6275 4.94006 21.6355 8.04765 21.6936L11.6694 21.7614C12.6755 21.7802 13.6146 22.2719 14.2031 23.0881L16.322 26.0261C18.14 28.5471 22.1138 27.2527 22.1138 24.1485L22.086 11.0513C22.0805 8.4748 19.1924 6.9626 17.0717 8.42582Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AttachIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M16.5 6.5v8.25a4.75 4.75 0 0 1-9.5 0V7a3 3 0 1 1 6 0v7.5a1.75 1.75 0 1 1-3.5 0V6.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DocIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4.5 1.5h4.5L12.5 5v9.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M8.5 1.5V5H12" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function ChatImageThumb({
  im,
  single,
  onOpen,
}: {
  im: ChatImageAttachment;
  single: boolean;
  onOpen: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const heicLike = /\.hei[cf](\?|$)/i.test(im.src);
  if (broken || heicLike) {
    return (
      <button type="button" className={styles.imgThumbBtn} onClick={onOpen} aria-label="Открыть изображение">
        <span className={styles.imgThumbFallback}>Фото</span>
      </button>
    );
  }
  return (
    <button type="button" className={styles.imgThumbBtn} onClick={onOpen} aria-label="Открыть изображение">
      <img
        className={single ? styles.imgThumbSingle : styles.imgThumb}
        src={im.src}
        alt={im.alt ?? ''}
        loading="lazy"
        onError={() => setBroken(true)}
      />
    </button>
  );
}

function MessageAttachments({
  message,
  onOpenChatImage,
}: {
  message: ChatWindowMessage;
  onOpenChatImage: (images: ChatImageAttachment[], index: number) => void;
}) {
  const docs = message.documents ?? [];
  const imgs = message.images ?? [];
  if (docs.length === 0 && imgs.length === 0) return null;

  const singleImage = imgs.length === 1;

  return (
    <div className={styles.messageAttachments}>
      {docs.length > 0 ? (
        <div className={styles.docRow}>
          {docs.map((d) =>
            d.url ? (
              <a
                key={d.id}
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                download
                className={styles.docChip}
                title={d.filename}
              >
                <DocIcon className={styles.docChipIcon} />
                <span className={styles.docChipName}>{d.filename}</span>
              </a>
            ) : (
              <div key={d.id} className={styles.docChip} title={d.filename}>
                <DocIcon className={styles.docChipIcon} />
                <span className={styles.docChipName}>{d.filename}</span>
              </div>
            ),
          )}
        </div>
      ) : null}
      {imgs.length > 0 ? (
        <div className={singleImage ? styles.imgRowSingle : styles.imgRow}>
          {imgs.map((im, idx) => (
            <ChatImageThumb
              key={im.id}
              im={im}
              single={singleImage}
              onOpen={() => onOpenChatImage(imgs, idx)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ChatWindow({
  open,
  onClose,
  title,
  messages = [],
  onSend,
  threadKey,
  variant = 'portal',
  embeddedLayout = 'fill',
  hideCloseButton = false,
  messageEmptyHint = 'Пока нет сообщений',
  inputPlaceholder = 'Сообщение',
  errorText = null,
  composerDisabled = false,
  attachPickerDisabled,
  attachmentsEnabled = false,
  pendingAttachmentsHint = null,
  composerBanner = null,
  pendingOutgoing = [],
  allowEmptySend = false,
  onAttachFiles,
  onRemovePendingAttachment,
  onDeleteMessage,
  hasOlderHistory = false,
  loadingOlderHistory = false,
  onLoadOlderHistory,
  loadOlderHistoryLabel = 'Показать раньше',
  messageDayLocale = 'ru-RU',
  titleTransform = 'uppercase',
  uiVariant = 'glass',
  confirmBeforeDelete = false,
  sendDisabled = false,
}: Props) {
  const embedded = variant === 'embedded';
  const isAdminUi = uiVariant === 'admin';
  const titleId = useId();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const userNearBottomRef = useRef(true);
  const [draft, setDraft] = useState('');
  const [newMessagesBelow, setNewMessagesBelow] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [, setDeleteClockTick] = useState(0);
  /** Два rAF: даём браузеру собрать слой с backdrop-filter до плавного появления */
  const [blendReady, setBlendReady] = useState(embedded);

  /** Прокручивает область сообщений к низу (новые сообщения внизу). */
  const scrollMessagesToBottom = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    userNearBottomRef.current = true;
    setNewMessagesBelow(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const near =
        el.scrollHeight - el.scrollTop - el.clientHeight <= 120;
      userNearBottomRef.current = near;
      if (near) setNewMessagesBelow(false);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [open, threadKey]);

  useEffect(() => {
    if (!open || !onDeleteMessage) return undefined;
    const id = window.setInterval(() => setDeleteClockTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, [open, onDeleteMessage]);

  const listStatsRef = useRef<{ length: number; headId?: string; tailId?: string }>({
    length: 0,
  });

  /** Не отодвигаем к низу при prepend «старее» сверху; при новых внизу — докручиваем низ; при перезагрузке хвоста — докручиваем низ. */
  useLayoutEffect(() => {
    if (!open) {
      listStatsRef.current = { length: 0 };
      return;
    }

    const el = messagesScrollRef.current;
    if (!el) return;

    const prev = listStatsRef.current;
    const headId = messages[0]?.id;
    const tailId = messages.length ? messages[messages.length - 1].id : undefined;

    let raf0 = 0;
    let raf1 = 0;
    const bumpBottomWithRafs = () => {
      scrollMessagesToBottom();
      raf0 = requestAnimationFrame(() => {
        scrollMessagesToBottom();
        raf1 = requestAnimationFrame(scrollMessagesToBottom);
      });
    };

    const prepend =
      prev.length > 0 &&
      messages.length > prev.length &&
      headId !== undefined &&
      headId !== prev.headId;

    const append =
      prev.length > 0 &&
      messages.length > prev.length &&
      headId !== undefined &&
      headId === prev.headId &&
      tailId !== undefined &&
      prev.tailId !== undefined &&
      tailId !== prev.tailId;

    const tailReload =
      prev.length > messages.length &&
      messages.length > 0 &&
      tailId !== undefined &&
      prev.tailId !== undefined &&
      tailId === prev.tailId &&
      headId !== undefined &&
      headId !== prev.headId;

    const initialFill = prev.length === 0 && messages.length > 0;

    if (prepend && prev.headId) {
      const keep = el.querySelector(`[data-oc-msg-id="${escapeAttrSelectorSegment(prev.headId)}"]`);
      if (keep instanceof HTMLElement) keep.scrollIntoView({ block: 'nearest' });
    } else if (initialFill) {
      bumpBottomWithRafs();
    } else if (append || tailReload) {
      if (userNearBottomRef.current) bumpBottomWithRafs();
      else setNewMessagesBelow(true);
    }

    listStatsRef.current = {
      length: messages.length,
      headId,
      tailId,
    };

    return () => {
      cancelAnimationFrame(raf0);
      cancelAnimationFrame(raf1);
    };
  }, [open, messages, scrollMessagesToBottom]);

  const messagesFingerprint = useMemo(() => messages.map((m) => m.id).join('\0'), [messages]);

  /** Картинки в лентах могут дорисоваться после layout — подтягиваем низ только если уже у «предпоследних» сообщений. */
  useEffect(() => {
    if (!open) return;
    const root = messagesScrollRef.current;
    if (!root) return;

    const nearBottom = (px = 120) =>
      root.scrollHeight - root.scrollTop - root.clientHeight <= px;

    const maybeStickToBottom = () => {
      if (!nearBottom()) return;
      root.scrollTop = root.scrollHeight;
    };

    const ro = new ResizeObserver(() => {
      maybeStickToBottom();
    });
    ro.observe(root);

    let mo: MutationObserver | null = null;
    try {
      mo = new MutationObserver(() => maybeStickToBottom());
      mo.observe(root, { childList: true, subtree: true, characterData: true });
    } catch {
      mo = null;
    }

    return () => {
      ro.disconnect();
      mo?.disconnect();
    };
  }, [open, messagesFingerprint]);

  useEffect(() => {
    if (!open) {
      setBlendReady(false);
      return;
    }
    if (embedded) {
      setBlendReady(true);
      return;
    }
    setBlendReady(false);
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setBlendReady(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [open, embedded]);

  useEffect(() => {
    if (!open || embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, embedded]);

  useEffect(() => {
    if (open) setDraft('');
  }, [open, threadKey]);

  const syncComposerHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    const maxPx = 192;
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
  }, []);

  useLayoutEffect(() => {
    syncComposerHeight();
  }, [draft, open, syncComposerHeight]);

  const submit = useCallback(() => {
    if (composerDisabled || sendDisabled) return;
    const t = draft.trim();
    if (!t && !allowEmptySend) return;
    void (async () => {
      const ok = (await onSend?.(t)) ?? false;
      if (ok) setDraft('');
    })();
  }, [draft, onSend, composerDisabled, sendDisabled, allowEmptySend]);

  const openChatImage = useCallback((images: ChatImageAttachment[], index: number) => {
    const urls = images.map((i) => i.src.trim()).filter(Boolean);
    if (urls.length === 0) return;
    void openOrderChatPhotoSwipe(urls, index);
  }, []);

  if (!open) return null;

  const attachBlocked =
    attachPickerDisabled !== undefined ? attachPickerDisabled : sendDisabled;

  const canSendDraft = allowEmptySend || draft.trim().length > 0;

  const fillEmbedded = embedded && embeddedLayout === 'fill';
  const compactHeader = !title.trim() && hideCloseButton;
  const enterSubmitsOnFinePointer =
    typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

  const requestDelete = (messageId: string) => {
    if (confirmBeforeDelete) setPendingDeleteId(messageId);
    else void onDeleteMessage?.(messageId);
  };

  const panelSection = (
    <section
      className={`${styles.panel} ${fillEmbedded ? styles.panelEmbedded : ''} ${
        isAdminUi ? styles.panelAdminPlain : ''
      }`}
      {...(embedded
        ? ({ role: 'region' as const } as const)
        : ({ role: 'dialog' as const, 'aria-modal': true as const } as const))}
      aria-labelledby={titleId}
    >
      <div className={styles.panelInner}>
        <header className={`${styles.header} ${compactHeader ? styles.headerCompact : ''}`}>
          <div className={styles.headerMain}>
            <h2
              id={titleId}
              className={`${styles.title} ${titleTransform === 'none' ? styles.titleNormalCase : ''}`}
            >
              {title}
            </h2>
            {!hideCloseButton ? (
              <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Закрыть чат">
                <CloseIcon />
              </button>
            ) : null}
          </div>
          <div className={styles.headerMainRule} aria-hidden />
        </header>

        <div ref={messagesScrollRef} className={styles.messagesScroll}>
          {errorText ? (
            <p className={styles.chatErrorBanner} role="alert">
              {errorText}
            </p>
          ) : null}
          {messages.length === 0 ? (
            <p className={styles.emptyHint}>{messageEmptyHint}</p>
          ) : null}
          {newMessagesBelow ? (
            <div className={styles.newMessagesBar}>
              <button type="button" className={styles.newMessagesBtn} onClick={scrollMessagesToBottom}>
                Новые сообщения
              </button>
            </div>
          ) : null}
          {messages.length > 0 ? (
              <div
                className={styles.messagesList}
                role="log"
                aria-live="polite"
                aria-relevant="additions"
              >
                {hasOlderHistory && onLoadOlderHistory ? (
                  <div className={styles.loadOlderWrap}>
                    <button
                      type="button"
                      className={styles.loadOlderBtn}
                      disabled={loadingOlderHistory}
                      onClick={() => void onLoadOlderHistory()}
                    >
                      {loadingOlderHistory ? `${loadOlderHistoryLabel}…` : loadOlderHistoryLabel}
                    </button>
                  </div>
                ) : null}
                {messages.map((m, index) => {
                  const iso = m.ocCreatedAtIso?.trim();
                  const dayKey = iso ? orderChatLocalDayKey(iso) : null;
                  const prev = messages[index - 1];
                  const prevIso = prev?.ocCreatedAtIso?.trim();
                  const prevKey = prevIso ? orderChatLocalDayKey(prevIso) : null;
                  const showDaySep = iso && dayKey != null && (index === 0 || dayKey !== prevKey);

                  const next = messages[index + 1];
                  const nextIso = next?.ocCreatedAtIso?.trim();
                  const nextKey =
                    nextIso != null ? orderChatLocalDayKey(nextIso) : null;
                  const showBetweenDivider =
                    index < messages.length - 1 && dayKey != null && nextKey != null && dayKey === nextKey;

                  return (
                    <Fragment key={m.id}>
                      {showDaySep ? <DaySeparatorRibbon iso={iso!} locale={messageDayLocale} /> : null}
                      <article
                        className={`${styles.message} ${
                          isAdminUi && m.ocAuthorRole === 'STAFF'
                            ? styles.messageStaff
                            : isAdminUi && m.ocAuthorRole === 'CUSTOMER'
                              ? styles.messageCustomer
                              : ''
                        } ${m.isPending ? styles.messagePending : ''}`}
                        data-oc-msg-id={m.id}
                      >
                        <div className={styles.senderInfo}>
                          <div className={styles.senderLeft}>
                            {m.senderAvatarUrl ? (
                              <img className={styles.avatar} src={m.senderAvatarUrl} alt="" width={24} height={24} />
                            ) : (
                              <div
                                className={`${styles.avatar} ${
                                  isAdminUi && m.ocAuthorRole === 'CUSTOMER' ? styles.avatarCustomer : ''
                                }`}
                                aria-hidden
                              />
                            )}
                            <span className={styles.senderName}>{m.senderName}</span>
                            {m.headExtra ? (
                              <span className={styles.messageHeadExtra}>{m.headExtra}</span>
                            ) : null}
                          </div>
                          {m.deletable &&
                          onDeleteMessage &&
                          m.ocCreatedAtIso &&
                          isOrderChatMessageWithinDeleteWindow(m.ocCreatedAtIso) ? (
                            <button
                              type="button"
                              className={styles.messageDeleteBtn}
                              aria-label="Удалить сообщение"
                              onClick={() => requestDelete(m.id)}
                            >
                              ×
                            </button>
                          ) : null}
                          <span className={styles.messageTime}>{m.timeLabel}</span>
                        </div>
                        {!m.isDeleted &&
                        ((m.documents?.length ?? 0) > 0 || (m.images?.length ?? 0) > 0) ? (
                          <MessageAttachments message={m} onOpenChatImage={openChatImage} />
                        ) : null}
                        {m.isDeleted ? (
                          <p className={styles.messageDeleted}>Сообщение удалено</p>
                        ) : m.content?.trim() ? (
                          <p className={styles.messageBody}>
                            {linkifyChatMessageContent(m.content.trim())}
                          </p>
                        ) : null}
                        {m.footerSlot ? (
                          <div className={styles.messageFooter}>{m.footerSlot}</div>
                        ) : null}
                      </article>
                      {showBetweenDivider ? <MessageBetweenDivider /> : null}
                    </Fragment>
                  );
                })}
              </div>
            ) : null}
        </div>

        <footer className={styles.footer}>
          {pendingOutgoing.length > 0 ? (
            <div className={styles.pendingOutgoingStrip} aria-label="Вложения к отправке">
              {pendingOutgoing.map((a) => {
                const removeBtn =
                  onRemovePendingAttachment ? (
                    <button
                      type="button"
                      className={styles.pendingOutgoingDocRemoveBtn}
                      aria-label={
                        a.kind === 'IMAGE' ? 'Убрать изображение' : `Убрать файл ${a.filename}`
                      }
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onRemovePendingAttachment(a.clientKey);
                      }}
                    >
                      <span className={styles.pendingOutgoingRemoveIcon} aria-hidden>
                        ×
                      </span>
                    </button>
                  ) : null;

                if (a.kind === 'IMAGE' && (a.imageSrc || a.uploading)) {
                  return (
                    <div
                      key={a.clientKey}
                      className={styles.pendingOutgoingImageChip}
                      title={a.filename}
                    >
                      <div className={styles.pendingOutgoingThumbWrap} aria-hidden>
                        {a.imageSrc ? (
                          <img
                            className={styles.pendingOutgoingThumb}
                            src={a.imageSrc}
                            alt=""
                            width={40}
                            height={40}
                          />
                        ) : null}
                        {a.uploading ? (
                          <div className={styles.pendingOutgoingUploadingOverlay}>
                            <span className={styles.pendingOutgoingSpinner} />
                          </div>
                        ) : null}
                      </div>
                      <span className={styles.pendingOutgoingDocName}>{a.filename}</span>
                      {a.uploading ? (
                        <span className={styles.pendingOutgoingDocSpinner} aria-label="Загрузка" />
                      ) : null}
                      {removeBtn}
                    </div>
                  );
                }

                return (
                  <div key={a.clientKey} className={styles.pendingOutgoingDoc} title={a.filename}>
                    <DocIcon className={styles.docChipIcon} />
                    <span className={styles.pendingOutgoingDocName}>{a.filename}</span>
                    {a.uploading ? (
                      <span className={styles.pendingOutgoingDocSpinner} aria-label="Загрузка" />
                    ) : null}
                    {removeBtn}
                  </div>
                );
              })}
            </div>
          ) : null}
          {pendingAttachmentsHint ? (
            <p className={styles.footerPendingHint}>{pendingAttachmentsHint}</p>
          ) : null}
          {composerBanner ? (
            <div className={styles.composerBanner}>{composerBanner}</div>
          ) : null}
          <div className={styles.footerMainTopRule} aria-hidden />
          <div className={styles.footerMain}>
            <input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              className={styles.fileInputHidden}
              multiple
              accept={ORDER_CHAT_FILE_INPUT_ACCEPT}
              tabIndex={-1}
              disabled={attachBlocked}
              aria-hidden
              onChange={(e) => {
                const input = e.target;
                const files = input.files?.length ? Array.from(input.files) : [];
                if (!files.length || !onAttachFiles) {
                  input.value = '';
                  return;
                }
                /* Микрозадача: не очищать value синхронно в WebKit до передачи списка в обработчик */
                queueMicrotask(() => {
                  void onAttachFiles(files);
                  input.value = '';
                });
              }}
            />
            {attachmentsEnabled ? (
              <button
                type="button"
                className={`${styles.attachBtn} ${attachBlocked ? styles.attachBtnBlocked : ''}`}
                aria-label="Прикрепить файл"
                disabled={attachBlocked}
                onClick={() => fileInputRef.current?.click()}
              >
                <AttachIcon className={styles.attachIcon} />
              </button>
            ) : null}
            <textarea
              ref={textareaRef}
              rows={1}
              className={styles.input}
              placeholder={inputPlaceholder}
              value={draft}
              maxLength={ORDER_CHAT_POST_BODY_MAX_CHARS}
              disabled={composerDisabled}
              onChange={(e) => setDraft(e.target.value.slice(0, ORDER_CHAT_POST_BODY_MAX_CHARS))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && enterSubmitsOnFinePointer && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              aria-label={inputPlaceholder}
            />
            <button
              type="button"
              className={styles.sendBtn}
              onClick={submit}
              disabled={composerDisabled || sendDisabled || !canSendDraft}
              aria-label="Отправить"
            >
              <SendDirectIcon className={styles.sendIcon} />
            </button>
          </div>
        </footer>
      </div>
    </section>
  );

  const tree = (
    <>
      {panelSection}
      <ConfirmDialog
        open={Boolean(pendingDeleteId)}
        title="Удалить сообщение?"
        message="Сообщение будет скрыто для всех участников. Это действие нельзя отменить."
        confirmLabel="Удалить"
        danger
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          const id = pendingDeleteId;
          setPendingDeleteId(null);
          if (id) void onDeleteMessage?.(id);
        }}
      />
    </>
  );

  if (embedded) {
    if (embeddedLayout === 'overlay') {
      return (
        <div
          className={`${styles.embedOverlayAnchor} ${blendReady ? styles.embedOverlayAnchorVisible : ''}`}
        >
          {tree}
        </div>
      );
    }
    return (
      <div className={`${styles.embedShell} ${blendReady ? styles.embedShellVisible : ''}`}>{tree}</div>
    );
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className={`${styles.root} ${blendReady ? styles.rootVisible : ''}`}>{tree}</div>,
    document.body,
  );
}
