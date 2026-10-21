import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, Prisma } from '@prisma/client';
import { OrderChatService } from '../order-chat/order-chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { scheduleAfterRlsCommitWithBypass } from '../rls/rls-after-commit';
import { YourichSyncService } from '../yourich/yourich-sync.service';
import { cancelUnpaidOrderInTx } from './cancel-unpaid-order';
import {
  formatCancelAtLabel,
  nextAwaitingRemindStage,
  paymentRemindEventMessage,
  resolveAwaitingRemindSchedule,
  skippedAwaitingRemindStages,
} from './order-awaiting-payment-schedule';
import {
  AWAITING_PAYMENT_EXPIRE_BATCH,
  AWAITING_PAYMENT_REMIND_BATCH,
  claimAwaitingPaymentRemindCandidates,
  countDueAwaitingPaymentReminders,
  lockOrderForUpdate,
} from './order-lock';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderPayTokenService } from './order-pay-token.service';
import { YooKassaService } from './yookassa.service';

/** Throttle OPS email при backlog (мс). */
const BACKLOG_ALERT_THROTTLE_MS = 60 * 60 * 1000;

type RemindMailStatus = 'pending' | 'sent' | 'skipped' | 'failed';

type RemindOutboxMeta = {
  stage: 1 | 2 | 3;
  skipped?: number[];
  mailStatus: RemindMailStatus;
  sentAt?: string;
  lastError?: string;
};

/**
 * Напоминания об оплате + авто-отмена AWAITING_PAYMENT по TTL.
 * Outbox: bump + PAYMENT_REMIND(mailStatus=pending) в tx → SMTP → mark sent;
 * при fail SMTP stage уже bumped, retry по pending events (без дубля stage).
 */
