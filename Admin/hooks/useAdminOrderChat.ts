'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatAttachments } from '@/hooks/useChatAttachments';
import type { ChatWindowMessage } from '@/components/ChatWindow/ChatWindow';
import { DEFAULT_STAFF_AVATAR } from '@/app/(admin)/admin/settings/staff/StaffAvatarField';
import {
  adminChatDeletePath,
  adminChatMessagesListUrl,
  adminChatMessagesPath,
  adminChatReadPath,
  adminChatSocketJoinPayload,
  adminChatSocketLeavePayload,
  adminChatTargetKey,
  adminChatUploadPath,
  adminChatUploadRevokePath,
  type AdminOrderChatTarget,
} from '@/lib/orderChat/adminChatPaths';
import {
  CHAT_MESSAGES_PAGE_DEFAULT,
  ORDER_CHAT_ATTACHMENT_REFS_PAYLOAD_MAX_CHARS,
  ORDER_CHAT_ATTACHMENTS_MAX,
  ORDER_CHAT_POST_BODY_MAX_CHARS,
  ORDER_CHAT_SOCKET_UPDATED_EVENT,
  ORDER_CHAT_UPLOAD_MAX_FILE_BYTES,
} from '@/lib/orderChat/constants';
import { ORDER_CHAT_WS_SESSION_EXPIRED_EVENT } from '@/lib/orderChat/orderChatWsShared';
import { mapOrderChatApiMessageToUi } from '@miraflores/order-chat-core';
import {
  describeOrderChatUploadFailure,
  orderChatFileTooLargeUserMessage,
} from '@/lib/orderChat/orderChatUploadError';
import {
  emitOrderChatRoomJoin,
  fetchOrderChatWsToken,
  getOrCreateSharedOrderChatSocket,
  registerOrderChatWsSession,
  waitOrderChatSocketConnect,
  type OrderChatSocket,
} from '@/lib/orderChat/orderChatWsShared';
import type { OrderChatApiMessage, OrderChatMessagesResponse } from '@/lib/orderChat/types';
import { readUpstreamJsonErrorMessage } from '@/lib/readUpstreamJsonError';

const PROFILE_AVATAR_PLACEHOLDER = DEFAULT_STAFF_AVATAR;

function dispatchAdminChatUnreadRefresh(): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new Event('admin-orders-chat-unread-refresh'));
}

async function parseOrderChatUploadResponse(res: Response): Promise<{
  url: string;
  filename: string;
  mimeType: string;
  kind: 'FILE' | 'IMAGE';
}> {
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(text.trim().slice(0, 280) || 'Некорректный ответ при загрузке');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Пустой ответ при загрузке');
  const o = parsed as Record<string, unknown>;
  const url = typeof o.url === 'string' ? o.url.trim() : '';
  if (!url) throw new Error('Нет ссылки на файл');
  const filename = typeof o.filename === 'string' ? o.filename : 'file';
  const mimeType = typeof o.mimeType === 'string' ? o.mimeType : 'application/octet-stream';
  const kind: 'FILE' | 'IMAGE' =
    o.kind === 'IMAGE' || o.kind === 'FILE' ? o.kind : mimeType.startsWith('image/') ? 'IMAGE' : 'FILE';
  return { url, filename, mimeType, kind };
}

function mapApiToUi(
  m: OrderChatApiMessage,
  viewerUserId: string | null,
  timeLocale: string,
  viewerStaffAvatar?: string | null,
): ChatWindowMessage {
  return mapOrderChatApiMessageToUi(m, {
    variant: 'admin',
    viewerUserId,
    timeLocale,
    labels: { you: 'Вы', manager: 'Менеджер', customer: 'Клиент' },
    resolveFileUrl: (u) => u,
    resolveOptionalUrl: (u) => u?.trim() || undefined,
    staffAvatarPlaceholder: PROFILE_AVATAR_PLACEHOLDER,
    viewerAvatarUrl: viewerStaffAvatar,
  });
}

function mergeTailMessages(
  prev: ChatWindowMessage[],
  incoming: ChatWindowMessage[],
): ChatWindowMessage[] {
  if (!incoming.length) return prev;
  const seen = new Set(prev.map((x) => x.id));
  const added = incoming.filter((m) => !seen.has(m.id));
  if (!added.length) return prev;
  return [...prev, ...added];
}

