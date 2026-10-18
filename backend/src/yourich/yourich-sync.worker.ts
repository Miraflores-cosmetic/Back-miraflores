import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { YourichClient } from './yourich.client';
import { YourichSyncService } from './yourich-sync.service';

/** Раз в 45 с сверяет outbox лидов с YouRich. */
@Injectable()
export class YourichSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(YourichSyncWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sync: YourichSyncService,
    private readonly client: YourichClient,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
    if (!this.client.enabled()) {
      this.logger.log('Yourich sync worker idle (YOURICH_ENABLED off)');
      return;
    }
    const ms = 45_000;
    this.timer = setInterval(() => {
      void this.sync
        .processDue()
        .then((n) => {
          if (n > 0) this.logger.log(`Yourich synced ${n} lead(s)`);
        })
        .catch((err) => this.logger.warn(`Yourich sync failed: ${String(err)}`));
    }, ms);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
