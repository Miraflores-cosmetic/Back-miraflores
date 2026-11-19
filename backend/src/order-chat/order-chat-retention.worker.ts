import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderChatService } from './order-chat.service';
import { BackgroundWorkerLeaseService } from '../workers/background-worker-lease.service';

const LEASE_KEY = 'order_chat_retention';
const TICK_MS = 15 * 60_000;

/** Purge + backfill retentionPurgesAt. Leader: lease-row. */
@Injectable()
export class OrderChatRetentionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderChatRetentionWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickBusy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: OrderChatService,
    private readonly lease: BackgroundWorkerLeaseService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.tickBusy) return;
    this.tickBusy = true;

    const leaseTtl = TICK_MS * 2 + 60_000;
    if (!(await this.lease.acquire(LEASE_KEY, leaseTtl))) {
      this.tickBusy = false;
      return;
    }

    try {
      await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
        const n = await this.chat.purgeExpiredConversations();
        if (n > 0) this.logger.log(`Purged ${n} expired chat conversation(s)`);
      });
      if (!(await this.lease.renew(LEASE_KEY, leaseTtl))) return;

      let backfilled = 0;
      for (;;) {
        const n = await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, () =>
          this.chat.backfillRetentionForTerminalOrders(50),
        );
        backfilled += n;
        if (n < 50) break;
        if (!(await this.lease.renew(LEASE_KEY, leaseTtl))) return;
      }
      if (backfilled > 0) {
        this.logger.log(`Backfill retentionPurgesAt for ${backfilled} order chat(s)`);
      }
    } catch (err) {
      this.logger.warn(`Chat retention tick failed: ${String(err)}`);
    } finally {
      await this.lease.release(LEASE_KEY);
      this.tickBusy = false;
    }
  }
}