import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderChatService } from './order-chat.service';

/** Удаляет переписку заказов с истёкшим retentionPurgesAt (сообщения + файлы). */
@Injectable()
export class OrderChatRetentionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderChatRetentionWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: OrderChatService,
  ) {}

  onModuleInit() {
    const ms = 15 * 60_000;
    const tick = () => {
      void this.prisma
        .runInRlsTransaction({ userId: '', bypass: true }, () =>
          this.chat.purgeExpiredConversations(),
        )
        .then((n) => {
          if (n > 0) this.logger.log(`Purged ${n} expired chat conversation(s)`);
        })
        .catch((err) => this.logger.warn(`Chat retention purge failed: ${String(err)}`));

      void this.prisma
        .runInRlsTransaction({ userId: '', bypass: true }, () =>
          this.chat.purgeOrphanChatUploadFiles(6 * 60 * 60_000),
        )
        .then((n) => {
          if (n > 0) this.logger.log(`Removed ${n} orphan chat upload(s) from disk`);
        })
        .catch((err) => this.logger.warn(`Chat orphan upload purge failed: ${String(err)}`));
    };
    tick();
    this.timer = setInterval(tick, ms);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
