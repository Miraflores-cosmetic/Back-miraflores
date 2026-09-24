import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { resolveOrderChatWsJwtSecret } from '../auth/jwt-secret';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import {
  ORDER_CHAT_SOCKET_NAMESPACE,
  ROOM_STAFF_ORDER_CHAT,
  roomOrderChat,
  roomSupportChat,
  roomUserChatSessions,
} from './order-chat.constants';
import { OrderChatService } from './order-chat.service';
import type { ChatCustomerPresenceContext, OrderChatMessageOut } from './order-chat.types';
import { UserRole } from '@prisma/client';
import { getOrderChatWebSocketCorsOptions } from './order-chat-ws-cors';
import { ORDER_CHAT_WS_JWT_AUD } from './order-chat-ws-token';

const ORDER_CHAT_WS_CORS = getOrderChatWebSocketCorsOptions();

@WebSocketGateway({
  namespace: ORDER_CHAT_SOCKET_NAMESPACE,
  cors: ORDER_CHAT_WS_CORS,
})
export class OrderChatGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(OrderChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly chat: OrderChatService,
    private readonly config: ConfigService,
  ) {}

  afterInit(): void {
    this.chat.registerGateway(this);
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const auth = client.handshake.auth as { token?: string } | undefined;
      const headerAuth = client.handshake.headers.authorization;
      const raw =
        auth?.token ??
        (typeof headerAuth === 'string' ? headerAuth.replace(/^Bearer\s+/i, '').trim() : '');
      if (!raw) throw new Error('no token');
      const payload = this.jwt.verify<JwtPayload>(raw, {
        secret: resolveOrderChatWsJwtSecret(this.config),
        audience: ORDER_CHAT_WS_JWT_AUD,
      });
      client.data.userId = payload.sub;
      client.data.role = payload.role;
      client.data.tv = payload.tv;

      const ws = await this.chat.assertWsConnectionAllowed(payload);
      if (ws.staffInbox) {
        await client.join(ROOM_STAFF_ORDER_CHAT);
      }
      await client.join(roomUserChatSessions(String(payload.sub)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`order-chat WS reject: ${msg}`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage('join_order_chat')
  async joinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { orderId?: string },
  ): Promise<{ ok: true }> {
    const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
    if (!orderId) throw new WsException('orderId required');
    await this.chat.verifyJoinRoom(
      client.data.userId,
      client.data.role,
      orderId,
      client.data.tv,
    );
    await client.join(roomOrderChat(orderId));
    return { ok: true };
  }

  @SubscribeMessage('leave_order_chat')
  async leaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { orderId?: string },
  ): Promise<{ ok: true }> {
    const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
    if (!orderId) return { ok: true };
    await client.leave(roomOrderChat(orderId));
    return { ok: true };
  }

  @SubscribeMessage('join_support_chat')
  async joinSupportRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { userId?: string },
  ): Promise<{ ok: true }> {
    const customerUserId =
      typeof body?.userId === 'string' && body.userId.trim()
        ? body.userId.trim()
        : String(client.data.userId ?? '').trim();
    if (!customerUserId) throw new WsException('userId required');
    await this.chat.verifyJoinSupportRoom(
      client.data.userId,
      client.data.role,
      customerUserId,
      client.data.tv,
    );
    await client.join(roomSupportChat(customerUserId));
    return { ok: true };
  }

  @SubscribeMessage('leave_support_chat')
  async leaveSupportRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { userId?: string },
  ): Promise<{ ok: true }> {
    const customerUserId =
      typeof body?.userId === 'string' && body.userId.trim()
        ? body.userId.trim()
        : String(client.data.userId ?? '').trim();
    if (!customerUserId) return { ok: true };
    await client.leave(roomSupportChat(customerUserId));
    return { ok: true };
  }

  broadcastOrderMessage(orderId: string, payload: OrderChatMessageOut): void {
    this.server.to(roomOrderChat(orderId)).emit('message_created', payload);
  }

  broadcastOrderMessageDeleted(orderId: string, payload: { id: string }): void {
    this.server.to(roomOrderChat(orderId)).emit('message_deleted', payload);
  }

  broadcastSupportMessage(customerUserId: string, payload: OrderChatMessageOut): void {
    this.server.to(roomSupportChat(customerUserId)).emit('message_created', payload);
  }

  broadcastSupportMessageDeleted(customerUserId: string, payload: { id: string }): void {
    this.server.to(roomSupportChat(customerUserId)).emit('message_deleted', payload);
  }

  broadcastStaffInboxUpdated(): void {
    this.server.to(ROOM_STAFF_ORDER_CHAT).emit('staff_inbox_updated', {});
  }

  /** После logout / tokenVersion++ — закрыть все order-chat WS пользователя. */
  async disconnectUserSockets(userId: string): Promise<void> {
    if (!this.server || !userId.trim()) return;
    const room = roomUserChatSessions(userId.trim());
    const sockets = await this.server.in(room).fetchSockets();
    for (const s of sockets) {
      s.disconnect(true);
    }
  }

  async isCustomerChatOnline(ctx: ChatCustomerPresenceContext): Promise<boolean> {
    if (!this.server) return false;
    const isBuyer = (role: unknown) => role === UserRole.USER || role === 'USER';

    if (ctx.kind === 'SUPPORT') {
      const sockets = await this.server.in(roomSupportChat(ctx.customerUserId)).fetchSockets();
      return sockets.some(
        (s) => isBuyer(s.data.role) && String(s.data.userId ?? '') === ctx.customerUserId,
      );
    }

    const sockets = await this.server.in(roomOrderChat(ctx.orderId)).fetchSockets();
    return sockets.some(
      (s) => isBuyer(s.data.role) && String(s.data.userId ?? '') === ctx.customerUserId,
    );
  }
}
