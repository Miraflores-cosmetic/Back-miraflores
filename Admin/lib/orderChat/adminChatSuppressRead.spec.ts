/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  publishAdminChatSuppressRead,
  readAdminChatSuppressRead,
  readAdminChatUnreadGeneration,
  subscribeAdminChatSuppressRead,
} from './adminChatSuppressRead';

describe('adminChatSuppressRead', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('localStorage round-trip + generation', () => {
    expect(readAdminChatSuppressRead('order:o1')).toBe(false);
    publishAdminChatSuppressRead({
      type: 'set',
      targetKey: 'order:o1',
      unreadGeneration: 4,
    });
    expect(readAdminChatSuppressRead('order:o1')).toBe(true);
    expect(readAdminChatUnreadGeneration('order:o1')).toBe(4);
    publishAdminChatSuppressRead({ type: 'clear', targetKey: 'order:o1' });
    expect(readAdminChatSuppressRead('order:o1')).toBe(false);
    expect(readAdminChatUnreadGeneration('order:o1')).toBe(4);
  });

  it('BroadcastChannel доставляет set/clear другим подписчикам', async () => {
    // Отдельный BC: отправитель не получает свои же postMessage.
    const seen: Array<{ type: string; targetKey: string; unreadGeneration?: number }> =
      [];
    const peer = new BroadcastChannel('miraflores-admin-chat-suppress-read');
    peer.addEventListener('message', (ev) => {
      seen.push(ev.data as { type: string; targetKey: string; unreadGeneration?: number });
    });

    publishAdminChatSuppressRead({
      type: 'set',
      targetKey: 'order:o1',
      unreadGeneration: 2,
    });
    expect(readAdminChatSuppressRead('order:o1')).toBe(true);
    await vi.waitFor(() => {
      expect(seen).toEqual([
        { type: 'set', targetKey: 'order:o1', unreadGeneration: 2 },
      ]);
    });

    publishAdminChatSuppressRead({ type: 'clear', targetKey: 'order:o1' });
    expect(readAdminChatSuppressRead('order:o1')).toBe(false);
    await vi.waitFor(() => {
      expect(seen[1]).toEqual({ type: 'clear', targetKey: 'order:o1' });
    });

    peer.close();
    const unsub = subscribeAdminChatSuppressRead(() => undefined);
    unsub();
  });
});
