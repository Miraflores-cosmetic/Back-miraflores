import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CdekOrderSyncService } from './cdek-order-sync.service';
import { BackgroundWorkerLeaseService } from '../workers/background-worker-lease.service';

const LEASE_KEY = 'cdek_sync';
const MAIL_RETRY_ALERT_THROTTLE_MS = 3_600_000;

function mailRetryAlertThreshold(): number {
  const raw = Number(process.env.CDEK_SYNC_MAIL_RETRY_ALERT_THRESHOLD ?? 3);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 3;
}

/**
 * Периодически: трек СДЭК → shipment, письмо order_shipped (outbox), авто «Доставлен».
 * Leader: lease-row (не session advisory lock через пул).
 */
@Injectable()
export class OrdersCdekSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersCdekSyncWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Один тик на процесс: lease допускает renew тем же holder. */
  private tickBusy = false;
  private lastMailRetryAlertAt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly sync: CdekOrderSyncService,
    private readonly lease: BackgroundWorkerLeaseService,
  ) {}

  private intervalMs(): number {
    const raw = Number(
      this.config.get<string>('CDEK_SYNC_INTERVAL_MS') ??
        process.env.CDEK_SYNC_INTERVAL_MS ??
        900_000,
    );
    return Number.isFinite(raw) && raw >= 60_000 ? raw : 900_000;
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
    if (!this.sync.isEnabled()) {
      this.logger.log(
        'CDEK sync worker disabled (CDEK creds missing or CDEK_SYNC_ENABLED=0)',
      );
      return;
    }
    const ms = this.intervalMs();
    this.logger.log(`CDEK sync worker every ${Math.round(ms / 1000)}s`);
    void this.tick();
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
    if (!this.sync.isEnabled()) return;
    if (this.tickBusy) return;
    this.tickBusy = true;

    const leaseTtl = this.intervalMs() * 2 + 60_000;
    if (!(await this.lease.acquire(LEASE_KEY, leaseTtl))) {
      this.tickBusy = false;
      return;
    }

    try {
      const r = await this.sync.runTick({
        onBatchProgress: () => this.lease.renew(LEASE_KEY, leaseTtl),
      });
      if (
        r.trackingUpdated > 0 ||
        r.trackingEmailed > 0 ||
        r.delivered > 0 ||
        r.retriedMails > 0 ||
        r.mailOutboxExhausted > 0 ||
        r.mailOutboxHighAttempt > 0 ||
        r.errors > 0
      ) {
        this.logger.log(
          `CDEK sync tick scanned=${r.scanned} track+=${r.trackingUpdated} mail=${r.trackingEmailed} retry=${r.retriedMails} mailHigh=${r.mailOutboxHighAttempt} mailExhaust=${r.mailOutboxExhausted} delivered=${r.delivered} err=${r.errors}`,
        );
      }
      this.alertMailOutboxIfNeeded(r);
    } catch (err) {
      this.logger.warn(`CDEK sync tick failed: ${String(err)}`);
    } finally {
      await this.lease.release(LEASE_KEY);
      this.tickBusy = false;
    }
  }

  private alertMailOutboxIfNeeded(r: Awaited<ReturnType<CdekOrderSyncService['runTick']>>): void {
    const threshold = mailRetryAlertThreshold();
    const hot =
      r.retriedMails >= threshold ||
      r.mailOutboxHighAttempt > 0 ||
      r.mailOutboxExhausted > 0;
    if (!hot) return;

    const msg = `cdek_sync_mail retry=${r.retriedMails} highAttempt=${r.mailOutboxHighAttempt} exhausted=${r.mailOutboxExhausted} threshold=${threshold}`;
    const now = Date.now();
    if (now - this.lastMailRetryAlertAt < MAIL_RETRY_ALERT_THROTTLE_MS) {
      this.logger.warn(`OPS_ALERT ${msg} (throttled)`);
      return;
    }
    this.lastMailRetryAlertAt = now;
    this.logger.error(`OPS_ALERT ${msg}`);
  }
}