export function useAdminOrderChat(opts: {
  target: AdminOrderChatTarget | null;
  enabled: boolean;
  staffUserId?: string | null;
  staffAvatarUrl?: string | null;
  timeLocale?: string;
  /** Чат в зоне видимости — для POST read (не на скрытой вкладке). */
  panelVisible?: boolean;
}) {
  const { target, enabled, staffUserId, staffAvatarUrl, timeLocale = 'ru-RU', panelVisible = false } =
    opts;
  const targetKey = target ? adminChatTargetKey(target) : '';
  const targetRef = useRef<AdminOrderChatTarget | null>(null);
  targetRef.current = target;
  const staffAvatarRef = useRef(staffAvatarUrl);
  staffAvatarRef.current = staffAvatarUrl;
  const timeLocaleRef = useRef(timeLocale);
  timeLocaleRef.current = timeLocale;

  const [messages, setMessages] = useState<ChatWindowMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [hasOlderHistory, setHasOlderHistory] = useState(false);
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false);
  const viewerRef = useRef<string | null>(staffUserId ?? null);
  const conversationIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatWindowMessage[]>([]);
  const panelVisibleRef = useRef(panelVisible);
  panelVisibleRef.current = panelVisible;
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  viewerRef.current = staffUserId ?? viewerRef.current;

  const markReadIfVisible = useCallback(async (refreshLists = true) => {
    if (!panelVisibleRef.current) return;
    const t = targetRef.current;
    if (!t) return;
    await fetch(adminChatReadPath(t), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
    if (refreshLists) dispatchAdminChatUnreadRefresh();
  }, [targetKey]);

  const scheduleMarkReadDebounced = useCallback(() => {
    if (!panelVisibleRef.current) return;
    if (markReadTimerRef.current != null) clearTimeout(markReadTimerRef.current);
    markReadTimerRef.current = setTimeout(() => {
      markReadTimerRef.current = null;
      void markReadIfVisible();
    }, 450);
  }, [markReadIfVisible]);

  const revokeUploadedFile = useCallback(
    async (fileUrl: string) => {
      const t = targetRef.current;
      if (!t) return;
      const res = await fetch(adminChatUploadRevokePath(t), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl }),
      });
      if (!res.ok) throw new Error(await readUpstreamJsonErrorMessage(res));
    },
    [targetKey],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      const t = targetRef.current;
      if (!t) throw new Error('Чат недоступен');
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(adminChatUploadPath(t), {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      });
      if (!res.ok) {
        throw new Error(await describeOrderChatUploadFailure(res, ORDER_CHAT_UPLOAD_MAX_FILE_BYTES));
      }
      const row = await parseOrderChatUploadResponse(res);
      return {
        url: row.url,
        kind: row.kind,
        mimeType: row.mimeType,
        filename: row.filename,
      };
    },
    [targetKey],
  );

  const {
    uploadBusy,
    pendingOutgoingAttachments,
    canSendAttachmentMessage,
    pendingAttachmentsHint,
    attachChatFiles,
    removePendingChatAttachment,
    getReadyAttachments,
    clearPendingAttachments,
  } = useChatAttachments({
    enabled: Boolean(target && enabled),
    uploadFile,
    revokeFile: revokeUploadedFile,
    onError: setError,
    maxFileBytes: ORDER_CHAT_UPLOAD_MAX_FILE_BYTES,
    maxAttachments: ORDER_CHAT_ATTACHMENTS_MAX,
    fileTooLargeMessage: orderChatFileTooLargeUserMessage(),
    maxAttachmentsMessage: `Не более ${ORDER_CHAT_ATTACHMENTS_MAX} вложений в сообщении`,
  });

  messagesRef.current = messages;

  useEffect(() => {
    if (panelVisible && enabled && target) {
      void markReadIfVisible();
    }
  }, [panelVisible, enabled, targetKey, markReadIfVisible, target]);

  const syncNewerMessages = useCallback(async () => {
    const t = targetRef.current;
    if (!t) return;
    let tail = messagesRef.current;
    for (;;) {
      const lastId = tail[tail.length - 1]?.id;
      if (!lastId) return;
      const res = await fetch(
        adminChatMessagesListUrl(t, { limit: CHAT_MESSAGES_PAGE_DEFAULT, after: lastId }),
        { credentials: 'same-origin', cache: 'no-store' },
      );
      if (!res.ok) return;
      const data = (await res.json()) as OrderChatMessagesResponse;
      if (data.conversationId) conversationIdRef.current = data.conversationId;
      const mapped = (data.messages ?? []).map((m) =>
        mapApiToUi(m, viewerRef.current, timeLocaleRef.current, staffAvatarRef.current),
      );
      if (!mapped.length) return;
      tail = mergeTailMessages(tail, mapped);
      messagesRef.current = tail;
      setMessages(tail);
      if (mapped.length < CHAT_MESSAGES_PAGE_DEFAULT) return;
    }
  }, [targetKey]);

  const loadOlderChatMessages = useCallback(async () => {
    const t = targetRef.current;
    if (!t || !hasOlderHistory || loadingOlderHistory) return;
    const oldestId = messagesRef.current[0]?.id;
    if (!oldestId) return;
    setLoadingOlderHistory(true);
    setError(null);
    try {
      const res = await fetch(
        adminChatMessagesListUrl(t, {
          limit: CHAT_MESSAGES_PAGE_DEFAULT,
          before: oldestId,
        }),
        { credentials: 'same-origin', cache: 'no-store' },
      );
      if (!res.ok) throw new Error(await readUpstreamJsonErrorMessage(res));
      const data = (await res.json()) as OrderChatMessagesResponse;
      const mapped = (data.messages ?? []).map((m) =>
        mapApiToUi(m, viewerRef.current, timeLocaleRef.current, staffAvatarRef.current),
      );
      setHasOlderHistory(Boolean(data.hasOlder));
      setMessages((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...mapped.filter((x) => !seen.has(x.id)), ...prev];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось подгрузить историю');
    } finally {
      setLoadingOlderHistory(false);
    }
  }, [hasOlderHistory, loadingOlderHistory, targetKey]);

  useEffect(() => {
    const t = targetRef.current;
    if (!enabled || !t) {
      clearPendingAttachments();
      setMessages([]);
      setError(null);
      setLoading(false);
      setHasOlderHistory(false);
      setLoadingOlderHistory(false);
      conversationIdRef.current = null;
      return undefined;
    }

    clearPendingAttachments();
    setMessages([]);
    setError(null);
    setHasOlderHistory(false);
    setLoadingOlderHistory(false);
    conversationIdRef.current = null;
    setLoading(true);

    let disposed = false;
    let activeSocket: OrderChatSocket | null = null;
    let unregisterSession: (() => void) | null = null;
    let socketListenersReady = false;
    let onSocketReconnect: (() => void) | null = null;

    const joinEvent = t.kind === 'order' ? 'join_order_chat' : 'join_support_chat';
    const leaveEvent = t.kind === 'order' ? 'leave_order_chat' : 'leave_support_chat';
    const joinPayload = adminChatSocketJoinPayload(t);
    const leavePayload = adminChatSocketLeavePayload(t);

    const onCreated = (payload: OrderChatApiMessage) => {
      if (disposed || !payload?.id) return;
      const cur = conversationIdRef.current;
      if (cur && payload.conversationId && payload.conversationId !== cur) return;
      if (!cur && payload.conversationId) conversationIdRef.current = payload.conversationId;
      setMessages((prev) => {
        if (prev.some((x) => x.id === payload.id)) return prev;
        return [
          ...prev,
          mapApiToUi(payload, viewerRef.current, timeLocaleRef.current, staffAvatarRef.current),
        ];
      });
      if (payload.authorRole === 'CUSTOMER') {
        scheduleMarkReadDebounced();
      }
    };

    const onDeleted = (payload: { id?: string }) => {
      if (disposed || !payload?.id) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.id
            ? { ...m, isDeleted: true, content: undefined, documents: undefined, images: undefined, deletable: false }
            : m,
        ),
      );
    };

    const onCreatedSocket = (...args: unknown[]) => {
      onCreated(args[0] as OrderChatApiMessage);
    };
    const onDeletedSocket = (...args: unknown[]) => {
      onDeleted(args[0] as { id?: string });
    };

    const detachSocketHandlers = () => {
      if (!activeSocket) return;
      activeSocket.off('message_created', onCreatedSocket);
      activeSocket.off('message_deleted', onDeletedSocket);
      if (onSocketReconnect) {
        activeSocket.off('connect', onSocketReconnect);
        onSocketReconnect = null;
      }
    };

    const bindSocketHandlers = (socket: OrderChatSocket) => {
      detachSocketHandlers();
      activeSocket = socket;
      socket.on('message_created', onCreatedSocket);
      socket.on('message_deleted', onDeletedSocket);
      onSocketReconnect = () => {
        if (!socketListenersReady || disposed) return;
        void rejoinRoomAndSyncNewer(socket);
      };
      socket.on('connect', onSocketReconnect);
    };

    const rejoinRoomAndSyncNewer = async (socket: OrderChatSocket) => {
      await emitOrderChatRoomJoin(socket, joinEvent, joinPayload);
      if (disposed) return;
      await syncNewerMessages();
    };

    const onSocketLayerUpdated = ((ev: Event) => {
      const ce = ev as CustomEvent<{ variant?: string; socket?: OrderChatSocket }>;
      if (ce.detail?.variant !== 'admin' || disposed || !ce.detail.socket) return;
      bindSocketHandlers(ce.detail.socket);
      void rejoinRoomAndSyncNewer(ce.detail.socket);
    }) as EventListener;

    const onSessionExpired = ((ev: Event) => {
      const ce = ev as CustomEvent<{ variant?: string }>;
      if (ce.detail?.variant !== 'admin' || disposed) return;
      setError('Сессия истекла, обновите страницу или войдите снова');
    }) as EventListener;

    window.addEventListener(ORDER_CHAT_SOCKET_UPDATED_EVENT, onSocketLayerUpdated);
    window.addEventListener(ORDER_CHAT_WS_SESSION_EXPIRED_EVENT, onSessionExpired);

    const loadHistory = async (): Promise<boolean> => {
      const res = await fetch(
        adminChatMessagesListUrl(t, { limit: CHAT_MESSAGES_PAGE_DEFAULT }),
        { credentials: 'same-origin', cache: 'no-store' },
      );
      if (!res.ok) throw new Error(await readUpstreamJsonErrorMessage(res));
      const data = (await res.json()) as OrderChatMessagesResponse;
      if (disposed) return false;
      conversationIdRef.current = data.conversationId ?? null;
      setMessages((data.messages ?? []).map((m) =>
        mapApiToUi(m, viewerRef.current, timeLocaleRef.current, staffAvatarRef.current),
      ));
      setHasOlderHistory(Boolean(data.hasOlder));
      return true;
    };

    const connectLive = async (): Promise<void> => {
      const wsAuth = await fetchOrderChatWsToken('admin');
      if (disposed) return;
      viewerRef.current = wsAuth.sub ?? staffUserId ?? null;

      unregisterSession = registerOrderChatWsSession('admin', wsAuth);
      if (disposed) {
        unregisterSession();
        unregisterSession = null;
        return;
      }

      const socket = await getOrCreateSharedOrderChatSocket('admin', wsAuth);
      if (disposed) {
        unregisterSession?.();
        unregisterSession = null;
        return;
      }

      bindSocketHandlers(socket);
      socketListenersReady = true;

      const joinWhenConnected = async () => {
        if (disposed || !socket.connected) return;
        await emitOrderChatRoomJoin(socket, joinEvent, joinPayload);
        if (disposed) return;
        await syncNewerMessages();
        if (disposed) return;
        if (panelVisibleRef.current) void markReadIfVisible();
      };

      if (socket.connected) {
        await joinWhenConnected();
        return;
      }

      void waitOrderChatSocketConnect(socket)
        .then(() => joinWhenConnected())
        .catch(() => undefined);
    };

    void (async () => {
      setError(null);
      let historyOk = false;
      try {
        historyOk = await loadHistory();
      } catch (e) {
        if (!disposed) {
          setError(e instanceof Error ? e.message : 'Не удалось загрузить чат');
          setMessages([]);
          setHasOlderHistory(false);
        }
      } finally {
        if (!disposed) setLoading(false);
      }

      if (!historyOk || disposed) return;

      try {
        await connectLive();
      } catch (e) {
        if (!disposed) {
          const liveMsg = e instanceof Error ? e.message : 'Нет live-обновлений';
          setError((prev) =>
            prev ? `${prev}. ${liveMsg}` : `${liveMsg} — переписка загружена без WebSocket`,
          );
        }
      }
    })();

    return () => {
      disposed = true;
      socketListenersReady = false;
      if (markReadTimerRef.current != null) clearTimeout(markReadTimerRef.current);
      window.removeEventListener(ORDER_CHAT_SOCKET_UPDATED_EVENT, onSocketLayerUpdated);
      window.removeEventListener(ORDER_CHAT_WS_SESSION_EXPIRED_EVENT, onSessionExpired);
      detachSocketHandlers();
      activeSocket?.emit(leaveEvent, leavePayload);
      unregisterSession?.();
    };
  }, [
    enabled,
    targetKey,
    staffUserId,
    clearPendingAttachments,
    markReadIfVisible,
    scheduleMarkReadDebounced,
    syncNewerMessages,
  ]);

  const sendText = useCallback(
    async (text: string): Promise<boolean> => {
      const t = targetRef.current;
      if (!t) return false;
      const body = text.trim();
      const ready = getReadyAttachments();
      if (!body && ready.length === 0) return false;
      if (body.length > ORDER_CHAT_POST_BODY_MAX_CHARS) {
        setError(`Сообщение длиннее ${ORDER_CHAT_POST_BODY_MAX_CHARS.toLocaleString()} символов`);
        return false;
      }
      if (ready.length > ORDER_CHAT_ATTACHMENTS_MAX) {
        setError(`Не более ${ORDER_CHAT_ATTACHMENTS_MAX} вложений`);
        return false;
      }
      let refsPayloadChars = 0;
      for (const r of ready) {
        const mt = r.mimeType?.trim() ?? '';
        refsPayloadChars += (r.fileUrl?.length ?? 0) + r.filename.length + mt.length;
      }
      if (refsPayloadChars > ORDER_CHAT_ATTACHMENT_REFS_PAYLOAD_MAX_CHARS) {
        setError('Слишком большие вложения — удалите часть файлов');
        return false;
      }

      const clientMessageId = crypto.randomUUID();
      const optimisticId = `pending:${clientMessageId}`;
      const nowIso = new Date().toISOString();
      const timeLabel = new Date().toLocaleTimeString(timeLocaleRef.current, {
        hour: '2-digit',
        minute: '2-digit',
      });
      setMessages((prev) => [
        ...prev,
        {
          id: optimisticId,
          senderName: 'Вы',
          senderAvatarUrl: staffAvatarRef.current?.trim() || PROFILE_AVATAR_PLACEHOLDER,
          timeLabel,
          content: body || undefined,
          isPending: true,
          ocAuthorRole: 'STAFF',
          ocAuthorUserId: viewerRef.current ?? undefined,
          ocCreatedAtIso: nowIso,
        },
      ]);

      setSending(true);
      setError(null);
      try {
        const res = await fetch(adminChatMessagesPath(t), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientMessageId,
            body: body || undefined,
            attachments:
              ready.length > 0
                ? ready.map((r) => ({
                    fileUrl: r.fileUrl!,
                    filename: r.filename,
                    mimeType: r.mimeType,
                    kind: r.kind,
                  }))
                : undefined,
          }),
        });
        if (!res.ok) throw new Error(await readUpstreamJsonErrorMessage(res));
        const created = (await res.json()) as OrderChatApiMessage;
        setMessages((prev) => {
          const withoutPending = prev.filter((m) => m.id !== optimisticId);
          if (withoutPending.some((x) => x.id === created.id)) return withoutPending;
          return [
            ...withoutPending,
            mapApiToUi(created, viewerRef.current, timeLocaleRef.current, staffAvatarRef.current),
          ];
        });
        clearPendingAttachments();
        await markReadIfVisible(false);
        return true;
      } catch (e) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setError(e instanceof Error ? e.message : 'Не удалось отправить');
        return false;
      } finally {
        setSending(false);
      }
    },
    [targetKey, getReadyAttachments, clearPendingAttachments, markReadIfVisible],
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      const t = targetRef.current;
      if (!t) return;
      setError(null);
      try {
        const res = await fetch(adminChatDeletePath(t, messageId), {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (!res.ok) throw new Error(await readUpstreamJsonErrorMessage(res));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, isDeleted: true, content: undefined, documents: undefined, images: undefined, deletable: false }
              : m,
          ),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось удалить');
      }
    },
    [targetKey],
  );

  return {
    chatMessages: messages,
    chatLoading: loading,
    chatError: error,
    chatComposerDisabled: loading,
    chatSendDisabled: loading || sending || uploadBusy,
    chatAttachPickerDisabled: sending || uploadBusy,
    pendingAttachmentsHint,
    pendingOutgoingAttachments,
    canSendAttachmentMessage,
    sendChatText: sendText,
    attachChatFiles,
    removePendingChatAttachment,
    deleteChatMessage: deleteMessage,
    chatHasOlderHistory: hasOlderHistory,
    chatLoadingOlderHistory: loadingOlderHistory,
    loadOlderChatMessages,
  };
}
