import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatConversationKind, ChatMessageAuthorRole, OrderStatus } from '@prisma/client';
import { OrderChatService } from './order-chat.service';

type NotifyPriv = {
  notifyAdminByEmail(
    conversationId: string,
    ctx:
      | { kind: 'ORDER'; orderId: string; customerUserId: string }
      | { kind: 'SUPPORT'; customerUserId: string },
    messageText: string,
  ): Promise<void>;
  notifyCustomerByEmail(
    conversationId: string,
    ctx:
      | { kind: 'ORDER'; orderId: string; customerUserId: string }
      | { kind: 'SUPPORT'; customerUserId: string },
    snippet: string,
  ): Promise<void>;
};

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
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    chatMessage: { count: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    chatReadState: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
  };
  const storage = {
    tryPublicUrlToKey: vi.fn(),
    saveChatFile: vi.fn(),
  };
  const staffAccess = { assertStaffCanAccessSection: vi.fn() };
  const mail = {
    sendOrderChatReply: vi.fn(),
    sendOrderChatSupportReply: vi.fn(),
    sendAdminChatNotify: vi.fn(),
    resolveAdminPublicUrl: vi.fn(() => 'https://admin.test'),
    resolveAdminOrderNotifyEmail: vi.fn(() => 'mira-robot@miraflores-shop.ru'),
  };
  const jwt = { sign: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.chatConversation.updateMany.mockResolvedValue({ count: 1 });
    mail.sendOrderChatReply.mockResolvedValue(true);
    mail.sendOrderChatSupportReply.mockResolvedValue(true);
    mail.sendAdminChatNotify.mockResolvedValue(true);
    mail.resolveAdminPublicUrl.mockReturnValue('https://admin.test');
    mail.resolveAdminOrderNotifyEmail.mockReturnValue('mira-robot@miraflores-shop.ru');
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
    await (
      svc as unknown as {
        upsertReadState(
          c: string,
          u: string,
          o?: { force?: boolean },
        ): Promise<boolean>;
      }
    ).upsertReadState('c1', 's1', { force: true });
    expect(prisma.chatReadState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          conversationId: 'c1',
          userId: 's1',
          lastReadAt: future,
          unreadGeneration: 0,
        },
        update: { lastReadAt: future },
      }),
    );
  });

  it('markConversationUnread ставит lastReadAt до последнего сообщения клиента и bump generation', async () => {
    const latest = new Date('2026-10-23T12:00:00.000Z');
    prisma.chatMessage.findFirst.mockResolvedValue({ createdAt: latest });
    prisma.chatReadState.findUnique.mockResolvedValue({ unreadGeneration: 2 });
    const out = await (
      svc as unknown as {
        markConversationUnread(
          c: string,
          u: string,
        ): Promise<{ ok: true; changed: boolean; unreadGeneration: number }>;
      }
    ).markConversationUnread('c1', 's1');
    expect(out).toEqual({ ok: true, changed: true, unreadGeneration: 3 });
    expect(prisma.chatReadState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          conversationId: 'c1',
          userId: 's1',
          lastReadAt: new Date(latest.getTime() - 1),
          unreadGeneration: 3,
        },
        update: {
          lastReadAt: new Date(latest.getTime() - 1),
          unreadGeneration: 3,
        },
      }),
    );
  });

  it('upsertReadState CAS: stale generation → applied false', async () => {
    prisma.chatMessage.findFirst.mockResolvedValue({ createdAt: new Date() });
    prisma.chatReadState.updateMany.mockResolvedValue({ count: 0 });
    prisma.chatReadState.findUnique.mockResolvedValue({ unreadGeneration: 5 });
    const applied = await (
      svc as unknown as {
        upsertReadState(
          c: string,
          u: string,
          o?: { expectedUnreadGeneration?: number },
        ): Promise<boolean>;
      }
    ).upsertReadState('c1', 's1', { expectedUnreadGeneration: 2 });
    expect(applied).toBe(false);
    expect(prisma.chatReadState.upsert).not.toHaveBeenCalled();
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

  describe('notifyAdminByEmail', () => {
    const priv = () => svc as unknown as NotifyPriv;

    it('ORDER: claim + sendAdminChatNotify с текстом', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        number: '000027',
        email: 'c@x.co',
        customerName: 'Иван',
        user: { displayName: 'Иван', email: 'c@x.co' },
      });

      await priv().notifyAdminByEmail(
        'c1',
        { kind: 'ORDER', orderId: 'o1', customerUserId: 'u1' },
        'Когда доставка?',
      );

      expect(prisma.chatConversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastCustomerInboundAdminEmailAt: expect.any(Date),
          }),
        }),
      );
      expect(mail.sendAdminChatNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'order',
          messageText: 'Когда доставка?',
          orderNumber: '000027',
          adminChatUrl: 'https://admin.test/admin/orders/o1#order-chat',
        }),
      );
    });

    it('SUPPORT: claim + sendAdminChatNotify', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'u@x.co',
        displayName: 'Анна',
      });

      await priv().notifyAdminByEmail(
        'c1',
        { kind: 'SUPPORT', customerUserId: 'u1' },
        'Нужна помощь',
      );

      expect(mail.sendAdminChatNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'support',
          messageText: 'Нужна помощь',
          customerUserId: 'u1',
        }),
      );
    });

    it('throttle: updateMany count=0 → без письма', async () => {
      prisma.chatConversation.updateMany.mockResolvedValue({ count: 0 });
      await priv().notifyAdminByEmail(
        'c1',
        { kind: 'SUPPORT', customerUserId: 'u1' },
        'x',
      );
      expect(mail.sendAdminChatNotify).not.toHaveBeenCalled();
    });

    it('SMTP fail → release claim (null)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'u@x.co',
        displayName: null,
      });
      mail.sendAdminChatNotify.mockRejectedValue(new Error('SMTP down'));

      await priv().notifyAdminByEmail(
        'c1',
        { kind: 'SUPPORT', customerUserId: 'u1' },
        'x',
      );

      expect(prisma.chatConversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { lastCustomerInboundAdminEmailAt: null },
        }),
      );
    });

    it('ORDER_ADMIN_NOTIFY_EMAIL пуст → без claim', async () => {
      mail.resolveAdminOrderNotifyEmail.mockReturnValue('');
      await priv().notifyAdminByEmail(
        'c1',
        { kind: 'SUPPORT', customerUserId: 'u1' },
        'x',
      );
      expect(prisma.chatConversation.updateMany).not.toHaveBeenCalled();
      expect(mail.sendAdminChatNotify).not.toHaveBeenCalled();
    });

    it('sendAdminChatNotify false → release claim', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'u@x.co',
        displayName: null,
      });
      mail.sendAdminChatNotify.mockResolvedValue(false);

      await priv().notifyAdminByEmail(
        'c1',
        { kind: 'SUPPORT', customerUserId: 'u1' },
        'x',
      );

      expect(prisma.chatConversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { lastCustomerInboundAdminEmailAt: null },
        }),
      );
    });
  });

  describe('notifyCustomerByEmail', () => {
    const priv = () => svc as unknown as NotifyPriv;

    it('ORDER: always-send (без online-skip) + шаблон reply', async () => {
      prisma.order.findUnique.mockResolvedValue({
        number: '000027',
        email: 'c@x.co',
        customerName: 'Иван',
        user: { displayName: 'Иван' },
      });

      await priv().notifyCustomerByEmail(
        'c1',
        { kind: 'ORDER', orderId: 'o1', customerUserId: 'u1' },
        'Ответ staff',
      );

      expect(mail.sendOrderChatReply).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'c@x.co',
          orderId: 'o1',
          orderNumber: '000027',
          snippet: 'Ответ staff',
        }),
      );
    });

    it('SUPPORT: sendOrderChatSupportReply', async () => {
      prisma.user.findUnique.mockResolvedValue({
        email: 'u@x.co',
        displayName: 'Анна',
      });

      await priv().notifyCustomerByEmail(
        'c1',
        { kind: 'SUPPORT', customerUserId: 'u1' },
        'Ответ',
      );

      expect(mail.sendOrderChatSupportReply).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'u@x.co', snippet: 'Ответ' }),
      );
    });

    it('throttle: count=0 → без письма клиенту', async () => {
      prisma.chatConversation.updateMany.mockResolvedValue({ count: 0 });
      await priv().notifyCustomerByEmail(
        'c1',
        { kind: 'ORDER', orderId: 'o1', customerUserId: 'u1' },
        'x',
      );
      expect(mail.sendOrderChatReply).not.toHaveBeenCalled();
    });

    it('SMTP fail → release lastStaffReplyEmailAt', async () => {
      prisma.order.findUnique.mockResolvedValue({
        number: '1',
        email: 'c@x.co',
        customerName: null,
        user: null,
      });
      mail.sendOrderChatReply.mockRejectedValue(new Error('SMTP down'));

      await priv().notifyCustomerByEmail(
        'c1',
        { kind: 'ORDER', orderId: 'o1', customerUserId: 'u1' },
        'x',
      );

      expect(prisma.chatConversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { lastStaffReplyEmailAt: null },
        }),
      );
    });

    it('нет email → release claim без send', async () => {
      prisma.order.findUnique.mockResolvedValue({
        number: '1',
        email: '  ',
        customerName: null,
        user: null,
      });

      await priv().notifyCustomerByEmail(
        'c1',
        { kind: 'ORDER', orderId: 'o1', customerUserId: 'u1' },
        'x',
      );

      expect(mail.sendOrderChatReply).not.toHaveBeenCalled();
      expect(prisma.chatConversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { lastStaffReplyEmailAt: null },
        }),
      );
    });

    it('skipped_disabled (send false) → release claim', async () => {
      prisma.order.findUnique.mockResolvedValue({
        number: '1',
        email: 'c@x.co',
        customerName: null,
        user: null,
      });
      mail.sendOrderChatReply.mockResolvedValue(false);

      await priv().notifyCustomerByEmail(
        'c1',
        { kind: 'ORDER', orderId: 'o1', customerUserId: 'u1' },
        'x',
      );

      expect(prisma.chatConversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { lastStaffReplyEmailAt: null },
        }),
      );
    });
  });
});
