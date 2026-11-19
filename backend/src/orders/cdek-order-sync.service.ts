import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, Prisma, ShipmentProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CarrierShipmentService } from './carrier-shipment.service';
import { OrdersAdminService } from './orders-admin.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import {
  cdekTrackingFromEntity,
  isCdekDelivered,
  latestCdekStatus,
} from './cdek-order-status.util';
import { canSendTracking } from './order-transitions';
import {
  type CdekDeliveredMailMeta,
  isDeliveredMailDueForRetry,
  parseDeliveredMailOutboxMeta,
} from './cdek-delivered-mail-outbox.util';
import {
  isTrackingMailDueForRetry,
  parseTrackingMailOutboxMeta,
} from './cdek-tracking-mail-outbox.util';
import { cdekShipmentPersistDirty } from './cdek-shipment-snapshot.util';
import {
  fetchDeliveredMailOutboxFlushRows,
  fetchTrackingMailOutboxFlushRows,
} from './order-event-mail-outbox-query';

export type CdekSyncTickResult = {
  scanned: number;
  trackingUpdated: number;
  trackingEmailed: number;
  retriedMails: number;
  /** SMTP failure with attempt ≥ MAIL_OUTBOX_HIGH_ATTEMPT_WARN */
  mailOutboxHighAttempt: number;
  /** Переход в skipped после MAIL_OUTBOX_MAX_ATTEMPTS */
  mailOutboxExhausted: number;
  delivered: number;
  errors: number;
};

export type CdekSyncTickOpts = {
  /** Продление lease; `false` — прервать тик (потеря лидерства). */
  onBatchProgress?: () => boolean | void | Promise<boolean | void>;
};

@Injectable()
export class CdekOrderSyncService {
  private readonly logger = new Logger(CdekOrderSyncService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly carrier: CarrierShipmentService,
    private readonly ordersAdmin: OrdersAdminService,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  isEnabled(): boolean {
    const raw = (
      this.config.get<string>('CDEK_SYNC_ENABLED') ??
      process.env.CDEK_SYNC_ENABLED ??
      ''
    ).trim();
    if (raw === '0' || raw.toLowerCase() === 'false' || raw === 'off') {
      return false;
    }
    return this.carrier.isCdekConfigured();
  }

  private async tickMayContinue(opts: CdekSyncTickOpts): Promise<boolean> {
    if (!opts.onBatchProgress) return true;
    const r = await opts.onBatchProgress();
    return r !== false;
  }

  batchSize(): number {
    const raw = Number(
      this.config.get<string>('CDEK_SYNC_BATCH_SIZE') ??
        process.env.CDEK_SYNC_BATCH_SIZE ??
        40,
    );
    return Number.isFinite(raw) && raw > 0 ? Math.min(200, Math.round(raw)) : 40;
  }

  /**
   * HTTP/SMTP вне tx; письма: TRACKING_SENT и DELIVERED (cdek_sync) — sent только после SMTP.
   */
  async runTick(opts: CdekSyncTickOpts = {}): Promise<CdekSyncTickResult> {
    const result: CdekSyncTickResult = {
      scanned: 0,
      trackingUpdated: 0,
      trackingEmailed: 0,
      retriedMails: 0,
      mailOutboxHighAttempt: 0,
      mailOutboxExhausted: 0,
      delivered: 0,
      errors: 0,
    };

    if (!this.isEnabled()) return result;

    const mailGuard = new Set<string>(); // `${orderId}:tracking|delivered`
    const trackingFlush = await this.flushPendingCdekTrackingMails(
      mailGuard,
      opts,
    );
    result.retriedMails += trackingFlush.sent;
    result.mailOutboxExhausted += trackingFlush.exhausted;
    result.mailOutboxHighAttempt += trackingFlush.highAttempt;
    if (!(await this.tickMayContinue(opts))) return result;
    const deliveredFlush = await this.flushPendingCdekDeliveredMails(
      mailGuard,
      opts,
    );
    result.retriedMails += deliveredFlush.sent;
    result.mailOutboxExhausted += deliveredFlush.exhausted;
    result.mailOutboxHighAttempt += deliveredFlush.highAttempt;
    if (!(await this.tickMayContinue(opts))) return result;

    const rows = await this.prisma.runInRlsTransaction(
      { userId: '', bypass: true },
      () =>
        this.prisma.shipment.findMany({
          where: {
            provider: ShipmentProvider.CDEK,
            externalId: { not: null },
            order: {
              status: {
                in: [OrderStatus.PACKING, OrderStatus.SHIPPED],
              },
            },
          },
          orderBy: { updatedAt: 'asc' },
          take: this.batchSize(),
          select: {
            id: true,
            orderId: true,
            tracking: true,
            raw: true,
            externalId: true,
            order: {
              select: {
                id: true,
                number: true,
                status: true,
              },
            },
          },
        }),
    );

    for (const row of rows) {
      if (!(await this.tickMayContinue(opts))) break;

      const uuid = row.externalId?.trim();
      if (!uuid) continue;
      result.scanned += 1;

      try {
        const remote = await this.carrier.fetchCdekOrderByUuid(uuid);
        if (!remote) {
          result.errors += 1;
          continue;
        }

        const apiTrack = cdekTrackingFromEntity(remote.entity);
        const dbTrack = row.tracking?.trim() || '';

        const persistDirty = cdekShipmentPersistDirty({
          apiTrack,
          dbTrack,
          remoteRaw: remote.raw,
          dbRaw: row.raw,
        });
        if (persistDirty.any) {
          const updated = await this.persistShipmentFromCdek(
            row.id,
            apiTrack,
            dbTrack,
            remote.raw,
            persistDirty,
          );
          if (updated) result.trackingUpdated += 1;
        }

        const effectiveTrack = apiTrack || dbTrack;
        const orderStatus = row.order.status;

        if (canSendTracking(orderStatus) && effectiveTrack) {
          const mailed = await this.deliverCdekTrackingOutboxMail(
            row.orderId,
            effectiveTrack,
            mailGuard,
            result,
          );
          if (mailed) {
            result.trackingEmailed += 1;
            this.logger.log(
              `CDEK sync: tracking email ${row.order.number} → ${effectiveTrack}`,
            );
          }
        }

        if (isCdekDelivered(remote.entity)) {
          const latest = latestCdekStatus(remote.entity);
          const code = latest?.code ?? 'DELIVERED';
          await this.tryAutoDeliverFromCdek(
            row.orderId,
            row.order.number,
            code,
            result,
            mailGuard,
          );
        }

        if (!(await this.tickMayContinue(opts))) break;
      } catch (e) {
        result.errors += 1;
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `CDEK sync failed order=${row.order.number} uuid=${uuid}: ${msg}`,
        );
      }
    }

    return result;
  }

