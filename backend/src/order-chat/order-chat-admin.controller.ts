import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { PostOrderChatMessageDto, RevokeChatUploadDto } from './dto/order-chat.dto';
import {
  ORDER_CHAT_UPLOAD_MAX_FILE_BYTES,
  chatUploadKeyPrefixOrder,
  chatUploadKeyPrefixSupport,
} from './order-chat.constants';
import { SkipRlsTransaction } from '../rls/skip-rls-transaction.decorator';
import { OrderChatService } from './order-chat.service';

const uploadMem = memoryStorage();

function parseLimit(limitRaw?: string): number | undefined {
  if (limitRaw == null || limitRaw.trim() === '') return undefined;
  const n = parseInt(limitRaw, 10);
  if (!Number.isFinite(n)) throw new BadRequestException('limit');
  return n;
}

function parseBefore(beforeRaw?: string, cursorRaw?: string): string | undefined {
  const beforeTrim = beforeRaw?.trim();
  const cursorTrim = cursorRaw?.trim();
  if (beforeTrim && cursorTrim && beforeTrim !== cursorTrim) {
    throw new BadRequestException('Не используйте разные значения before и cursor');
  }
  return beforeTrim || cursorTrim || undefined;
}

function parseAfter(afterRaw?: string): string | undefined {
  const t = afterRaw?.trim();
  return t || undefined;
}

@Controller('orders/admin')
@UseGuards(JwtAuthGuard, AdminGuard, ThrottlerGuard)
export class OrderChatAdminController {
  constructor(private readonly chat: OrderChatService) {}

  @Get('chat/unread-count')
  async unreadStaff(@CurrentUser('sub') staffId: string) {
    const count = await this.chat.unreadCountForStaff(staffId);
    return { count };
  }

  @Get('chat/ws-token')
  wsToken(@CurrentUser() user: JwtPayload) {
    return this.chat.createWsToken(user);
  }

  @Get('chat/support-threads')
  listSupportThreads(
    @CurrentUser('sub') staffId: string,
    @Query('limit') limitRaw?: string,
    @Query('q') q?: string,
    @Query('filter') filter?: string,
    @Query('cursor') cursor?: string,
  ) {
    if (filter && filter !== 'all' && filter !== 'unread') {
      throw new BadRequestException('filter: all | unread');
    }
    return this.chat.listSupportThreadsForAdmin(staffId, {
      limit: parseLimit(limitRaw),
      q,
      unreadOnly: filter === 'unread',
      cursor,
    });
  }

  @Get('chat/users/:userId/messages')
  async supportMessages(
    @CurrentUser() user: JwtPayload,
    @Param('userId') userId: string,
    @Query('limit') limitRaw?: string,
    @Query('before') beforeRaw?: string,
    @Query('cursor') cursorRaw?: string,
    @Query('after') afterRaw?: string,
  ) {
    await this.chat.assertStaffCanAccessSupport(user.sub, user.role);
    const before = parseBefore(beforeRaw, cursorRaw);
    const after = parseAfter(afterRaw);
    if (before && after) throw new BadRequestException('Используйте либо before, либо after');
    return this.chat.listSupportMessages(userId, {
      limit: parseLimit(limitRaw),
      beforeMessageId: before,
      afterMessageId: after,
    });
  }

  @Post('chat/users/:userId/messages')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  async postSupport(
    @CurrentUser() user: JwtPayload,
    @Param('userId') userId: string,
    @Body() dto: PostOrderChatMessageDto,
  ) {
    await this.chat.assertStaffCanAccessSupport(user.sub, user.role);
    return this.chat.postSupportMessage(userId, user.sub, user.role, dto);
  }

  @Post('chat/users/:userId/read')
  async supportRead(@CurrentUser() user: JwtPayload, @Param('userId') userId: string) {
    await this.chat.assertStaffCanAccessSupport(user.sub, user.role);
    await this.chat.markSupportRead(userId, user.sub, user.role);
    return { ok: true as const };
  }

