import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderAwaitingPaymentService } from './order-awaiting-payment.service';

/** Advisory lock: один инстанс API гоняет remind+expire за раз. */
const AWAITING_PAYMENT_ADVISORY_LOCK_KEY = 902_610_221;

/**
 * Раз в минуту (только лидер по pg_try_advisory_lock):
 * — напоминания об оплате (5м / 24ч / 48ч, catch-up = высший overdue);
 * — авто-отмена AWAITING_PAYMENT старше TTL (default 72ч).
 */
@Injectable()
export class OrdersExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersExpiryWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly awaitingPayment: OrderAwaitingPaymentService,
    private readonly prisma: PrismaService,
  ) {}

  private async tryAdvisoryLock(): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_lock(${AWAITING_PAYMENT_ADVISORY_LOCK_KEY}) AS locked
    `;
    return rows[0]?.locked === true;
  }

  private async releaseAdvisoryLock(): Promise<void> {
    await this.prisma.$queryRaw`
      SELECT pg_advisory_unlock(${AWAITING_PAYMENT_ADVISORY_LOCK_KEY})
    `;
  }

  onModuleInit() {
    const ms = 60_000;
    this.timer = setInterval(() => {
      void this.tick();
    }, ms);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (!(await this.tryAdvisoryLock())) return;
    try {
      await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
        const reminded =
          await this.awaitingPayment.processAwaitingPaymentReminders();
        if (reminded > 0) {
          this.logger.log(`Sent ${reminded} awaiting-payment reminder(s)`);
        }
        const expired = await this.awaitingPayment.expireStaleAwaitingOrders();
        if (expired > 0) {
          this.logger.log(`Expired ${expired} awaiting order(s)`);
        }
      });
    } catch (err) {
      this.logger.warn(`Awaiting payment tick failed: ${String(err)}`);
    } finally {
      await this.releaseAdvisoryLock();
    }
  }
}
