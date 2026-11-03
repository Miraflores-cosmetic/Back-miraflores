import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  nextAwaitingRemindStage,
  paymentRemindEventMessage,
  resolveAwaitingRemindSchedule,
  skippedAwaitingRemindStages,
} from './order-awaiting-payment-schedule';
import {
  AWAITING_PAYMENT_REMIND_BATCH,
  claimAwaitingPaymentRemindCandidates,
  countDueAwaitingPaymentReminders,
} from './order-lock';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderPayTokenService } from './order-pay-token.service';

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
 * Напоминания об оплате (5м / 24ч / 48ч). Авто-отмена по TTL отключена —
 * только ручная отмена админом; 72ч — порог «просрочено» в UI.
 * Outbox: bump + PAYMENT_REMIND(mailStatus=pending) в tx → SMTP → mark sent;
 * при fail SMTP stage уже bumped, retry по pending events (без дубля stage).
 */
@Injectable()
export class OrderAwaitingPaymentService {
  private readonly logger = new Logger(OrderAwaitingPaymentService.name);
  private lastRemindBacklogAlertAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly payTokens: OrderPayTokenService,
  ) {}

  /** Сколько заказов due на remind (метрика backlog). */
  async countRemindBacklog(now = new Date()): Promise<number> {
    const schedule = resolveAwaitingRemindSchedule({
      get: (k) => this.config.get<string>(k),
    });
    return countDueAwaitingPaymentReminders(this.prisma, {
      now,
      remind1Minutes: schedule.remind1Minutes,
      remind2Minutes: schedule.remind2Minutes,
      remind3Minutes: schedule.remind3Minutes,
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

  private async sendRemindBacklogOpsAlert(input: {
    dueCount: number;
    batch: number;
    envKey: string;
    threshold: number;
  }): Promise<void> {
    const { dueCount, batch, envKey, threshold } = input;
    if (threshold <= 0 || dueCount <= threshold) return;

    const lagTicks = Math.ceil((dueCount - batch) / batch);
    const msg = `awaiting_remind_backlog due=${dueCount} batch=${batch} lag_ticks≈${Math.max(0, lagTicks)}`;
    this.logger.error(`OPS_ALERT ${msg}`);

    const now = Date.now();
    if (now - this.lastRemindBacklogAlertAt < BACKLOG_ALERT_THROTTLE_MS) {
      this.logger.warn(`OPS_ALERT ${msg} (email throttled)`);
      return;
    }
    this.lastRemindBacklogAlertAt = now;

    const opsTo = (
      this.config.get<string>('OPS_ALERT_EMAIL') ||
      this.config.get<string>('SUPPORT_EMAIL') ||
      ''
    ).trim();
    if (!opsTo) {
      this.logger.warn(
        `OPS_ALERT awaiting_remind_backlog: set OPS_ALERT_EMAIL or SUPPORT_EMAIL`,
      );
      return;
    }
    await this.lifecycle.notifyCustomer({
      to: opsTo,
      subject: `[OPS] Payment remind backlog — ${dueCount} due`,
      text: [
        `Очередь напоминаний об оплате отстаёт.`,
        `due: ${dueCount} (batch ${batch}/мин)`,
        `≈${Math.max(1, lagTicks)} мин отставания при текущем tick.`,
        `Env: ${envKey}=${threshold}`,
      ].join('\n'),
      html: `<p><strong>OPS: awaiting_remind_backlog</strong></p>
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
    await this.sendRemindBacklogOpsAlert({
      dueCount,
      batch: AWAITING_PAYMENT_REMIND_BATCH,
      envKey: 'ORDER_PAY_REMIND_BACKLOG_ALERT',
      threshold,
    });
  }

  /**
   * Напоминания: stage 1 (5м), 2 (24ч), 3 (48ч).
   * Catch-up (осознанно): один tick → высший overdue stage; 5м/24ч тексты
   * пропускаются, OrderEvent meta.skipped фиксирует это.
   * Outbox: bump + event(pending) → SMTP → mailStatus=sent; fail → retry next tick.
   */
  async processAwaitingPaymentReminders(now = new Date()): Promise<number> {
    const schedule = resolveAwaitingRemindSchedule({
      get: (k) => this.config.get<string>(k),
    });
    const dueOpts = {
      now,
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
          message: paymentRemindEventMessage(next, skipped),
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

      const ok = await this.deliverRemindMail({
        eventId: ev.id,
        id: order.id,
        number: order.number,
        email,
        total: order.total,
        guestId: order.guestId,
        next: stage,
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