@Injectable()
export class OrderAwaitingPaymentService {
  private readonly logger = new Logger(OrderAwaitingPaymentService.name);
  private lastRemindBacklogAlertAt = 0;
  private lastExpireBacklogAlertAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly payTokens: OrderPayTokenService,
    private readonly yookassa: YooKassaService,
    private readonly orderChat: OrderChatService,
    @Optional() private readonly yourichSync?: YourichSyncService,
  ) {}

  /** Сколько заказов due на remind (метрика backlog). */
  async countRemindBacklog(now = new Date()): Promise<number> {
    const schedule = resolveAwaitingRemindSchedule({
      get: (k) => this.config.get<string>(k),
    });
    const ttlCutoff = new Date(now.getTime() - schedule.ttlMinutes * 60_000);
    return countDueAwaitingPaymentReminders(this.prisma, {
      now,
      ttlCutoff,
      remind1Minutes: schedule.remind1Minutes,
      remind2Minutes: schedule.remind2Minutes,
      remind3Minutes: schedule.remind3Minutes,
    });
  }

  /** Сколько заказов старше TTL (очередь expire). */
  async countExpireBacklog(now = new Date()): Promise<number> {
    const schedule = resolveAwaitingRemindSchedule({
      get: (k) => this.config.get<string>(k),
    });
    const cutoff = new Date(now.getTime() - schedule.ttlMinutes * 60_000);
    return this.prisma.order.count({
      where: {
        status: { in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.NEW] },
        createdAt: { lt: cutoff },
      },
    });
  }

  private resolveBacklogThreshold(
    envKey: string,
    defaultBatch: number,
  ): number {
    const raw = this.config.get<string>(envKey);
    if (raw === undefined || raw === '') return defaultBatch;
    return Math.max(0, Number.parseInt(raw, 10) || 0);
  }

  private async sendBacklogOpsAlert(input: {
    kind: 'remind' | 'expire';
    dueCount: number;
    batch: number;
    envKey: string;
    threshold: number;
    lastAlertAt: number;
    setLastAlertAt: (t: number) => void;
  }): Promise<void> {
    const { kind, dueCount, batch, envKey, threshold } = input;
    if (threshold <= 0 || dueCount <= threshold) return;

    const lagTicks = Math.ceil((dueCount - batch) / batch);
    const msg = `awaiting_${kind}_backlog due=${dueCount} batch=${batch} lag_ticks≈${Math.max(0, lagTicks)}`;
    this.logger.error(`OPS_ALERT ${msg}`);

    const now = Date.now();
    if (now - input.lastAlertAt < BACKLOG_ALERT_THROTTLE_MS) {
      this.logger.warn(`OPS_ALERT ${msg} (email throttled)`);
      return;
    }
    input.setLastAlertAt(now);

    const opsTo = (
      this.config.get<string>('OPS_ALERT_EMAIL') ||
      this.config.get<string>('SUPPORT_EMAIL') ||
      ''
    ).trim();
    if (!opsTo) {
      this.logger.warn(
        `OPS_ALERT awaiting_${kind}_backlog: set OPS_ALERT_EMAIL or SUPPORT_EMAIL`,
      );
      return;
    }
    const title =
      kind === 'remind'
        ? 'Payment remind backlog'
        : 'Awaiting payment TTL expire backlog';
    await this.lifecycle.notifyCustomer({
      to: opsTo,
      subject: `[OPS] ${title} — ${dueCount} due`,
      text: [
        kind === 'remind'
          ? `Очередь напоминаний об оплате отстаёт.`
          : `Очередь TTL-отмены неоплаченных заказов отстаёт.`,
        `due: ${dueCount} (batch ${batch}/мин)`,
        `≈${Math.max(1, lagTicks)} мин отставания при текущем tick.`,
        `Env: ${envKey}=${threshold}`,
      ].join('\n'),
      html: `<p><strong>OPS: awaiting_${kind}_backlog</strong></p>
<p>Due: <strong>${dueCount}</strong> (batch ${batch}/мин).</p>`,
    });
  }

  /**
   * OPS_ALERT если remind due > порога (default = batch 100).
   * Env: ORDER_PAY_REMIND_BACKLOG_ALERT (0 = выкл). Throttle 1 ч.
   */
  async alertRemindBacklogIfNeeded(dueCount: number): Promise<void> {
    const threshold = this.resolveBacklogThreshold(
      'ORDER_PAY_REMIND_BACKLOG_ALERT',
      AWAITING_PAYMENT_REMIND_BATCH,
    );
    await this.sendBacklogOpsAlert({
      kind: 'remind',
      dueCount,
      batch: AWAITING_PAYMENT_REMIND_BATCH,
      envKey: 'ORDER_PAY_REMIND_BACKLOG_ALERT',
      threshold,
      lastAlertAt: this.lastRemindBacklogAlertAt,
      setLastAlertAt: (t) => {
        this.lastRemindBacklogAlertAt = t;
      },
    });
  }

  /**
   * OPS_ALERT если expire due > порога (default = batch 50).
   * Env: ORDER_AWAITING_EXPIRE_BACKLOG_ALERT (0 = выкл). Throttle 1 ч.
   */
  async alertExpireBacklogIfNeeded(dueCount: number): Promise<void> {
    const threshold = this.resolveBacklogThreshold(
      'ORDER_AWAITING_EXPIRE_BACKLOG_ALERT',
      AWAITING_PAYMENT_EXPIRE_BATCH,
    );
    await this.sendBacklogOpsAlert({
      kind: 'expire',
      dueCount,
      batch: AWAITING_PAYMENT_EXPIRE_BATCH,
      envKey: 'ORDER_AWAITING_EXPIRE_BACKLOG_ALERT',
      threshold,
      lastAlertAt: this.lastExpireBacklogAlertAt,
      setLastAlertAt: (t) => {
        this.lastExpireBacklogAlertAt = t;
      },
    });
  }

  /**
   * Авто-отмена неоплаченных AWAITING_PAYMENT/NEW старше TTL (мин).
   * Env: ORDER_AWAITING_TTL_MINUTES (default 4320 = 72 ч).
   * Batch: AWAITING_PAYMENT_EXPIRE_BATCH (50); backlog → OPS_ALERT.
   */
  async expireStaleAwaitingOrders(now = new Date()): Promise<number> {
    const schedule = resolveAwaitingRemindSchedule({
      get: (k) => this.config.get<string>(k),
    });
    const cutoff = new Date(now.getTime() - schedule.ttlMinutes * 60_000);

    const dueBefore = await this.countExpireBacklog(now);
    if (dueBefore > AWAITING_PAYMENT_EXPIRE_BATCH) {
      this.logger.warn(
        `awaiting_expire_backlog due=${dueBefore} batch=${AWAITING_PAYMENT_EXPIRE_BATCH}`,
      );
      await this.alertExpireBacklogIfNeeded(dueBefore);
    }

    const stale = await this.prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.NEW] },
        createdAt: { lt: cutoff },
      },
      include: { items: true },
      take: AWAITING_PAYMENT_EXPIRE_BATCH,
      orderBy: { createdAt: 'asc' },
    });

    let cancelled = 0;
    for (const order of stale) {
      const txResult = await this.prisma.$transaction(async (tx) => {
        await lockOrderForUpdate(tx, order.id);
        const fresh = await tx.order.findUnique({
          where: { id: order.id },
          include: { items: true },
        });
        if (
          !fresh ||
          (fresh.status !== OrderStatus.AWAITING_PAYMENT &&
            fresh.status !== OrderStatus.NEW)
        ) {
          return null;
        }
        const result = await cancelUnpaidOrderInTx(tx, {
          orderId: fresh.id,
          fromStatus: fresh.status,
          items: fresh.items,
          message: 'Заказ отменён (истёк срок оплаты)',
          reason: 'ttl',
          giftNote: 'Возврат при истечении срока оплаты',
        });
        return {
          pendingExternalIds: result.pendingExternalIds,
          email: fresh.email?.trim() || '',
          number: fresh.number,
        };
      });
      if (txResult == null) continue;
      if (txResult.pendingExternalIds.length) {
        await this.yookassa.cancelPaymentsBestEffort(txResult.pendingExternalIds);
      }
      scheduleAfterRlsCommitWithBypass(this.prisma, () =>
        this.orderChat.applyRetentionForOrder(order.id, OrderStatus.CANCELLED),
      );
      if (this.yourichSync) {
        scheduleAfterRlsCommitWithBypass(this.prisma, () =>
          this.yourichSync!.touch(order.id),
        );
      }
      if (txResult.email) {
        void this.lifecycle.notifyOrderCancelled(
          txResult.email,
          txResult.number,
          'Заказ автоматически отменён: оплата не поступила в срок.',
        );
      }
      cancelled += 1;
    }
    return cancelled;
  }

  /**
   * Напоминания: stage 1 (5м), 2 (24ч), 3 (48ч + дата отмены).
   * Catch-up (осознанно): один tick → высший overdue stage; 5м/24ч тексты
   * пропускаются, OrderEvent meta.skipped фиксирует это.
   * Outbox: bump + event(pending) → SMTP → mailStatus=sent; fail → retry next tick.
   */
  async processAwaitingPaymentReminders(now = new Date()): Promise<number> {
    const schedule = resolveAwaitingRemindSchedule({
      get: (k) => this.config.get<string>(k),
    });
    const ttlCutoff = new Date(now.getTime() - schedule.ttlMinutes * 60_000);
    const dueOpts = {
      now,
      ttlCutoff,
      remind1Minutes: schedule.remind1Minutes,
      remind2Minutes: schedule.remind2Minutes,
      remind3Minutes: schedule.remind3Minutes,
    };

    const dueBefore = await countDueAwaitingPaymentReminders(
      this.prisma,
      dueOpts,
    );
    if (dueBefore > AWAITING_PAYMENT_REMIND_BATCH) {
      this.logger.warn(
        `awaiting_remind_backlog due=${dueBefore} batch=${AWAITING_PAYMENT_REMIND_BATCH}`,
      );
      await this.alertRemindBacklogIfNeeded(dueBefore);
    }

    const retried = await this.flushPendingRemindMails(now);

    type Claimed = {
      eventId: string;
      id: string;
      number: string;
      email: string;
      total: number;
      guestId: string | null;
      next: 1 | 2 | 3;
      cancelAtLabel?: string;
      meta: RemindOutboxMeta;
    };

    const claimed = await this.prisma.$transaction(async (tx) => {
      const rows = await claimAwaitingPaymentRemindCandidates(tx, {
        ...dueOpts,
        take: AWAITING_PAYMENT_REMIND_BATCH,
      });
      const out: Claimed[] = [];
      for (const order of rows) {
        const ageMinutes =
          (now.getTime() - new Date(order.createdAt).getTime()) / 60_000;
        const next = nextAwaitingRemindStage(
          ageMinutes,
          order.awaitingPaymentRemindStage,
          schedule,
        );
        if (!next) continue;
        const email = (order.email || '').trim();
        if (!email) continue;

        const skipped = skippedAwaitingRemindStages(
          order.awaitingPaymentRemindStage,
          next,
        );
        const cancelAtLabel =
          next === 3
            ? formatCancelAtLabel(
                new Date(
                  new Date(order.createdAt).getTime() +
                    schedule.ttlMinutes * 60_000,
                ),
              )
            : undefined;

        const meta: RemindOutboxMeta = {
          stage: next,
          mailStatus: 'pending',
          ...(skipped.length ? { skipped } : {}),
        };

        await tx.order.update({
          where: { id: order.id },
          data: { awaitingPaymentRemindStage: next },
        });

        const event = await this.lifecycle.addEvent(tx, {
          orderId: order.id,
          type: 'PAYMENT_REMIND',
          message: paymentRemindEventMessage(next, cancelAtLabel, skipped),
          meta: meta as Prisma.InputJsonValue,
        });

        out.push({
          eventId: event.id,
          id: order.id,
          number: order.number,
          email,
          total: order.total,
          guestId: order.guestId,
          next,
          cancelAtLabel,
          meta,
        });
      }
      return out;
    });

    let sent = retried;
    for (const order of claimed) {
      const ok = await this.deliverRemindMail(order);
      if (ok) sent += 1;
    }
    return sent;
  }

  /**
   * Retry: PAYMENT_REMIND с mailStatus=pending|failed (SMTP упал после bump).
   * Stage уже bumped → повтор без нового event / без сдвига stage.
   */
  private async flushPendingRemindMails(now: Date): Promise<number> {
    const staleBefore = new Date(now.getTime() - 15_000);
    const pending = await this.prisma.orderEvent.findMany({
      where: {
        type: 'PAYMENT_REMIND',
        createdAt: { lt: staleBefore },
        OR: [
          { meta: { path: ['mailStatus'], equals: 'pending' } },
          { meta: { path: ['mailStatus'], equals: 'failed' } },
        ],
      },
      take: AWAITING_PAYMENT_REMIND_BATCH,
      orderBy: { createdAt: 'asc' },
      include: {
        order: {
          select: {
            id: true,
            number: true,
            email: true,
            total: true,
            guestId: true,
            status: true,
            createdAt: true,
            awaitingPaymentRemindStage: true,
          },
        },
      },
    });

    let sent = 0;
    const schedule = resolveAwaitingRemindSchedule({
      get: (k) => this.config.get<string>(k),
    });

    for (const ev of pending) {
      const order = ev.order;
      if (
        order.status !== OrderStatus.AWAITING_PAYMENT &&
        order.status !== OrderStatus.NEW
      ) {
        await this.markRemindMailStatus(ev.id, ev.meta, 'skipped', {
          lastError: `order status=${order.status}`,
        });
        continue;
      }
      const email = (order.email || '').trim();
      if (!email) {
        await this.markRemindMailStatus(ev.id, ev.meta, 'skipped', {
          lastError: 'empty email',
        });
        continue;
      }
      const meta = parseRemindMeta(ev.meta);
      const stage = meta?.stage ?? (order.awaitingPaymentRemindStage as 1 | 2 | 3);
      if (stage !== 1 && stage !== 2 && stage !== 3) continue;

      const cancelAtLabel =
        stage === 3
          ? formatCancelAtLabel(
              new Date(
                new Date(order.createdAt).getTime() + schedule.ttlMinutes * 60_000,
              ),
            )
          : undefined;

      const ok = await this.deliverRemindMail({
        eventId: ev.id,
        id: order.id,
        number: order.number,
        email,
        total: order.total,
        guestId: order.guestId,
        next: stage,
        cancelAtLabel,
        meta: meta ?? { stage, mailStatus: 'pending' },
      });
      if (ok) sent += 1;
    }
    return sent;
  }

  private async deliverRemindMail(order: {
    eventId: string;
    id: string;
    number: string;
    email: string;
    total: number;
    guestId: string | null;
    next: 1 | 2 | 3;
    cancelAtLabel?: string;
    meta: RemindOutboxMeta;
  }): Promise<boolean> {
    const guestIdForPay = order.guestId?.trim() || '';
    const payToken = guestIdForPay
      ? this.payTokens.issue(order.id, guestIdForPay)
      : null;
    const result = await this.lifecycle.notifyOrderAwaitingPayment({
      to: order.email,
      orderNumber: order.number,
      total: order.total,
      orderId: order.id,
      payToken,
      cancelAtLabel: order.cancelAtLabel,
      stage: order.next,
    });
    if (result === 'sent') {
      await this.markRemindMailStatus(order.eventId, order.meta, 'sent', {
        sentAt: new Date().toISOString(),
      });
      return true;
    }
    if (result === 'skipped') {
      await this.markRemindMailStatus(order.eventId, order.meta, 'skipped', {
        lastError: 'no SMTP',
      });
      return false;
    }
    await this.markRemindMailStatus(order.eventId, order.meta, 'failed', {
      lastError: 'smtp failed',
    });
    return false;
  }

  private async markRemindMailStatus(
    eventId: string,
    prevMeta: unknown,
    mailStatus: RemindMailStatus,
    extra: { sentAt?: string; lastError?: string } = {},
  ): Promise<void> {
    const base = parseRemindMeta(prevMeta) ?? {
      stage: 1 as const,
      mailStatus: 'pending' as const,
    };
    const meta: RemindOutboxMeta = {
      ...base,
      mailStatus,
      ...(extra.sentAt ? { sentAt: extra.sentAt } : {}),
      ...(extra.lastError ? { lastError: extra.lastError } : {}),
    };
    await this.prisma.orderEvent.update({
      where: { id: eventId },
      data: { meta: meta as Prisma.InputJsonValue },
    });
  }
}

function parseRemindMeta(raw: unknown): RemindOutboxMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const stage = o.stage;
  if (stage !== 1 && stage !== 2 && stage !== 3) return null;
  const mailStatus = o.mailStatus;
  const status: RemindMailStatus =
    mailStatus === 'sent' ||
    mailStatus === 'skipped' ||
    mailStatus === 'failed' ||
    mailStatus === 'pending'
      ? mailStatus
      : 'pending';
  const skipped = Array.isArray(o.skipped)
    ? o.skipped.filter((n): n is number => typeof n === 'number')
    : undefined;
  return {
    stage,
    mailStatus: status,
    ...(skipped?.length ? { skipped } : {}),
    ...(typeof o.sentAt === 'string' ? { sentAt: o.sentAt } : {}),
    ...(typeof o.lastError === 'string' ? { lastError: o.lastError } : {}),
  };
}
