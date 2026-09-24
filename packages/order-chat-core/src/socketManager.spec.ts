import { describe, expect, it, vi } from 'vitest';
import { createOrderChatSocketManager, type OrderChatSocket } from './socketManager';

function mockSocket(): OrderChatSocket & { handlers: Record<string, Array<(...args: unknown[]) => void>> } {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    handlers,
    connected: false,
    io: { opts: { reconnection: true } },
    once(event, cb) {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(cb);
    },
    on(event, cb) {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(cb);
    },
    off(event, cb) {
      if (!cb) {
        delete handlers[event];
        return;
      }
      handlers[event] = (handlers[event] ?? []).filter((h) => h !== cb);
    },
    removeAllListeners() {
      for (const k of Object.keys(handlers)) delete handlers[k];
    },
    disconnect: vi.fn(),
    emit: vi.fn(),
  };
}

describe('orderChatSocketManager', () => {
  it('auth callback fetches token; server disconnect does not sticky-fail auth', async () => {
    const fetchWsToken = vi.fn(async () => ({
      token: 't1',
      sub: 'u1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }));
    const socket = mockSocket();
    const io = vi.fn((_url: string, opts?: Record<string, unknown>) => {
      const auth = opts?.auth;
      if (typeof auth === 'function') {
        auth((data: { token: string } | Error) => {
          if (data instanceof Error) throw data;
          expect(data.token).toBe('t1');
        });
      }
      return socket;
    });
    const mgr = createOrderChatSocketManager({
      getWsOrigin: () => 'http://localhost:3001',
      loadIo: async () => ({ io }),
      fetchWsToken,
    });

    const auth = await mgr.fetchWsToken('account');
    await mgr.getOrCreateSharedOrderChatSocket('account', auth);

    const disconnectHandlers = socket.handlers.disconnect ?? [];
    disconnectHandlers[0]!('transport close');
    disconnectHandlers[0]!('io server disconnect');

    expect(mgr.isOrderChatWsAuthFailed('account')).toBe(false);
  });
});
