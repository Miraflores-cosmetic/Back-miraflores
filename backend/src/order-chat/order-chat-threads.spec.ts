import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OrderChatService, compareCustomerThreads } from './order-chat.service';
import {
  decodeSupportThreadCursor,
  encodeSupportThreadCursor,
} from './order-chat-unread.util';
import type { ChatThreadListItem } from './order-chat.types';

function thread(p: Partial<ChatThreadListItem>): ChatThreadListItem {
  return {
    kind: 'ORDER',
    conversationId: 'c',
    title: 't',
    unreadCount: 0,
    lastMessagePreview: null,
    lastMessageAt: null,
    ...p,
  };
}

function sqlText(args: unknown[]): string {
  const strings = args[0] as TemplateStringsArray | { strings?: string[] };
  if (Array.isArray(strings)) return strings.join('?');
  return (strings as { strings?: string[] }).strings?.join('?') ?? '';
}

describe('compareCustomerThreads', () => {
  it('unread first, then latest message, empty threads last', () => {
    const sorted = [
      thread({ orderId: 'old', lastMessageAt: '2026-09-01T10:00:00.000Z' }),
      thread({ kind: 'SUPPORT', conversationId: null, lastMessageAt: null }),
      thread({ orderId: 'new', lastMessageAt: '2026-09-20T10:00:00.000Z' }),
      thread({ orderId: 'unread', unreadCount: 2, lastMessageAt: '2026-08-01T10:00:00.000Z' }),
    ].sort(compareCustomerThreads);

    expect(sorted.map((t) => t.orderId ?? t.kind)).toEqual(['unread', 'new', 'old', 'SUPPORT']);
  });
});

describe('support thread cursor', () => {
  it('round-trips and rejects garbage', () => {
    const c = { u: 1 as const, t: '2026-09-24T18:00:00.123Z', id: 'conv1' };
    expect(decodeSupportThreadCursor(encodeSupportThreadCursor(c))).toEqual(c);
    expect(decodeSupportThreadCursor('not-a-cursor')).toBeNull();
    expect(
      decodeSupportThreadCursor(Buffer.from('{"u":2,"t":"x","id":1}').toString('base64url')),
    ).toBeNull();
    expect(decodeSupportThreadCursor('')).toBeNull();
  });
});

describe('OrderChatService thread lists', () => {
  let svc: OrderChatService;
  const prisma = {
    $queryRaw: vi.fn(),
    order: { findMany: vi.fn() },
    chatConversation: { findFirst: vi.fn(), findMany: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new OrderChatService(
      prisma as never,
      {} as never,
      { get: vi.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('listThreadsForCustomer: only orders with messages, sorted, plus startable orders', async () => {
    prisma.chatConversation.findFirst.mockResolvedValue({ id: 'sup' });
    prisma.chatConversation.findMany.mockResolvedValue([
      { id: 'c-old', order: { id: 'o-old', number: '1001' } },
      { id: 'c-new', order: { id: 'o-new', number: '1002' } },
    ]);
    prisma.$queryRaw.mockImplementation((...args: unknown[]) => {
      const sql = sqlText(args);
      if (sql.includes('DISTINCT ON')) {
        return Promise.resolve([
          { conversationId: 'c-old', body: 'старое', createdAt: new Date('2026-09-01T10:00:00Z'), attCount: 0n },
          { conversationId: 'c-new', body: 'новое', createdAt: new Date('2026-09-20T10:00:00Z'), attCount: 0n },
          { conversationId: 'sup', body: 'привет', createdAt: new Date('2026-09-10T10:00:00Z'), attCount: 0n },
        ]);
      }
      return Promise.resolve([{ conversationId: 'c-old', count: 1n }]);
    });
    prisma.order.findMany.mockResolvedValue([
      { id: 'o-empty', number: '1003', createdAt: new Date('2026-09-22T10:00:00Z') },
    ]);

    const out = await svc.listThreadsForCustomer('u1');

    expect(out.threads.map((t) => t.orderId ?? t.kind)).toEqual(['o-old', 'o-new', 'SUPPORT']);
    expect(out.threads[0].unreadCount).toBe(1);
    expect(prisma.chatConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ messages: { some: { deletedAt: null } } }),
      }),
    );
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', id: { notIn: ['o-old', 'o-new'] } },
      }),
    );
    expect(out.startableOrders).toEqual([
      { orderId: 'o-empty', orderNumber: '1003', createdAt: '2026-09-22T10:00:00.000Z' },
    ]);
  });

  it('listSupportThreadsForAdmin: returns nextCursor when a page overflows', async () => {
    const rows = [1, 2, 3].map((i) => ({
      id: `c${i}`,
      userId: `u${i}`,
      email: `u${i}@test`,
      displayName: null,
      sortAt: new Date(`2026-09-2${i}T10:00:00Z`),
      unread: i === 1 ? 3n : 0n,
    }));
    prisma.$queryRaw.mockImplementation((...args: unknown[]) => {
      const sql = sqlText(args);
      if (sql.includes('LATERAL')) return Promise.resolve(rows);
      if (sql.includes('EXISTS')) return Promise.resolve([{ count: 1n }]);
      return Promise.resolve([]);
    });

    const out = await svc.listSupportThreadsForAdmin('staff', { limit: 2 });

    expect(out.threads.map((t) => t.userId)).toEqual(['u1', 'u2']);
    expect(out.threads[0].unreadCount).toBe(3);
    expect(out.unreadThreadsTotal).toBe(1);
    expect(decodeSupportThreadCursor(out.nextCursor)).toEqual({
      u: 0,
      t: '2026-09-22T10:00:00.000Z',
      id: 'c2',
    });
  });

  it('listSupportThreadsForAdmin: rejects a malformed cursor', async () => {
    await expect(
      svc.listSupportThreadsForAdmin('staff', { cursor: 'garbage' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
