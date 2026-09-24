import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ChatAttachmentKind,
  ChatConversationKind,
  ChatMessageAuthorRole,
  OrderStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { chatMessageSnippet } from '../mail/email-notification-format';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  rlsCtxForJwtRole,
  scheduleAfterRlsCommit,
  scheduleAfterRlsCommitWithBypass,
} from '../rls/rls-after-commit';
import { LocalStorageService } from '../storage/local-storage.service';
import { StaffAccessService } from '../staff/staff-access.service';
import type { PostOrderChatMessageDto } from './dto/order-chat.dto';
import {
  CHAT_MESSAGES_PAGE_DEFAULT,
  CHAT_MESSAGES_PAGE_MAX,
  ORDER_CHAT_ATTACHMENT_REFS_PAYLOAD_MAX_CHARS,
  ORDER_CHAT_ATTACHMENTS_MAX,
  ORDER_CHAT_DELETE_WITHIN_MS,
  ORDER_CHAT_POST_BODY_MAX_CHARS,
  ORDER_CHAT_STAFF_REPLY_EMAIL_MIN_INTERVAL_MS,
  chatUploadKeyPrefixOrder,
  chatUploadKeyPrefixSupport,
} from './order-chat.constants';
import {
  extractChatStorageKeyFromRef,
  isChatStorageKey,
  resolveChatFileSigningSecret,
  signChatStorageKey,
} from './chat-file-url';
import type { ChatCustomerPresenceContext } from './order-chat.types';
import type {
  ChatThreadListItem,
  OrderChatMessageOut,
  OrderChatRealtimeEmitter,
} from './order-chat.types';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { issueOrderChatWsToken, type OrderChatWsTokenResponse } from './order-chat-ws-token';
import {
  batchLastMessagePreviews,
  batchUnreadCounts,
} from './order-chat-unread.util';

function decodeUploadOriginalName(original: string | undefined | null): string {
  const raw = (original ?? 'file').trim() || 'file';
  if (!/[ÐÑÂâ€]/.test(raw)) return raw.slice(0, 512);
  try {
    const fixed = Buffer.from(raw, 'latin1').toString('utf8');
    if (fixed && !fixed.includes('\ufffd')) return fixed.slice(0, 512);
  } catch {
    /* ignore */
  }
  return raw.slice(0, 512);
}

const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
];

type ChatCustomerEmailContext = ChatCustomerPresenceContext;

