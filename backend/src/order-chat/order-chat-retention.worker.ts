import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderChatService } from './order-chat.service';

/** Advisory lock: один инстанс API purge/backfill за раз. */
const RETENTION_ADVISORY_LOCK_KEY = 902_410_241;

/** Удаляет переписку заказов с истёкшим retentionPurgesAt (сообщения + файлы). */
@Injectable()
export class OrderChatRetentionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderChatRetentionWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: OrderChatService,
  ) {}

  private async tryAdvisoryLock(): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_lock(${RETENTION_ADVISORY_LOCK_KEY}) AS locked
    `;
    return rows[0]?.locked === true;
  }

  private async releaseAdvisoryLock(): Promise<void> {
    await this.prisma.$queryRaw`
      SELECT pg_advisory_unlock(${RETENTION_ADVISORY_LOCK_KEY})
    `;
  }

  onModuleInit() {
    const ms = 15 * 60_000;
    const tick = async () => {
      if (!(await this.tryAdvisoryLock())) return;
      try {
        await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
          const n = await this.chat.purgeExpiredConversations();
          if (n > 0) this.logger.log(`Purged ${n} expired chat conversation(s)`);
        });

        let backfilled = 0;
        for (;;) {
          const n = await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, () =>
            this.chat.backfillRetentionForTerminalOrders(50),
          );
          backfilled += n;
          if (n < 50) break;
        }
        if (backfilled > 0) {
          this.logger.log(`Backfill retentionPurgesAt for ${backfilled} order chat(s)`);
        }
      } catch (err) {
        this.logger.warn(`Chat retention tick failed: ${String(err)}`);
      } finally {
        await this.releaseAdvisoryLock();
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), ms);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
