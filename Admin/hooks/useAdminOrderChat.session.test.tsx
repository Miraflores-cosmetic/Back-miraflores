/** @vitest-environment jsdom */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAdminOrderChat } from './useAdminOrderChat';

const messageListFetch = vi.fn();
const wsTokenFetch = vi.fn();

vi.mock('@/app/(admin)/admin/settings/staff/StaffAvatarField', () => ({
  DEFAULT_STAFF_AVATAR: '/avatar-placeholder.png',
}));

const clearPendingAttachments = vi.fn();
const attachChatFiles = vi.fn();
const removePendingChatAttachment = vi.fn();

vi.mock('@/hooks/useChatAttachments', () => ({
  useChatAttachments: () => ({
    uploadBusy: false,
    pendingOutgoingAttachments: [],
    canSendAttachmentMessage: false,
    pendingAttachmentsHint: undefined,
    attachChatFiles,
    removePendingChatAttachment,
    getReadyAttachments: () => [],
    clearPendingAttachments,
  }),
}));

vi.mock('@/lib/orderChat/orderChatWsShared', () => ({
  fetchOrderChatWsToken: (...args: unknown[]) => wsTokenFetch(...args),
  registerOrderChatWsSession: vi.fn(() => () => undefined),
  getOrCreateSharedOrderChatSocket: vi.fn(async () => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connected: true,
  })),
  waitOrderChatSocketConnect: vi.fn().mockResolvedValue(undefined),
  emitOrderChatRoomJoin: vi.fn().mockResolvedValue(undefined),
  ORDER_CHAT_WS_SESSION_EXPIRED_EVENT: 'order-chat-ws-session-expired',
}));

describe('useAdminOrderChat session', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('loads messages once when target object identity changes but key stays the same', async () => {
    wsTokenFetch.mockResolvedValue({ token: 'ws', sub: 'staff1', exp: 9_999_999_999 });
    messageListFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ conversationId: 'c1', messages: [], hasOlder: false }),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/chat/messages') && (!init?.method || init.method === 'GET')) {
          return messageListFetch();
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );

    const targetA = { kind: 'order' as const, orderId: 'o1' };
    const { rerender } = renderHook(
      ({ target }) =>
        useAdminOrderChat({
          target,
          enabled: true,
          staffUserId: 'staff1',
        }),
      { initialProps: { target: targetA } },
    );

    await waitFor(() => expect(messageListFetch).toHaveBeenCalledTimes(1));

    const targetB = { kind: 'order' as const, orderId: 'o1' };
    rerender({ target: targetB });

    await waitFor(() => expect(messageListFetch).toHaveBeenCalledTimes(1));
  });

  it('suppress auto-read переживает visibility flicker после «Непрочитанным»', async () => {
    wsTokenFetch.mockResolvedValue({ token: 'ws', sub: 'staff1', exp: 9_999_999_999 });
    messageListFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ conversationId: 'c1', messages: [], hasOlder: false }),
    });

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/chat/messages') && (!init?.method || init.method === 'GET')) {
        return messageListFetch();
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, changed: true }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const target = { kind: 'order' as const, orderId: 'o1' };
    const { result, rerender } = renderHook(
      ({ panelVisible }) =>
        useAdminOrderChat({
          target,
          enabled: true,
          staffUserId: 'staff1',
          panelVisible,
        }),
      { initialProps: { panelVisible: true } },
    );

    await waitFor(() => expect(messageListFetch).toHaveBeenCalledTimes(1));

    const ok = await result.current.markChatUnread();
    expect(ok).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).includes('/chat/unread') && init?.method === 'POST',
      ),
    ).toBe(true);

    const readCallsBefore = fetchMock.mock.calls.filter(
      ([input, init]) => String(input).includes('/chat/read') && init?.method === 'POST',
    ).length;

    // IntersectionObserver / tab blur flicker — диалог всё ещё выбран.
    rerender({ panelVisible: false });
    rerender({ panelVisible: true });

    await new Promise((r) => setTimeout(r, 100));

    const readCallsAfter = fetchMock.mock.calls.filter(
      ([input, init]) => String(input).includes('/chat/read') && init?.method === 'POST',
    ).length;
    expect(readCallsAfter).toBe(readCallsBefore);
  });

  it('canMarkChatUnread=false без customer; changed:false не оставляет suppress', async () => {
    wsTokenFetch.mockResolvedValue({ token: 'ws', sub: 'staff1', exp: 9_999_999_999 });
    messageListFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ conversationId: 'c1', messages: [], hasOlder: false }),
    });

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/chat/messages') && (!init?.method || init.method === 'GET')) {
        return messageListFetch();
      }
      if (url.includes('/chat/unread')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, changed: false }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const target = { kind: 'order' as const, orderId: 'o2' };
    const { result } = renderHook(() =>
      useAdminOrderChat({
        target,
        enabled: true,
        staffUserId: 'staff1',
        panelVisible: true,
      }),
    );

    await waitFor(() => expect(messageListFetch).toHaveBeenCalledTimes(1));
    expect(result.current.canMarkChatUnread).toBe(false);

    const ok = await result.current.markChatUnread();
    expect(ok).toBe(false);
    expect(localStorage.getItem('miraflores.adminChat.suppressRead:order:o2')).toBeNull();
  });

  it('cold-open вкладка подхватывает suppress из localStorage и не шлёт /read', async () => {
    localStorage.setItem('miraflores.adminChat.suppressRead:order:o3', '1');
    wsTokenFetch.mockResolvedValue({ token: 'ws', sub: 'staff1', exp: 9_999_999_999 });
    messageListFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ conversationId: 'c1', messages: [], hasOlder: false }),
    });

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/chat/messages') && (!init?.method || init.method === 'GET')) {
        return messageListFetch();
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() =>
      useAdminOrderChat({
        target: { kind: 'order', orderId: 'o3' },
        enabled: true,
        staffUserId: 'staff1',
        panelVisible: true,
      }),
    );

    await waitFor(() => expect(messageListFetch).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 80));

    const readCalls = fetchMock.mock.calls.filter(
      ([input, init]) => String(input).includes('/chat/read') && init?.method === 'POST',
    );
    expect(readCalls).toHaveLength(0);
  });
});