@Injectable()
export class OrderChatService {
  private readonly logger = new Logger(OrderChatService.name);
  private gateway: OrderChatRealtimeEmitter | null = null;
  private readonly chatFileSignSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    private readonly config: ConfigService,
    private readonly staffAccess: StaffAccessService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
  ) {
    this.chatFileSignSecret = resolveChatFileSigningSecret(config);
  }

  private signStoredChatFileUrl(storedUrl: string): string {
    const key =
      extractChatStorageKeyFromRef(storedUrl, this.storage.publicBase()) ??
      this.storage.tryPublicUrlToKey(storedUrl);
    if (!key || !isChatStorageKey(key)) return storedUrl;
    return signChatStorageKey(
      this.chatFileSignSecret,
      this.storage.publicBase(),
      key,
    );
  }

  createWsToken(user: JwtPayload): OrderChatWsTokenResponse {
    return issueOrderChatWsToken(this.jwt, this.config, user);
  }

  registerGateway(g: OrderChatRealtimeEmitter): void {
    this.gateway = g;
  }

  retentionDays(): number {
    const raw = this.config.get<string>('ORDER_CHAT_RETENTION_DAYS');
    const n = raw != null && raw !== '' ? Number(raw) : 90;
    return Number.isFinite(n) && n > 0 ? n : 90;
  }

  private authorRoleFromJwt(role: string): ChatMessageAuthorRole {
    return role === UserRole.ADMIN || role === UserRole.MODERATOR
      ? ChatMessageAuthorRole.STAFF
      : ChatMessageAuthorRole.CUSTOMER;
  }

  private chatAuthorSelect() {
    return {
      email: true,
      displayName: true,
      staffDisplayName: true,
      staffAvatarUrl: true,
    } as const;
  }

  private labelAuthor(
    role: ChatMessageAuthorRole,
    author: {
      displayName: string | null;
      email: string;
      staffDisplayName: string | null;
    },
  ): string {
    if (role === ChatMessageAuthorRole.STAFF) {
      return author.staffDisplayName?.trim() || 'Miraflores';
    }
    return author.displayName?.trim() || author.email?.trim() || 'Покупатель';
  }

  private mapMessage(m: {
    id: string;
    conversationId: string;
    authorUserId: string | null;
    authorRole: ChatMessageAuthorRole;
    authorLabelSnapshot: string;
    body: string;
    deletedAt: Date | null;
    createdAt: Date;
    attachments: {
      id: string;
      fileUrl: string;
      filename: string;
      mimeType: string | null;
      kind: ChatAttachmentKind;
    }[];
    author: {
      email: string;
      displayName: string | null;
      staffDisplayName: string | null;
      staffAvatarUrl: string | null;
    } | null;
  }): OrderChatMessageOut {
    const deleted = !!m.deletedAt;
    const authorFallback = {
      email: '',
      displayName: null as string | null,
      staffDisplayName: null as string | null,
    };
    const author = m.author ?? authorFallback;
    const labelFromSnapshot = m.authorLabelSnapshot?.trim();
    const rawAvatar =
      m.authorRole === ChatMessageAuthorRole.STAFF
        ? m.author?.staffAvatarUrl?.trim()
        : null;
    return {
      id: m.id,
      conversationId: m.conversationId,
      authorUserId: m.authorUserId,
      authorRole: m.authorRole,
      authorLabel:
        labelFromSnapshot || this.labelAuthor(m.authorRole, author),
      authorAvatarUrl: rawAvatar && rawAvatar.length > 0 ? rawAvatar : null,
      body: deleted ? '' : m.body,
      deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
      attachments: deleted
        ? []
        : m.attachments.map((a) => ({
            id: a.id,
            fileUrl: this.signStoredChatFileUrl(a.fileUrl),
            filename: a.filename,
            mimeType: a.mimeType,
            kind: a.kind,
          })),
    };
  }

  private normalizeMessagesPageLimit(limitRaw?: number): number {
    if (limitRaw != null && Number.isFinite(limitRaw)) {
      const n = Math.floor(limitRaw);
      return Math.min(CHAT_MESSAGES_PAGE_MAX, Math.max(1, n));
    }
    return CHAT_MESSAGES_PAGE_DEFAULT;
  }

  private assertConversationNotExpired(retentionPurgesAt: Date | null): void {
    if (retentionPurgesAt && retentionPurgesAt <= new Date()) {
      throw new ForbiddenException('Срок хранения переписки истёк');
    }
  }

  async assertCustomerCanAccessOrder(orderId: string, userId: string): Promise<void> {
    const o = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true },
    });
    if (!o) throw new ForbiddenException('Нет доступа к заказу');
  }

  private async assertStaffOrdersSection(
    userId: string,
    role: string,
    tokenVersion?: number,
  ): Promise<void> {
    const ctx = await this.staffAccess.getStaffContext(
      userId,
      role as UserRole,
      tokenVersion,
    );
    if (!ctx) throw new ForbiddenException('Нет доступа');
    if (ctx.isSuperAdmin) return;
    if (!ctx.sections.includes('orders')) {
      throw new ForbiddenException('Нет доступа к заказам');
    }
  }

  async assertStaffCanAccessOrder(
    orderId: string,
    userId: string,
    role: string,
    tokenVersion?: number,
  ): Promise<void> {
    await this.assertStaffOrdersSection(userId, role, tokenVersion);
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true },
    });
    if (!o) throw new NotFoundException('Заказ не найден');
  }

  async assertStaffCanAccessSupport(
    userId: string,
    role: string,
    tokenVersion?: number,
  ): Promise<void> {
    await this.assertStaffOrdersSection(userId, role, tokenVersion);
  }

  async assertActiveWsToken(userId: string, tokenVersion?: number): Promise<void> {
    const user = await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, () =>
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { tokenVersion: true, isActive: true, staffDeletedAt: true },
      }),
    );
    if (!user?.isActive || user.staffDeletedAt) {
      throw new ForbiddenException('Учётная запись недоступна');
    }
    if ((tokenVersion ?? 0) !== user.tokenVersion) {
      throw new ForbiddenException('Сессия истекла, войдите снова');
    }
  }

  async assertWsConnectionAllowed(
    payload: JwtPayload,
  ): Promise<{ staffInbox: boolean }> {
    await this.assertActiveWsToken(payload.sub, payload.tv);
    if (payload.role === UserRole.ADMIN || payload.role === UserRole.MODERATOR) {
      const ctx = await this.staffAccess.getStaffContext(
        payload.sub,
        payload.role as UserRole,
        payload.tv,
      );
      if (!ctx) throw new ForbiddenException('Нет доступа');
      if (!ctx.isSuperAdmin && !ctx.sections.includes('orders')) {
        throw new ForbiddenException('Нет доступа к заказам');
      }
      return { staffInbox: true };
    }
    if (payload.role !== UserRole.USER) {
      throw new ForbiddenException('Нет доступа');
    }
    return { staffInbox: false };
  }

  async verifyJoinRoom(
    userId: string,
    role: string,
    orderId: string,
    tokenVersion?: number,
  ): Promise<void> {
    await this.assertActiveWsToken(userId, tokenVersion);
    await this.prisma.runInRlsTransaction(rlsCtxForJwtRole(userId, role), async () => {
      const ar = this.authorRoleFromJwt(role);
      if (ar === ChatMessageAuthorRole.STAFF) {
        await this.assertStaffCanAccessOrder(orderId, userId, role, tokenVersion);
        return;
      }
      await this.assertCustomerCanAccessOrder(orderId, userId);
    });
  }

  async verifyJoinSupportRoom(
    jwtUserId: string,
    role: string,
    customerUserId: string,
    tokenVersion?: number,
  ): Promise<void> {
    await this.assertActiveWsToken(jwtUserId, tokenVersion);
    await this.prisma.runInRlsTransaction(rlsCtxForJwtRole(jwtUserId, role), async () => {
      const ar = this.authorRoleFromJwt(role);
      if (ar === ChatMessageAuthorRole.STAFF) {
        await this.assertStaffCanAccessSupport(jwtUserId, role, tokenVersion);
        return;
      }
      if (jwtUserId !== customerUserId) {
        throw new ForbiddenException('Нет доступа к диалогу');
      }
    });
  }

  private assertAttachmentRefsPayloadLimits(
    att: NonNullable<PostOrderChatMessageDto['attachments']>,
  ): void {
    if (att.length > ORDER_CHAT_ATTACHMENTS_MAX) {
      throw new BadRequestException(
        `Не более ${ORDER_CHAT_ATTACHMENTS_MAX} вложений в одном сообщении`,
      );
    }
    let sum = 0;
    for (const a of att) {
      sum += a.fileUrl.length;
    }
    if (sum > ORDER_CHAT_ATTACHMENT_REFS_PAYLOAD_MAX_CHARS) {
      throw new BadRequestException('Слишком большой объём ссылок на вложения');
    }
  }

  private async resolveAttachmentRefsFromStorage(
    uploadPrefix: string,
    att: NonNullable<PostOrderChatMessageDto['attachments']>,
  ): Promise<
    Array<{
      fileUrl: string;
      filename: string;
      mimeType: string;
      kind: ChatAttachmentKind;
    }>
  > {
    const folder = uploadPrefix.replace(/\/$/, '');
    return Promise.all(
      att.map((a) => this.storage.resolveChatAttachmentFromUrl(a.fileUrl, folder)),
    );
  }

  private async listMessagesForConversation(
    conversationId: string,
    retentionPurgesAt: Date | null,
    opts?: {
      limit?: number;
      beforeMessageId?: string | null;
      afterMessageId?: string | null;
    },
  ): Promise<{ conversationId: string; messages: OrderChatMessageOut[]; hasOlder: boolean }> {
    this.assertConversationNotExpired(retentionPurgesAt);
    const limit = this.normalizeMessagesPageLimit(opts?.limit);
    const includePayload = {
      attachments: true,
      author: { select: this.chatAuthorSelect() },
    } as const;

    const afterId = opts?.afterMessageId?.trim();
    if (afterId) {
      const anchor = await this.prisma.chatMessage.findFirst({
        where: { id: afterId, conversationId },
        select: { id: true, createdAt: true },
      });
      if (!anchor) throw new BadRequestException('Неизвестная граница истории сообщений');
      const rowsAsc = await this.prisma.chatMessage.findMany({
        where: {
          conversationId,
          OR: [
            { createdAt: { gt: anchor.createdAt } },
            {
              AND: [{ createdAt: anchor.createdAt }, { id: { gt: anchor.id } }],
            },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
        include: includePayload,
      });
      return {
        conversationId,
        messages: rowsAsc.map((r) => this.mapMessage(r)),
        hasOlder: false,
      };
    }

    let messageWhere: Prisma.ChatMessageWhereInput = { conversationId };
    const beforeId = opts?.beforeMessageId?.trim();
    if (beforeId) {
      const anchor = await this.prisma.chatMessage.findFirst({
        where: { id: beforeId, conversationId },
        select: { id: true, createdAt: true },
      });
      if (!anchor) throw new BadRequestException('Неизвестная граница истории сообщений');
      messageWhere = {
        conversationId,
        OR: [
          { createdAt: { lt: anchor.createdAt } },
          {
            AND: [{ createdAt: anchor.createdAt }, { id: { lt: anchor.id } }],
          },
        ],
      };
    }

    const rowsDesc = await this.prisma.chatMessage.findMany({
      where: messageWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: includePayload,
    });
    const hasOlder = rowsDesc.length > limit;
    const chronological = rowsDesc.slice(0, limit).reverse();
    return {
      conversationId,
      messages: chronological.map((r) => this.mapMessage(r)),
      hasOlder,
    };
  }

  async listOrderMessages(
    orderId: string,
    opts?: {
      limit?: number;
      beforeMessageId?: string | null;
      afterMessageId?: string | null;
    },
  ): Promise<{ conversationId: string | null; messages: OrderChatMessageOut[]; hasOlder: boolean }> {
    const conv = await this.prisma.chatConversation.findUnique({
      where: { orderId },
      select: { id: true, retentionPurgesAt: true },
    });
    if (!conv) {
      return { conversationId: null, messages: [], hasOlder: false };
    }
    if (conv.retentionPurgesAt && conv.retentionPurgesAt <= new Date()) {
      return { conversationId: conv.id, messages: [], hasOlder: false };
    }
    const page = await this.listMessagesForConversation(
      conv.id,
      conv.retentionPurgesAt,
      opts,
    );
    return { conversationId: conv.id, messages: page.messages, hasOlder: page.hasOlder };
  }

  async listSupportMessages(
    customerUserId: string,
    opts?: {
      limit?: number;
      beforeMessageId?: string | null;
      afterMessageId?: string | null;
    },
  ): Promise<{ conversationId: string | null; messages: OrderChatMessageOut[]; hasOlder: boolean }> {
    const conv = await this.prisma.chatConversation.findUnique({
      where: { userId: customerUserId },
      select: { id: true, retentionPurgesAt: true, kind: true },
    });
    if (!conv || conv.kind !== ChatConversationKind.SUPPORT) {
      return { conversationId: null, messages: [], hasOlder: false };
    }
    const page = await this.listMessagesForConversation(
      conv.id,
      conv.retentionPurgesAt,
      opts,
    );
    return { conversationId: conv.id, messages: page.messages, hasOlder: page.hasOlder };
  }

  private async createMessage(
    conversationId: string,
    jwtUserId: string,
    authorRole: ChatMessageAuthorRole,
    dto: PostOrderChatMessageDto,
    uploadPrefix: string,
    emit: (out: OrderChatMessageOut) => void,
    emailContext?: ChatCustomerEmailContext,
  ): Promise<OrderChatMessageOut> {
    const body = dto.body?.trim() ?? '';
    const att = dto.attachments ?? [];
    const clientMessageId = dto.clientMessageId?.trim() || null;
    if (!body && att.length === 0) {
      throw new BadRequestException('Пустое сообщение');
    }
    if (body.length > ORDER_CHAT_POST_BODY_MAX_CHARS) {
      throw new BadRequestException('Слишком длинное сообщение');
    }
    if (clientMessageId) {
      const existing = await this.prisma.chatMessage.findFirst({
        where: { conversationId, clientMessageId },
        include: {
          attachments: true,
          author: { select: this.chatAuthorSelect() },
        },
      });
      if (existing) return this.mapMessage(existing);
    }
    let resolvedAttachments: Array<{
      fileUrl: string;
      filename: string;
      mimeType: string;
      kind: ChatAttachmentKind;
    }> = [];
    if (att.length > 0) {
      this.assertAttachmentRefsPayloadLimits(att);
      resolvedAttachments = await this.resolveAttachmentRefsFromStorage(uploadPrefix, att);
    }

    const authorRow = await this.prisma.user.findUnique({
      where: { id: jwtUserId },
      select: this.chatAuthorSelect(),
    });
    if (!authorRow) throw new ForbiddenException('Пользователь не найден');
    const authorLabelSnapshot = this.labelAuthor(authorRole, authorRow);

    let row;
    try {
      row = await this.prisma.chatMessage.create({
      data: {
        conversationId,
        authorUserId: jwtUserId,
        authorRole,
        authorLabelSnapshot,
        body,
        clientMessageId,
        attachments: {
          create: resolvedAttachments.map((a) => ({
            fileUrl: a.fileUrl,
            filename: a.filename,
            mimeType: a.mimeType,
            kind: a.kind,
          })),
        },
      },
      include: {
        attachments: true,
        author: { select: this.chatAuthorSelect() },
      },
    });
    } catch (e) {
      if (
        clientMessageId &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const existing = await this.prisma.chatMessage.findFirst({
          where: { conversationId, clientMessageId },
          include: {
            attachments: true,
            author: { select: this.chatAuthorSelect() },
          },
        });
        if (existing) return this.mapMessage(existing);
      }
      throw e;
    }

    await this.prisma.chatConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    const out = this.mapMessage(row);
    scheduleAfterRlsCommit(() => {
      emit(out);
      this.gateway?.broadcastStaffInboxUpdated();
    });
    if (authorRole === ChatMessageAuthorRole.STAFF && emailContext) {
      const snippet = chatMessageSnippet(body, att.length);
      scheduleAfterRlsCommitWithBypass(this.prisma, () =>
        this.notifyCustomerByEmail(conversationId, emailContext, snippet),
      );
    }
    return out;
  }

  /** Письмо покупателю при ответе staff; уведомления staff по сообщениям клиента — отключены. */
  private async notifyCustomerByEmail(
    conversationId: string,
    ctx: ChatCustomerEmailContext,
    snippet: string,
  ): Promise<void> {
    if (this.gateway && (await this.gateway.isCustomerChatOnline(ctx))) {
      return;
    }
    const conv = await this.prisma.chatConversation.findUnique({
      where: { id: conversationId },
      select: { lastStaffReplyEmailAt: true },
    });
    const last = conv?.lastStaffReplyEmailAt;
    if (
      last &&
      Date.now() - last.getTime() < ORDER_CHAT_STAFF_REPLY_EMAIL_MIN_INTERVAL_MS
    ) {
      return;
    }

    if (ctx.kind === 'ORDER') {
      const order = await this.prisma.order.findUnique({
        where: { id: ctx.orderId },
        select: {
          number: true,
          email: true,
          customerName: true,
          user: { select: { displayName: true } },
        },
      });
      if (!order) return;
      const to = order.email?.trim();
      if (!to) return;
      const greeting = order.user?.displayName?.trim() || order.customerName?.trim() || null;
      await this.mail.sendOrderChatReply({
        to,
        orderId: ctx.orderId,
        orderNumber: order.number,
        snippet,
        customerGreeting: greeting,
      });
      await this.prisma.chatConversation.update({
        where: { id: conversationId },
        data: { lastStaffReplyEmailAt: new Date() },
      });
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: ctx.customerUserId },
      select: { email: true, displayName: true },
    });
    if (!user) return;
    const to = user.email?.trim();
    if (!to) return;
    await this.mail.sendOrderChatSupportReply({
      to,
      snippet,
      customerGreeting: user.displayName?.trim() || null,
    });
    await this.prisma.chatConversation.update({
      where: { id: conversationId },
      data: { lastStaffReplyEmailAt: new Date() },
    });
  }

  async postOrderMessage(
    orderId: string,
    jwtUserId: string,
    jwtRole: string,
    dto: PostOrderChatMessageDto,
  ): Promise<OrderChatMessageOut> {
    const authorRole = this.authorRoleFromJwt(jwtRole);
    if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
      await this.assertCustomerCanAccessOrder(orderId, jwtUserId);
    } else {
      await this.assertStaffCanAccessOrder(orderId, jwtUserId, jwtRole);
    }

    const conv = await this.prisma.chatConversation.upsert({
      where: { orderId },
      create: { kind: ChatConversationKind.ORDER, orderId },
      update: {},
      select: { id: true, retentionPurgesAt: true },
    });
    this.assertConversationNotExpired(conv.retentionPurgesAt);
    await this.syncOrderConversationRetention(orderId);

    const orderOwner = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true },
    });
    const customerUserId = orderOwner?.userId?.trim() || jwtUserId;

    return this.createMessage(
      conv.id,
      jwtUserId,
      authorRole,
      dto,
      chatUploadKeyPrefixOrder(orderId),
      (out) => this.gateway?.broadcastOrderMessage(orderId, out),
      { kind: 'ORDER', orderId, customerUserId },
    );
  }

  async postSupportMessage(
    customerUserId: string,
    jwtUserId: string,
    jwtRole: string,
    dto: PostOrderChatMessageDto,
  ): Promise<OrderChatMessageOut> {
    const authorRole = this.authorRoleFromJwt(jwtRole);
    if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
      if (jwtUserId !== customerUserId) {
        throw new ForbiddenException('Нет доступа к диалогу');
      }
    } else {
      await this.assertStaffCanAccessSupport(jwtUserId, jwtRole);
    }

    const conv = await this.prisma.chatConversation.upsert({
      where: { userId: customerUserId },
      create: { kind: ChatConversationKind.SUPPORT, userId: customerUserId },
      update: {},
      select: { id: true, retentionPurgesAt: true },
    });
    this.assertConversationNotExpired(conv.retentionPurgesAt);

    return this.createMessage(
      conv.id,
      jwtUserId,
      authorRole,
      dto,
      chatUploadKeyPrefixSupport(customerUserId),
      (out) => this.gateway?.broadcastSupportMessage(customerUserId, out),
      { kind: 'SUPPORT', customerUserId },
    );
  }

  async deleteOrderMessage(
    orderId: string,
    messageId: string,
    jwtUserId: string,
    jwtRole: string,
  ): Promise<void> {
    await this.deleteInOrderContext(orderId, messageId, jwtUserId, jwtRole, () =>
      this.gateway?.broadcastOrderMessageDeleted(orderId, { id: messageId }),
    );
  }

  async deleteSupportMessage(
    customerUserId: string,
    messageId: string,
    jwtUserId: string,
    jwtRole: string,
  ): Promise<void> {
    const authorRole = this.authorRoleFromJwt(jwtRole);
    if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
      if (jwtUserId !== customerUserId) throw new ForbiddenException();
    } else {
      await this.assertStaffCanAccessSupport(jwtUserId, jwtRole);
    }
    const conv = await this.prisma.chatConversation.findUnique({
      where: { userId: customerUserId },
      select: { id: true },
    });
    if (!conv) throw new NotFoundException();
    await this.deleteMessageInConversation(conv.id, messageId, jwtUserId, authorRole);
    scheduleAfterRlsCommit(() =>
      this.gateway?.broadcastSupportMessageDeleted(customerUserId, { id: messageId }),
    );
  }

  private async deleteInOrderContext(
    orderId: string,
    messageId: string,
    jwtUserId: string,
    jwtRole: string,
    onDeleted: () => void,
  ): Promise<void> {
    const authorRole = this.authorRoleFromJwt(jwtRole);
    if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
      await this.assertCustomerCanAccessOrder(orderId, jwtUserId);
    } else {
      await this.assertStaffCanAccessOrder(orderId, jwtUserId, jwtRole);
    }
    const conv = await this.prisma.chatConversation.findUnique({
      where: { orderId },
      select: { id: true, retentionPurgesAt: true },
    });
    if (!conv) throw new NotFoundException();
    this.assertConversationNotExpired(conv.retentionPurgesAt);
    await this.deleteMessageInConversation(conv.id, messageId, jwtUserId, authorRole);
    scheduleAfterRlsCommit(onDeleted);
  }

  private async deleteMessageInConversation(
    conversationId: string,
    messageId: string,
    jwtUserId: string,
    authorRole: ChatMessageAuthorRole,
  ): Promise<void> {
    const msg = await this.prisma.chatMessage.findFirst({
      where: { id: messageId, conversationId, deletedAt: null },
      select: { id: true, authorUserId: true, authorRole: true, createdAt: true },
    });
    if (!msg) throw new NotFoundException();
    const expiresAtMs = msg.createdAt.getTime() + ORDER_CHAT_DELETE_WITHIN_MS;
    if (Date.now() > expiresAtMs) {
      throw new ForbiddenException(
        'Удалить сообщение можно только в течение 24 часов после отправки',
      );
    }
    const isStaff = authorRole === ChatMessageAuthorRole.STAFF;
    if (!isStaff) {
      if (
        msg.authorRole !== ChatMessageAuthorRole.CUSTOMER ||
        msg.authorUserId !== jwtUserId
      ) {
        throw new ForbiddenException('Можно удалить только своё сообщение');
      }
    }
    const attachments = await this.prisma.chatAttachment.findMany({
      where: { messageId: msg.id },
      select: { fileUrl: true },
    });
    await this.prisma.chatMessage.update({
      where: { id: msg.id },
      data: { deletedAt: new Date(), body: '' },
    });
    for (const a of attachments) {
      await this.storage.deleteByPublicUrl(a.fileUrl);
    }
  }

  async markOrderRead(orderId: string, jwtUserId: string, jwtRole: string): Promise<void> {
    const authorRole = this.authorRoleFromJwt(jwtRole);
    if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
      await this.assertCustomerCanAccessOrder(orderId, jwtUserId);
    } else {
      await this.assertStaffCanAccessOrder(orderId, jwtUserId, jwtRole);
    }
    const conv = await this.prisma.chatConversation.findUnique({
      where: { orderId },
      select: { id: true },
    });
    if (!conv) return;
    await this.upsertReadState(conv.id, jwtUserId);
  }

  async markSupportRead(
    customerUserId: string,
    jwtUserId: string,
    jwtRole: string,
  ): Promise<void> {
    const authorRole = this.authorRoleFromJwt(jwtRole);
    if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
      if (jwtUserId !== customerUserId) throw new ForbiddenException();
    } else {
      await this.assertStaffCanAccessSupport(jwtUserId, jwtRole);
    }
    const conv = await this.prisma.chatConversation.findUnique({
      where: { userId: customerUserId },
      select: { id: true },
    });
    if (!conv) return;
    await this.upsertReadState(conv.id, jwtUserId);
  }

  private async upsertReadState(conversationId: string, userId: string): Promise<void> {
    const now = new Date();
    await this.prisma.chatReadState.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, lastReadAt: now },
      update: { lastReadAt: now },
    });
  }

  async uploadOrderAttachment(
    orderId: string,
    jwtUserId: string,
    jwtRole: string,
    file: Express.Multer.File,
  ): Promise<{ url: string; filename: string; mimeType: string; kind: ChatAttachmentKind }> {
    const authorRole = this.authorRoleFromJwt(jwtRole);
    await this.prisma.runInRlsTransaction(rlsCtxForJwtRole(jwtUserId, jwtRole), async () => {
      if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
        await this.assertCustomerCanAccessOrder(orderId, jwtUserId);
      } else {
        await this.assertStaffCanAccessOrder(orderId, jwtUserId, jwtRole);
      }
    });
    const safeName = decodeUploadOriginalName(file.originalname);
    const { url, mime } = await this.storage.saveChatFile(
      { buffer: file.buffer, size: file.size },
      chatUploadKeyPrefixOrder(orderId).replace(/\/$/, ''),
      { originalFilename: safeName },
    );
    const kind =
      mime.startsWith('image/') && mime !== 'image/tiff'
        ? ChatAttachmentKind.IMAGE
        : ChatAttachmentKind.FILE;
    return {
      url: this.signStoredChatFileUrl(url),
      filename: safeName.slice(0, 512),
      mimeType: mime,
      kind,
    };
  }

  /** Снять загруженный, но не отправленный файл (нет строки ChatAttachment). */
  async revokePendingChatUpload(fileRef: string, uploadPrefix: string): Promise<void> {
    const prefix = uploadPrefix.replace(/\/$/, '');
    const resolved = await this.storage.resolveChatAttachmentFromUrl(fileRef, `${prefix}/`);
    const attached = await this.prisma.chatAttachment.count({
      where: { fileUrl: resolved.fileUrl },
    });
    if (attached > 0) {
      throw new BadRequestException('Файл уже прикреплён к сообщению');
    }
    await this.storage.deleteByPublicUrl(resolved.fileUrl);
  }

  /** Сироты на диске (upload без сообщения), старше minAgeMs. */
  async purgeOrphanChatUploadFiles(minAgeMs: number): Promise<number> {
    return this.storage.purgeUnreferencedChatFiles(minAgeMs, async (publicUrl) => {
      const n = await this.prisma.chatAttachment.count({ where: { fileUrl: publicUrl } });
      return n === 0;
    });
  }

  async uploadSupportAttachment(
    customerUserId: string,
    jwtUserId: string,
    jwtRole: string,
    file: Express.Multer.File,
  ): Promise<{ url: string; filename: string; mimeType: string; kind: ChatAttachmentKind }> {
    const authorRole = this.authorRoleFromJwt(jwtRole);
    await this.prisma.runInRlsTransaction(rlsCtxForJwtRole(jwtUserId, jwtRole), async () => {
      if (authorRole === ChatMessageAuthorRole.CUSTOMER) {
        if (jwtUserId !== customerUserId) throw new ForbiddenException();
      } else {
        await this.assertStaffCanAccessSupport(jwtUserId, jwtRole);
      }
    });
    const safeName = decodeUploadOriginalName(file.originalname);
    const { url, mime } = await this.storage.saveChatFile(
      { buffer: file.buffer, size: file.size },
      chatUploadKeyPrefixSupport(customerUserId).replace(/\/$/, ''),
      { originalFilename: safeName },
    );
    const kind =
      mime.startsWith('image/') && mime !== 'image/tiff'
        ? ChatAttachmentKind.IMAGE
        : ChatAttachmentKind.FILE;
    return {
      url: this.signStoredChatFileUrl(url),
      filename: safeName.slice(0, 512),
      mimeType: mime,
      kind,
    };
  }

  async unreadCountForCustomer(userId: string): Promise<number> {
    const convs = await this.prisma.chatConversation.findMany({
      where: {
        OR: [
          { userId, kind: ChatConversationKind.SUPPORT },
          { order: { userId }, kind: ChatConversationKind.ORDER },
        ],
        AND: [
          {
            OR: [{ retentionPurgesAt: null }, { retentionPurgesAt: { gt: new Date() } }],
          },
        ],
      },
      select: { id: true },
    });
    const counts = await batchUnreadCounts(
      this.prisma,
      convs.map((c) => c.id),
      userId,
      ChatMessageAuthorRole.STAFF,
    );
    let total = 0;
    for (const n of counts.values()) total += n;
    return total;
  }

  /** Непрочитанные сообщения клиента по заказам (для списка заказов в админке). */
  async unreadOrderChatCountsForStaff(
    staffUserId: string,
    orderIds: string[],
  ): Promise<Record<string, number>> {
    const ids = [...new Set(orderIds.map((id) => id.trim()).filter(Boolean))];
    const out: Record<string, number> = {};
    if (!ids.length) return out;

    const convs = await this.prisma.chatConversation.findMany({
      where: {
        orderId: { in: ids },
        kind: ChatConversationKind.ORDER,
        OR: [{ retentionPurgesAt: null }, { retentionPurgesAt: { gt: new Date() } }],
      },
      select: { id: true, orderId: true },
    });

    const counts = await batchUnreadCounts(
      this.prisma,
      convs.map((c) => c.id),
      staffUserId,
      ChatMessageAuthorRole.CUSTOMER,
    );
    for (const c of convs) {
      if (!c.orderId) continue;
      out[c.orderId] = counts.get(c.id) ?? 0;
    }
    return out;
  }

  async unreadCountForStaff(staffUserId: string): Promise<number> {
    const convs = await this.prisma.chatConversation.findMany({
      where: {
        OR: [{ retentionPurgesAt: null }, { retentionPurgesAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    const counts = await batchUnreadCounts(
      this.prisma,
      convs.map((c) => c.id),
      staffUserId,
      ChatMessageAuthorRole.CUSTOMER,
    );
    let total = 0;
    for (const n of counts.values()) total += n;
    return total;
  }

  async listThreadsForCustomer(userId: string): Promise<{ threads: ChatThreadListItem[] }> {
    const supportConv = await this.prisma.chatConversation.findUnique({
      where: { userId },
      select: { id: true, retentionPurgesAt: true },
    });

    const orders = await this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        number: true,
        chatConversation: {
          select: { id: true, retentionPurgesAt: true },
        },
      },
    });

    const convIds: string[] = [];
    if (supportConv?.id) convIds.push(supportConv.id);
    for (const o of orders) {
      const conv = o.chatConversation;
      if (!conv?.id) continue;
      if (conv.retentionPurgesAt && conv.retentionPurgesAt <= new Date()) continue;
      convIds.push(conv.id);
    }

    const unreadMap = await batchUnreadCounts(
      this.prisma,
      convIds,
      userId,
      ChatMessageAuthorRole.STAFF,
    );
    const previewMap = await batchLastMessagePreviews(this.prisma, convIds);

    const supportLast = supportConv?.id
      ? previewMap.get(supportConv.id) ?? { preview: null, at: null }
      : { preview: null, at: null };

    const threads: ChatThreadListItem[] = [
      {
        kind: 'SUPPORT',
        conversationId: supportConv?.id ?? null,
        title: 'Поддержка',
        unreadCount: supportConv?.id ? unreadMap.get(supportConv.id) ?? 0 : 0,
        lastMessagePreview: supportLast.preview,
        lastMessageAt: supportLast.at?.toISOString() ?? null,
      },
    ];

    for (const o of orders) {
      const conv = o.chatConversation;
      if (conv?.retentionPurgesAt && conv.retentionPurgesAt <= new Date()) continue;
      const last = conv?.id
        ? previewMap.get(conv.id) ?? { preview: null, at: null }
        : { preview: null, at: null };
      threads.push({
        kind: 'ORDER',
        conversationId: conv?.id ?? null,
        orderId: o.id,
        orderNumber: o.number,
        title: `Заказ ${o.number}`,
        unreadCount: conv?.id ? unreadMap.get(conv.id) ?? 0 : 0,
        lastMessagePreview: last.preview,
        lastMessageAt: last.at?.toISOString() ?? null,
      });
    }

    return { threads };
  }

  async listSupportThreadsForAdmin(
    staffUserId: string,
    limitRaw = 50,
  ): Promise<{
    threads: Array<{
      userId: string;
      userEmail: string;
      userDisplayName: string | null;
      conversationId: string;
      unreadCount: number;
      lastMessagePreview: string | null;
      lastMessageAt: string | null;
    }>;
  }> {
    const limit = Math.min(100, Math.max(1, Math.floor(limitRaw)));
    const convs = await this.prisma.chatConversation.findMany({
      where: { kind: ChatConversationKind.SUPPORT },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        userId: true,
        user: { select: { email: true, displayName: true } },
      },
    });
    const convIds = convs.map((c) => c.id);
    const unreadMap = await batchUnreadCounts(
      this.prisma,
      convIds,
      staffUserId,
      ChatMessageAuthorRole.CUSTOMER,
    );
    const previewMap = await batchLastMessagePreviews(this.prisma, convIds);

    const threads = convs
      .map((c) => {
        if (!c.userId || !c.user) return null;
        const last = previewMap.get(c.id) ?? { preview: null, at: null };
        return {
          userId: c.userId,
          userEmail: c.user.email,
          userDisplayName: c.user.displayName,
          conversationId: c.id,
          unreadCount: unreadMap.get(c.id) ?? 0,
          lastMessagePreview: last.preview,
          lastMessageAt: last.at?.toISOString() ?? null,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t != null);
    return { threads };
  }

  private async syncOrderConversationRetention(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (order && TERMINAL_ORDER_STATUSES.includes(order.status)) {
      await this.applyRetentionForOrder(orderId, order.status);
    }
  }

  /** Удаляет беседы с истёкшим retentionPurgesAt (вызывается worker). */
  async purgeExpiredConversations(now = new Date()): Promise<number> {
    const due = await this.prisma.chatConversation.findMany({
      where: { retentionPurgesAt: { lte: now } },
      select: {
        id: true,
        messages: { select: { attachments: { select: { fileUrl: true } } } },
      },
      take: 25,
    });
    for (const conv of due) {
      for (const msg of conv.messages) {
        for (const att of msg.attachments) {
          await this.storage.deleteByPublicUrl(att.fileUrl);
        }
      }
      await this.prisma.chatConversation.delete({ where: { id: conv.id } });
    }
    return due.length;
  }

  /** Комментарий покупателя при оформлении → первое сообщение в чате заказа. */
  async seedCustomerNoteFromOrder(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true, customerNote: true },
    });
    if (!order?.userId) return;
    const note = order.customerNote?.trim();
    if (!note) return;

    const conv = await this.prisma.chatConversation.upsert({
      where: { orderId },
      create: { kind: ChatConversationKind.ORDER, orderId },
      update: {},
      select: { id: true },
    });

    const existing = await this.prisma.chatMessage.count({
      where: { conversationId: conv.id },
    });
    if (existing > 0) return;

    const author = await this.prisma.user.findUnique({
      where: { id: order.userId },
      select: this.chatAuthorSelect(),
    });
    const authorLabelSnapshot = author
      ? this.labelAuthor(ChatMessageAuthorRole.CUSTOMER, author)
      : 'Покупатель';

    await this.prisma.chatMessage.create({
      data: {
        conversationId: conv.id,
        authorUserId: order.userId,
        authorRole: ChatMessageAuthorRole.CUSTOMER,
        authorLabelSnapshot,
        body: note.slice(0, ORDER_CHAT_POST_BODY_MAX_CHARS),
      },
    });
  }

  /** После claim гостевых заказов — перенос customerNote в чат. */
  async seedCustomerNotesForUser(userId: string): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: {
        userId,
        customerNote: { not: null },
      },
      select: { id: true },
      take: 50,
    });
    for (const o of orders) {
      try {
        await this.seedCustomerNoteFromOrder(o.id);
      } catch (e) {
        this.logger.warn(
          `seedCustomerNote ${o.id}: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
  }

  /** Retention 90 дней после финального статуса заказа. */
  async applyRetentionForOrder(orderId: string, status: OrderStatus): Promise<void> {
    if (!TERMINAL_ORDER_STATUSES.includes(status)) return;
    const conv = await this.prisma.chatConversation.findUnique({
      where: { orderId },
      select: { id: true, retentionPurgesAt: true },
    });
    if (!conv || conv.retentionPurgesAt) return;
    const days = this.retentionDays();
    const purgesAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await this.prisma.chatConversation.update({
      where: { id: conv.id },
      data: { retentionPurgesAt: purgesAt },
    });
  }
}
