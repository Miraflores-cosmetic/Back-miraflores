import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ReferralWalletService } from './referral-wallet.service';

/**
 * Раз в 60 с:
 * 1) quarantine DAYS_AFTER_PAID → POSTED
 * 2) touch outbox retries
 * 3) каждые ~15 тиков — reconcile missed (PAID без outbox / cancel с живым earn)
 */
@Injectable()
export class ReferralWalletWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReferralWalletWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;

  constructor(private readonly wallet: ReferralWalletService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
    const ms = 60_000;
    this.timer = setInterval(() => {
      void this.runTick();
    }, ms);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async runTick(): Promise<void> {
    this.tick += 1;
    try {
      const released = await this.wallet.processDueQuarantine();
      if (released > 0) {
        this.logger.log(`Referral quarantine released ${released} earn(s)`);
      }
    } catch (err) {
      this.logger.warn(`Referral quarantine tick failed: ${String(err)}`);
    }

    try {
      const touched = await this.wallet.processDueTouches();
      if (touched > 0) {
        this.logger.log(`Referral touch outbox processed ${touched}`);
      }
    } catch (err) {
      this.logger.warn(`Referral touch outbox tick failed: ${String(err)}`);
    }

    // ~раз в 15 мин при 60с тике
    if (this.tick % 15 === 0) {
      try {
        const n = await this.wallet.reconcileMissedTouches();
        if (n > 0) {
          this.logger.log(`Referral reconcile touched ${n} order(s)`);
        }
      } catch (err) {
        this.logger.warn(`Referral reconcile tick failed: ${String(err)}`);
      }
    }
  }
}
