import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderAwaitingPaymentService } from './order-awaiting-payment.service';
import { BackgroundWorkerLeaseService } from '../workers/background-worker-lease.service';

const LEASE_KEY = 'awaiting_payment_remind';
const TICK_MS = 60_000;

/**
 * Напоминания об оплате (5м / 24ч / 48ч). Leader: lease-row.
 */
@Injectable()
export class OrdersExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersExpiryWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickBusy = false;

  constructor(
    private readonly awaitingPayment: OrderAwaitingPaymentService,
    private readonly prisma: PrismaService,
    private readonly lease: BackgroundWorkerLeaseService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    void this.tick();
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
        const reminded =
          await this.awaitingPayment.processAwaitingPaymentReminders();
        if (reminded > 0) {
          this.logger.log(`Sent ${reminded} awaiting-payment reminder(s)`);
        }
      });
    } catch (err) {
      this.logger.warn(`Awaiting payment tick failed: ${String(err)}`);
    } finally {
      await this.lease.release(LEASE_KEY);
      this.tickBusy = false;
    }
  }
}