  /** Гонка admin/worker/параллельный тик → skip без +errors. */
  private async tryAutoDeliverFromCdek(
    orderId: string,
    orderNumber: string,
    cdekStatusCode: string,
    result: CdekSyncTickResult,
    mailGuard: Set<string>,
  ): Promise<void> {
    try {
      const claimed = await this.ordersAdmin.claimCdekSyncDelivered(
        orderId,
        cdekStatusCode,
      );
      if (!claimed) return;

      result.delivered += 1;
      await this.sendCdekDeliveredOutboxMail(
        claimed.eventId,
        orderId,
        claimed.email,
        claimed.number,
        claimed.meta,
        mailGuard,
        result,
      );
      this.logger.log(
        `CDEK sync: delivered ${orderNumber} (${cdekStatusCode})`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.debug(
        `CDEK sync: deliver skip ${orderNumber} (${cdekStatusCode}): ${msg}`,
      );
    }
  }

  private async sendCdekDeliveredOutboxMail(
    eventId: string,
    orderId: string,
    email: string,
    number: string,
    meta: CdekDeliveredMailMeta,
    mailGuard: Set<string>,
    tick: CdekSyncTickResult,
  ): Promise<void> {
    const guardKey = `${orderId}:delivered`;
    if (mailGuard.has(guardKey)) return;
    if (!isDeliveredMailDueForRetry(meta)) return;
    mailGuard.add(guardKey);

    const mailResult = await this.lifecycle.notifyOrderDeliveredWithResult(
      email,
      number,
    );
    const fin = await this.ordersAdmin.finalizeCdekSyncDeliveredMailOutbox(
      eventId,
      mailResult,
      meta,
      mailResult === 'failed' ? { lastError: 'smtp failed' } : {},
    );
    if (fin.exhausted) tick.mailOutboxExhausted += 1;
    if (fin.highAttempt) tick.mailOutboxHighAttempt += 1;
  }

  private mailFlushStats() {
    return { sent: 0, exhausted: 0, highAttempt: 0 };
  }

  /** Retry: DELIVERED outbox pending/failed (заказ уже в статусе). */
  private async flushPendingCdekDeliveredMails(
    mailGuard: Set<string>,
    opts: CdekSyncTickOpts,
  ): Promise<ReturnType<CdekOrderSyncService['mailFlushStats']>> {
    const staleBefore = new Date(Date.now() - 15_000);
    const now = new Date();
    const pending = await fetchDeliveredMailOutboxFlushRows(
      this.prisma,
      staleBefore,
      this.batchSize(),
      now,
    );

    const stats = this.mailFlushStats();
    for (const ev of pending) {
      if (!(await this.tickMayContinue(opts))) break;

      const meta = parseDeliveredMailOutboxMeta(ev.meta);
      if (!meta) continue;
      if (!isDeliveredMailDueForRetry(meta)) continue;
      const guardKey = `${ev.orderId}:delivered`;
      if (mailGuard.has(guardKey)) continue;
      if (ev.status !== OrderStatus.DELIVERED) {
        const fin = await this.ordersAdmin.finalizeCdekSyncDeliveredMailOutbox(
          ev.eventId,
          'skipped',
          meta,
          { lastError: `order status=${ev.status}` },
        );
        if (fin.exhausted) stats.exhausted += 1;
        if (fin.highAttempt) stats.highAttempt += 1;
        continue;
      }
      const email = ev.email?.trim();
      if (!email) {
        const fin = await this.ordersAdmin.finalizeCdekSyncDeliveredMailOutbox(
          ev.eventId,
          'skipped',
          meta,
          { lastError: 'empty email' },
        );
        if (fin.exhausted) stats.exhausted += 1;
        if (fin.highAttempt) stats.highAttempt += 1;
        continue;
      }

      mailGuard.add(guardKey);
      const mailResult = await this.lifecycle.notifyOrderDeliveredWithResult(
        email,
        ev.number,
      );
      const fin = await this.ordersAdmin.finalizeCdekSyncDeliveredMailOutbox(
        ev.eventId,
        mailResult,
        meta,
        mailResult === 'failed' ? { lastError: 'smtp failed' } : {},
      );
      if (mailResult === 'sent') stats.sent += 1;
      if (fin.exhausted) stats.exhausted += 1;
      if (fin.highAttempt) stats.highAttempt += 1;
    }
    return stats;
  }

  private async deliverCdekTrackingOutboxMail(
    orderId: string,
    tracking: string,
    mailGuard: Set<string>,
    tick: CdekSyncTickResult,
  ): Promise<boolean> {
    const guardKey = `${orderId}:tracking`;
    if (mailGuard.has(guardKey)) return false;

    const reserved = await this.ordersAdmin.reserveCdekSyncTrackingMailOutbox(
      orderId,
      tracking,
    );
    if (!reserved) return false;
    if (!isTrackingMailDueForRetry(reserved.meta)) return false;

    mailGuard.add(guardKey);
    const meta = reserved.meta;

    const result = await this.lifecycle.notifyOrderShippedWithResult(
      reserved.email,
      reserved.number,
      reserved.tracking,
    );

    const fin = await this.ordersAdmin.finalizeCdekSyncTrackingMailOutbox(
      reserved.eventId,
      result,
      meta,
      result === 'failed' ? { lastError: 'smtp failed' } : {},
    );
    if (fin.exhausted) tick.mailOutboxExhausted += 1;
    if (fin.highAttempt) tick.mailOutboxHighAttempt += 1;

    return result === 'sent';
  }

  /** Retry: TRACKING_SENT outbox pending/failed. */
  private async flushPendingCdekTrackingMails(
    mailGuard: Set<string>,
    opts: CdekSyncTickOpts,
  ): Promise<ReturnType<CdekOrderSyncService['mailFlushStats']>> {
    const staleBefore = new Date(Date.now() - 15_000);
    const now = new Date();
    const pending = await fetchTrackingMailOutboxFlushRows(
      this.prisma,
      staleBefore,
      this.batchSize(),
      now,
    );

    const stats = this.mailFlushStats();
    for (const ev of pending) {
      if (!(await this.tickMayContinue(opts))) break;

      const meta = parseTrackingMailOutboxMeta(ev.meta);
      if (!meta) continue;
      if (!isTrackingMailDueForRetry(meta)) continue;
      const guardKey = `${ev.orderId}:tracking`;
      if (mailGuard.has(guardKey)) continue;
      if (!canSendTracking(ev.status)) {
        const fin = await this.ordersAdmin.finalizeCdekSyncTrackingMailOutbox(
          ev.eventId,
          'skipped',
          meta,
          { lastError: `order status=${ev.status}` },
        );
        if (fin.exhausted) stats.exhausted += 1;
        if (fin.highAttempt) stats.highAttempt += 1;
        continue;
      }
      const email = ev.email?.trim();
      if (!email) {
        const fin = await this.ordersAdmin.finalizeCdekSyncTrackingMailOutbox(
          ev.eventId,
          'skipped',
          meta,
          { lastError: 'empty email' },
        );
        if (fin.exhausted) stats.exhausted += 1;
        if (fin.highAttempt) stats.highAttempt += 1;
        continue;
      }

      mailGuard.add(guardKey);
      const result = await this.lifecycle.notifyOrderShippedWithResult(
        email,
        ev.number,
        meta.tracking,
      );
      const fin = await this.ordersAdmin.finalizeCdekSyncTrackingMailOutbox(
        ev.eventId,
        result,
        meta,
        result === 'failed' ? { lastError: 'smtp failed' } : {},
      );
      if (result === 'sent') stats.sent += 1;
      if (fin.exhausted) stats.exhausted += 1;
      if (fin.highAttempt) stats.highAttempt += 1;
    }
    return stats;
  }

  /** Короткая tx: только Shipment (без HTTP/SMTP). */
  private async persistShipmentFromCdek(
    shipmentId: string,
    apiTrack: string | null,
    dbTrack: string,
    raw: unknown,
    dirty: { trackChanged: boolean; rawChanged: boolean },
  ): Promise<boolean> {
    if (!dirty.trackChanged && !dirty.rawChanged) return false;

    await this.prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          ...(dirty.trackChanged && apiTrack ? { tracking: apiTrack.trim() } : {}),
          ...(dirty.rawChanged && raw != null
            ? { raw: raw as Prisma.InputJsonValue }
            : {}),
        },
      });
    });
    return dirty.trackChanged;
  }
}