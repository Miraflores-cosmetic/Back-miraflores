import type { OrderChatVariant } from './constants';
import {
  ORDER_CHAT_SOCKET_NAMESPACE,
  ORDER_CHAT_SOCKET_UPDATED_EVENT,
  ORDER_CHAT_WS_REFRESH_BUFFER_MS,
  ORDER_CHAT_WS_REFRESH_FALLBACK_MS,
  ORDER_CHAT_WS_SESSION_EXPIRED_EVENT,
} from './constants';

export type OrderChatWsAuth = {
  token: string;
  sub: string | null;
  exp: number | null;
};

/** Минимальный контракт Socket.IO-клиента (инжектируется из приложения). */
export type OrderChatSocket = {
  connected: boolean;
  once(event: string, cb: (...args: unknown[]) => void): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  off(event: string, cb?: (...args: unknown[]) => void): void;
  removeAllListeners(): void;
  disconnect(): void;
  emit(event: string, ...args: unknown[]): void;
  io: { opts: { reconnection?: boolean } };
};

export type OrderChatIoFactory = (
  url: string,
  options: Record<string, unknown>,
) => OrderChatSocket;

export type CreateOrderChatSocketManagerDeps = {
  getWsOrigin: () => string;
  loadIo: () => Promise<{ io: OrderChatIoFactory }>;
  fetchWsToken: (variant: OrderChatVariant) => Promise<OrderChatWsAuth>;
  warn?: (message: string) => void;
};

type SharedSlice = { socket: OrderChatSocket; auth: OrderChatWsAuth } | null;

export type OrderChatSocketManager = {
  ORDER_CHAT_WS_SESSION_EXPIRED_EVENT: typeof ORDER_CHAT_WS_SESSION_EXPIRED_EVENT;
  isOrderChatWsAuthFailed: (variant: OrderChatVariant) => boolean;
  disposeSharedOrderChatSocket: (variant: OrderChatVariant) => void;
  teardownOrderChatWsForLogout: (variant: OrderChatVariant) => void;
  fetchWsToken: (variant: OrderChatVariant) => Promise<OrderChatWsAuth>;
  waitOrderChatSocketConnect: (socket: OrderChatSocket, ms?: number) => Promise<void>;
  emitOrderChatRoomJoin: (
    socket: OrderChatSocket,
    joinEvent: string,
    payload: Record<string, string>,
    ms?: number,
  ) => Promise<void>;
  getOrCreateSharedOrderChatSocket: (
    variant: OrderChatVariant,
    auth: OrderChatWsAuth,
  ) => Promise<OrderChatSocket>;
  registerOrderChatWsSession: (
    variant: OrderChatVariant,
    auth: OrderChatWsAuth,
  ) => () => void;
};

