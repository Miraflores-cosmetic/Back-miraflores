import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatConversationKind, ChatMessageAuthorRole, OrderStatus } from '@prisma/client';
import { OrderChatService } from './order-chat.service';

describe('OrderChatService', () => {
  let svc: OrderChatService;
  const prisma = {
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn() },
    order: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    chatConversation: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    chatMessage: { count: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    chatReadState: { findUnique: vi.fn(), upsert: vi.fn() },
  };
  const storage = {
    tryPublicUrlToKey: vi.fn(),
    saveChatFile: vi.fn(),
  };
  const staffAccess = { assertStaffCanAccessSection: vi.fn() };
  const mail = {
    sendOrderChatReply: vi.fn(),
    sendOrderChatSupportReply: vi.fn(),
  };
  const jwt = { sign: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    svc = new OrderChatService(
      prisma as never,
      storage as never,
      { get: vi.fn() } as never,
      staffAccess as never,
      mail as never,
      jwt as never,
    );
  });

  it('seedCustomerNoteFromOrder creates first customer message', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      userId: 'u1',
      customerNote: '  Привезите после 18  ',
    });
    prisma.chatConversation.upsert.mockResolvedValue({ id: 'c1' });
    prisma.chatMessage.create.mockResolvedValue({ id: 'm1' });
    prisma.user.findUnique.mockResolvedValue({
      email: 'u@test',
      displayName: 'Buyer',
      staffDisplayName: null,
      staffAvatarUrl: null,
    });

    await svc.seedCustomerNoteFromOrder('o1');

    expect(prisma.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authorUserId: 'u1',
          authorRole: ChatMessageAuthorRole.CUSTOMER,
          body: 'Привезите после 18',
          clientMessageId: 'seed:customer-note',
        }),
      }),
    );
  });

  it('unreadCountForStaff splits support and order chats', async () => {
    prisma.$queryRaw.mockResolvedValue([{ support: BigInt(3), orders: BigInt(5) }]);
    await expect(svc.unreadCountForStaff('s1')).resolves.toEqual({ support: 3, orders: 5 });
  });

  it('read state never lags behind the latest message (DB clock ahead of app clock)', async () => {
    const future = new Date(Date.now() + 60_000);
    prisma.chatMessage.findFirst.mockResolvedValue({ createdAt: future });
    await (svc as unknown as { upsertReadState(c: string, u: string): Promise<void> }).upsertReadState(
      'c1',
      's1',
    );
    expect(prisma.chatReadState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { conversationId: 'c1', userId: 's1', lastReadAt: future },
        update: { lastReadAt: future },
      }),
    );
  });

  it('unreadOrderChatCountsForStaff maps orderId → count', async () => {
    prisma.chatConversation.findMany.mockResolvedValue([
      { id: 'c1', orderId: 'o1' },
      { id: 'c2', orderId: 'o2' },
    ]);
    prisma.$queryRaw.mockResolvedValue([
      { conversationId: 'c1', count: BigInt(2) },
      { conversationId: 'c2', count: BigInt(0) },
    ]);

    const map = await svc.unreadOrderChatCountsForStaff('staff1', ['o1', 'o2', 'o3']);

    expect(prisma.chatConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orderId: { in: ['o1', 'o2', 'o3'] },
          kind: ChatConversationKind.ORDER,
        }),
      }),
    );
    expect(map).toEqual({ o1: 2, o2: 0 });
  });

  it('orderChatMessageCountsForOrders maps orderId → total messages', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { orderId: 'o1', count: BigInt(5) },
      { orderId: 'o2', count: BigInt(1) },
    ]);

    const map = await svc.orderChatMessageCountsForOrders(['o1', 'o2', 'o3']);

    expect(map).toEqual({ o1: 5, o2: 1, o3: 0 });
  });

  it('applyRetentionForOrder sets purgesAt on delivered', async () => {
    prisma.chatConversation.findUnique.mockResolvedValue({
      id: 'c1',
      retentionPurgesAt: null,
    });
    prisma.chatConversation.update.mockResolvedValue({});

    await svc.applyRetentionForOrder('o1', OrderStatus.DELIVERED);

    expect(prisma.chatConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({
          retentionPurgesAt: expect.any(Date),
        }),
      }),
    );
  });
});
