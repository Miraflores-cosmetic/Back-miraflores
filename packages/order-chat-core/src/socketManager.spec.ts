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
    removeAllListeners() {
      for (const k of Object.keys(handlers)) delete handlers[k];
    },
    disconnect: vi.fn(),
    emit: vi.fn(),
  };
}

describe('orderChatSocketManager R1', () => {
  it('does not refetch token on transport disconnect (relies on socket.io reconnection)', async () => {
    const fetchWsToken = vi.fn(async () => ({
      token: 't1',
      sub: 'u1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }));
    const socket = mockSocket();
    const io = vi.fn(() => socket);
    const mgr = createOrderChatSocketManager({
      getWsOrigin: () => 'http://localhost:3001',
      loadIo: async () => ({ io }),
      fetchWsToken,
    });

    const auth = await mgr.fetchWsToken('account');
    expect(fetchWsToken).toHaveBeenCalledTimes(1);

    await mgr.getOrCreateSharedOrderChatSocket('account', auth);
    expect(io).toHaveBeenCalledTimes(1);

    const disconnectHandlers = socket.handlers.disconnect ?? [];
    expect(disconnectHandlers.length).toBeGreaterThan(0);
    disconnectHandlers[0]!('transport close');

    expect(fetchWsToken).toHaveBeenCalledTimes(1);
  });
});