export function createOrderChatSocketManager(
  deps: CreateOrderChatSocketManagerDeps,
): OrderChatSocketManager {
  const sharedByVariant: Record<OrderChatVariant, SharedSlice> = {
    account: null,
    admin: null,
  };
  const refCountByVariant: Record<OrderChatVariant, number> = {
    account: 0,
    admin: 0,
  };
  const ttlTimerByVariant: Record<OrderChatVariant, ReturnType<typeof setTimeout> | null> = {
    account: null,
    admin: null,
  };
  const authFailedByVariant: Record<OrderChatVariant, boolean> = {
    account: false,
    admin: false,
  };
  const authFetchFailuresByVariant: Record<OrderChatVariant, number> = {
    account: 0,
    admin: 0,
  };
  const jwtRefreshInFlight: Partial<Record<OrderChatVariant, boolean>> = {};
  const connectInFlight: Partial<Record<OrderChatVariant, Promise<OrderChatSocket>>> = {};
  let ioFactory: OrderChatIoFactory | null = null;

  const warn = deps.warn ?? ((msg: string) => {
    if (typeof console !== 'undefined') console.warn(msg);
  });

  async function getIo(): Promise<OrderChatIoFactory> {
    if (!ioFactory) {
      const mod = await deps.loadIo();
      ioFactory = mod.io;
    }
    return ioFactory;
  }

  function clearTtl(variant: OrderChatVariant) {
    const t = ttlTimerByVariant[variant];
    if (t != null) clearTimeout(t);
    ttlTimerByVariant[variant] = null;
  }

  function emitSocketUpdated(variant: OrderChatVariant, socket: OrderChatSocket) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent(ORDER_CHAT_SOCKET_UPDATED_EVENT, { detail: { variant, socket } }),
    );
  }

  function emitSessionExpired(variant: OrderChatVariant) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent(ORDER_CHAT_WS_SESSION_EXPIRED_EVENT, { detail: { variant } }),
    );
  }

  function isLikelyAuthConnectError(err: Error): boolean {
    const msg = (err?.message ?? '').toLowerCase();
    return (
      msg.includes('unauthorized') ||
      msg.includes('forbidden') ||
      msg.includes('invalid') ||
      msg.includes('jwt') ||
      msg.includes('token') ||
      msg.includes('session') ||
      msg.includes('сессия')
    );
  }

  function handleWsAuthFailure(variant: OrderChatVariant): void {
    authFailedByVariant[variant] = true;
    clearTtl(variant);
    const cur = sharedByVariant[variant];
    if (cur) {
      cur.socket.io.opts.reconnection = false;
      cur.socket.removeAllListeners();
      cur.socket.disconnect();
      sharedByVariant[variant] = null;
    }
    emitSessionExpired(variant);
  }

  function disposeSharedOrderChatSocket(variant: OrderChatVariant): void {
    const cur = sharedByVariant[variant];
    if (!cur) return;
    cur.socket.io.opts.reconnection = false;
    cur.socket.removeAllListeners();
    cur.socket.disconnect();
    sharedByVariant[variant] = null;
  }

  function wireRecovery(socket: OrderChatSocket, variant: OrderChatVariant) {
    socket.on('connect', () => {
      authFetchFailuresByVariant[variant] = 0;
      authFailedByVariant[variant] = false;
    });
    socket.on('connect_error', (err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      if (isLikelyAuthConnectError(e)) {
        authFetchFailuresByVariant[variant]++;
        if (authFetchFailuresByVariant[variant] >= 2) {
          handleWsAuthFailure(variant);
        }
      }
      /* R1: транспортные ошибки — reconnection + auth callback, без recreate storm */
    });
    socket.on('disconnect', (reason: unknown) => {
      const r = String(reason);
      if (r === 'io client disconnect') return;
      /* io server disconnect / transport: Socket.IO reconnect; свежий JWT в auth callback */
    });
  }

  function delayUntilNextRefresh(expSeconds: number | null): number {
    if (expSeconds == null) return ORDER_CHAT_WS_REFRESH_FALLBACK_MS;
    const expMs = expSeconds * 1000;
    const left = expMs - Date.now() - ORDER_CHAT_WS_REFRESH_BUFFER_MS;
    return Math.min(Math.max(left, 10_000), 24 * 60 * 60_000);
  }

  function scheduleTtlRefresh(variant: OrderChatVariant, auth?: OrderChatWsAuth): void {
    clearTtl(variant);
    if (refCountByVariant[variant] <= 0) return;
    if (authFailedByVariant[variant]) return;

    const a = auth ?? sharedByVariant[variant]?.auth;
    if (!a) return;

    ttlTimerByVariant[variant] = setTimeout(() => {
      ttlTimerByVariant[variant] = null;
      if (refCountByVariant[variant] <= 0 || authFailedByVariant[variant]) return;
      void refreshWsJwtIfRotated(variant);
    }, delayUntilNextRefresh(a.exp));
  }

  async function refreshWsJwtIfRotated(variant: OrderChatVariant): Promise<void> {
    if (
      refCountByVariant[variant] <= 0 ||
      authFailedByVariant[variant] ||
      jwtRefreshInFlight[variant]
    ) {
      return;
    }
    jwtRefreshInFlight[variant] = true;
    try {
      const auth = await deps.fetchWsToken(variant);
      authFailedByVariant[variant] = false;
      const existing = sharedByVariant[variant];
      if (existing) {
        existing.auth = auth;
      }
      scheduleTtlRefresh(variant, auth);
    } catch (e) {
      warn(`[order-chat-ws] jwt refresh failed: ${e instanceof Error ? e.message : String(e)}`);
      scheduleTtlRefresh(variant);
    } finally {
      jwtRefreshInFlight[variant] = false;
    }
  }

  async function connectNewSharedSocket(
    variant: OrderChatVariant,
    auth: OrderChatWsAuth,
  ): Promise<OrderChatSocket> {
    const io = await getIo();
    const origin = deps.getWsOrigin();
    const url = `${origin}${ORDER_CHAT_SOCKET_NAMESPACE}`;
    const socket = io(url, {
      auth: (cb: (data: Record<string, string> | Error) => void) => {
        void deps
          .fetchWsToken(variant)
          .then((fresh) => {
            authFetchFailuresByVariant[variant] = 0;
            authFailedByVariant[variant] = false;
            const slice = sharedByVariant[variant];
            if (slice) slice.auth = fresh;
            cb({ token: fresh.token });
          })
          .catch((e) => {
            authFetchFailuresByVariant[variant]++;
            if (authFetchFailuresByVariant[variant] >= 2) {
              handleWsAuthFailure(variant);
            }
            cb(e instanceof Error ? e : new Error(String(e)));
          });
      },
      transports: ['websocket', 'polling'],
      path: '/socket.io',
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
    sharedByVariant[variant] = { socket, auth };
    wireRecovery(socket, variant);
    return socket;
  }

  function waitOrderChatSocketConnect(socket: OrderChatSocket, ms = 12000): Promise<void> {
    if (socket.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        cleanup();
        reject(new Error('Нет соединения с чатом'));
      }, ms);
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(t);
        socket.off('connect', onConnect);
      };
      socket.on('connect', onConnect);
    });
  }

  function emitOrderChatRoomJoin(
    socket: OrderChatSocket,
    joinEvent: string,
    payload: Record<string, string>,
    ms = 12000,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Не удалось подключиться к комнате чата')), ms);
      socket.emit(joinEvent, payload, (ack: unknown) => {
        clearTimeout(t);
        const ok = ack && typeof ack === 'object' && (ack as { ok?: boolean }).ok;
        if (ok) resolve();
        else reject(new Error('Нет доступа к комнате чата'));
      });
    });
  }

  async function getOrCreateSharedOrderChatSocket(
    variant: OrderChatVariant,
    auth: OrderChatWsAuth,
  ): Promise<OrderChatSocket> {
    if (authFailedByVariant[variant]) {
      throw new Error('Сессия чата истекла, войдите снова');
    }

    const existing = sharedByVariant[variant];
    if (existing?.socket) {
      existing.auth = auth;
      return existing.socket;
    }

    const inFlight = connectInFlight[variant];
    if (inFlight) return inFlight;

    const promise = (async () => {
      const socket = await connectNewSharedSocket(variant, auth);
      void waitOrderChatSocketConnect(socket)
        .then(() => {
          if (sharedByVariant[variant]?.socket === socket) {
            emitSocketUpdated(variant, socket);
          }
        })
        .catch(() => undefined);
      return socket;
    })();

    connectInFlight[variant] = promise;
    try {
      return await promise;
    } finally {
      if (connectInFlight[variant] === promise) {
        delete connectInFlight[variant];
      }
    }
  }

  function registerOrderChatWsSession(variant: OrderChatVariant, auth: OrderChatWsAuth): () => void {
    refCountByVariant[variant]++;
    if (refCountByVariant[variant] === 1) {
      scheduleTtlRefresh(variant, auth);
    }

    return () => {
      refCountByVariant[variant] = Math.max(0, refCountByVariant[variant] - 1);
      if (refCountByVariant[variant] === 0) {
        clearTtl(variant);
        disposeSharedOrderChatSocket(variant);
      }
    };
  }

  return {
    ORDER_CHAT_WS_SESSION_EXPIRED_EVENT,
    isOrderChatWsAuthFailed: (variant) => authFailedByVariant[variant],
    disposeSharedOrderChatSocket,
    teardownOrderChatWsForLogout(variant) {
      clearTtl(variant);
      refCountByVariant[variant] = 0;
      jwtRefreshInFlight[variant] = false;
      authFailedByVariant[variant] = false;
      authFetchFailuresByVariant[variant] = 0;
      delete connectInFlight[variant];
      disposeSharedOrderChatSocket(variant);
    },
    fetchWsToken: deps.fetchWsToken,
    waitOrderChatSocketConnect,
    emitOrderChatRoomJoin,
    getOrCreateSharedOrderChatSocket,
    registerOrderChatWsSession,
  };
}
