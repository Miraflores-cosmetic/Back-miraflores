import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ReferralWalletService } from './referral-wallet.service';

/** Раз в 60 с: quarantine DAYS_AFTER_PAID → POSTED. */
@Injectable()
export class ReferralWalletWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReferralWalletWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly wallet: ReferralWalletService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
    const ms = 60_000;
    this.timer = setInterval(() => {
      void this.wallet
        .processDueQuarantine()
        .then((n) => {
          if (n > 0) {
            this.logger.log(`Referral quarantine released ${n} earn(s)`);
          }
        })
        .catch((err) =>
          this.logger.warn(`Referral quarantine tick failed: ${String(err)}`),
        );
    }, ms);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