  @Post('chat/users/:userId/upload')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @SkipRlsTransaction()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadMem,
      limits: { fileSize: ORDER_CHAT_UPLOAD_MAX_FILE_BYTES },
    }),
  )
  async supportUpload(
    @CurrentUser() user: JwtPayload,
    @Param('userId') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Файл не передан');
    return this.chat.uploadSupportAttachment(userId, user.sub, user.role, file);
  }

  @Post('chat/users/:userId/upload/revoke')
  async revokeSupportUpload(
    @CurrentUser() user: JwtPayload,
    @Param('userId') userId: string,
    @Body() dto: RevokeChatUploadDto,
  ) {
    await this.chat.assertStaffCanAccessSupport(user.sub, user.role);
    await this.chat.revokePendingChatUpload(
      dto.fileUrl,
      chatUploadKeyPrefixSupport(userId),
      user.sub,
    );
    return { ok: true as const };
  }

  @Delete('chat/users/:userId/messages/:messageId')
  async deleteSupport(
    @CurrentUser() user: JwtPayload,
    @Param('userId') userId: string,
    @Param('messageId') messageId: string,
  ) {
    await this.chat.assertStaffCanAccessSupport(user.sub, user.role);
    await this.chat.deleteSupportMessage(userId, messageId, user.sub, user.role);
    return { ok: true as const };
  }

  @Get(':orderId/chat/messages')
  async orderMessages(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @Query('limit') limitRaw?: string,
    @Query('before') beforeRaw?: string,
    @Query('cursor') cursorRaw?: string,
    @Query('after') afterRaw?: string,
  ) {
    await this.chat.assertStaffCanAccessOrder(orderId, user.sub, user.role);
    const before = parseBefore(beforeRaw, cursorRaw);
    const after = parseAfter(afterRaw);
    if (before && after) throw new BadRequestException('Используйте либо before, либо after');
    return this.chat.listOrderMessages(orderId, {
      limit: parseLimit(limitRaw),
      beforeMessageId: before,
      afterMessageId: after,
    });
  }

  @Post(':orderId/chat/messages')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  async postOrder(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @Body() dto: PostOrderChatMessageDto,
  ) {
    await this.chat.assertStaffCanAccessOrder(orderId, user.sub, user.role);
    return this.chat.postOrderMessage(orderId, user.sub, user.role, dto);
  }

  @Post(':orderId/chat/read')
  async orderRead(@CurrentUser() user: JwtPayload, @Param('orderId') orderId: string) {
    await this.chat.assertStaffCanAccessOrder(orderId, user.sub, user.role);
    await this.chat.markOrderRead(orderId, user.sub, user.role);
    return { ok: true as const };
  }

  @Post(':orderId/chat/upload')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @SkipRlsTransaction()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadMem,
      limits: { fileSize: ORDER_CHAT_UPLOAD_MAX_FILE_BYTES },
    }),
  )
  async orderUpload(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Файл не передан');
    return this.chat.uploadOrderAttachment(orderId, user.sub, user.role, file);
  }

  @Post(':orderId/chat/upload/revoke')
  async revokeOrderUpload(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @Body() dto: RevokeChatUploadDto,
  ) {
    await this.chat.assertStaffCanAccessOrder(orderId, user.sub, user.role);
    await this.chat.revokePendingChatUpload(
      dto.fileUrl,
      chatUploadKeyPrefixOrder(orderId),
      user.sub,
    );
    return { ok: true as const };
  }

  @Delete(':orderId/chat/messages/:messageId')
  async deleteOrderMessage(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @Param('messageId') messageId: string,
  ) {
    await this.chat.assertStaffCanAccessOrder(orderId, user.sub, user.role);
    await this.chat.deleteOrderMessage(orderId, messageId, user.sub, user.role);
    return { ok: true as const };
  }
}
