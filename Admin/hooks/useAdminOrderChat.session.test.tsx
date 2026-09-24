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
});
