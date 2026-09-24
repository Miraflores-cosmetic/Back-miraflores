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
import { BuyerGuard } from '../common/guards/buyer.guard';
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

@Controller('account/chat')
@UseGuards(JwtAuthGuard, BuyerGuard, ThrottlerGuard)
export class OrderChatAccountController {
  constructor(private readonly chat: OrderChatService) {}

  @Get('threads')
  listThreads(@CurrentUser('sub') userId: string) {
    return this.chat.listThreadsForCustomer(userId);
  }

  @Get('unread-count')
  async unread(@CurrentUser('sub') userId: string) {
    const count = await this.chat.unreadCountForCustomer(userId);
    return { count };
  }

  @Get('ws-token')
  wsToken(@CurrentUser() user: JwtPayload) {
    return this.chat.createWsToken(user);
  }

  @Get('support/messages')
  async supportMessages(
    @CurrentUser('sub') userId: string,
    @Query('limit') limitRaw?: string,
    @Query('before') beforeRaw?: string,
    @Query('cursor') cursorRaw?: string,
    @Query('after') afterRaw?: string,
  ) {
    const before = parseBefore(beforeRaw, cursorRaw);
    const after = parseAfter(afterRaw);
    if (before && after) throw new BadRequestException('Используйте либо before, либо after');
    return this.chat.listSupportMessages(userId, {
      limit: parseLimit(limitRaw),
      beforeMessageId: before,
      afterMessageId: after,
    });
  }

  @Post('support/messages')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  postSupport(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PostOrderChatMessageDto,
  ) {
    return this.chat.postSupportMessage(user.sub, user.sub, user.role, dto);
  }

  @Post('support/read')
  async supportRead(@CurrentUser() user: JwtPayload) {
    await this.chat.markSupportRead(user.sub, user.sub, user.role);
    return { ok: true as const };
  }

  @Post('support/upload')
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
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Файл не передан');
    return this.chat.uploadSupportAttachment(user.sub, user.sub, user.role, file);
  }

  @Post('support/upload/revoke')
  async revokeSupportUpload(@CurrentUser() user: JwtPayload, @Body() dto: RevokeChatUploadDto) {
    await this.chat.revokePendingChatUpload(
      dto.fileUrl,
      chatUploadKeyPrefixSupport(user.sub),
      user.sub,
    );
    return { ok: true as const };
  }

  @Delete('support/messages/:messageId')
  async deleteSupport(
    @CurrentUser() user: JwtPayload,
    @Param('messageId') messageId: string,
  ) {
    await this.chat.deleteSupportMessage(user.sub, messageId, user.sub, user.role);
    return { ok: true as const };
  }
}

@Controller('account/orders')
@UseGuards(JwtAuthGuard, BuyerGuard, ThrottlerGuard)
export class OrderChatAccountOrdersController {
  constructor(private readonly chat: OrderChatService) {}

  @Get(':orderId/chat/messages')
  async orderMessages(
    @CurrentUser('sub') userId: string,
    @Param('orderId') orderId: string,
    @Query('limit') limitRaw?: string,
    @Query('before') beforeRaw?: string,
    @Query('cursor') cursorRaw?: string,
    @Query('after') afterRaw?: string,
  ) {
    await this.chat.assertCustomerCanAccessOrder(orderId, userId);
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
    await this.chat.assertCustomerCanAccessOrder(orderId, user.sub);
    return this.chat.postOrderMessage(orderId, user.sub, user.role, dto);
  }

  @Post(':orderId/chat/read')
  async orderRead(@CurrentUser() user: JwtPayload, @Param('orderId') orderId: string) {
    await this.chat.assertCustomerCanAccessOrder(orderId, user.sub);
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
    await this.chat.assertCustomerCanAccessOrder(orderId, user.sub);
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
    await this.chat.assertCustomerCanAccessOrder(orderId, user.sub);
    await this.chat.deleteOrderMessage(orderId, messageId, user.sub, user.role);
    return { ok: true as const };
  }
}
