import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { YourichClient } from './yourich.client';
import { YourichPromoSyncService } from './yourich-promo-sync.service';

/** Раз в 10 мин подтягивает партнёрские промокоды из YouRich. */
@Injectable()
export class YourichPromoSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(YourichPromoSyncWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sync: YourichPromoSyncService,
    private readonly client: YourichClient,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
    if (!this.client.enabled()) return;
    const ms = 10 * 60_000;
    const tick = () => {
      void this.sync.syncOnce().catch((err) =>
        this.logger.warn(`Yourich promo sync failed: ${String(err)}`),
      );
    };
    // первый прогон через минуту после старта
    setTimeout(tick, 60_000).unref?.();
    this.timer = setInterval(tick, ms);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
