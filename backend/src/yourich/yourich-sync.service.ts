import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildLeadFieldValuesName,
  computeYourichLeadEvent,
  computeYourichLeadSum,
} from './yourich-lead';
import { YourichClient, type YourichCrmLeadBody } from './yourich.client';

const MAX_ATTEMPTS = 12;

type LeadRow = {
  id: string;
  orderId: string;
  leadCrmId: string;
  refHash: string | null;
  extUserId: string | null;
  promoCodeRaw: string | null;
  offerId: number | null;
  leadId: number | null;
  lastSentEvent: string | null;
  lastSentSum: number | null;
  state: string;
  attempts: number;
  order: {
    id: string;
    number: string;
    status: OrderStatus;
    subtotal: number;
    discountTotal: number;
    giftCertificateAmount: number;
    refundedAmount: number;
    customerName: string | null;
    giftPurchaseDenominationId: string | null;
  };
};

function backoffMs(attempts: number): number {
  const mins = [1, 2, 5, 15, 30, 60, 120, 180, 360];
  const idx = Math.min(Math.max(0, attempts - 1), mins.length - 1);
  return mins[idx]! * 60_000;
}

@Injectable()
export class YourichSyncService {
  private readonly logger = new Logger(YourichSyncService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: YourichClient,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /** Поставить лид в очередь на скорую отправку (после PAID / cancel / refund). */
  async touch(orderId: string): Promise<void> {
    await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
      await this.prisma.orderAffiliateLead.updateMany({
        where: { orderId, state: { not: 'SKIPPED' } },
        data: { nextAttemptAt: new Date(), state: 'PENDING' },
      });
    });
  }

  async processDue(limit = 20): Promise<number> {
    if (!this.client.enabled()) return 0;
    if (!this.client.apiKey()) {
      this.logger.warn('YOURICH_ENABLED but YOURICH_API_KEY missing');
      return 0;
    }
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, () =>
        this.prisma.orderAffiliateLead.findMany({
          where: {
            state: { in: ['PENDING', 'ERROR'] },
            nextAttemptAt: { lte: new Date() },
          },
          orderBy: { nextAttemptAt: 'asc' },
          take: limit,
          include: {
            order: {
              select: {
                id: true,
                number: true,
                status: true,
                subtotal: true,
                discountTotal: true,
                giftCertificateAmount: true,
                refundedAmount: true,
                customerName: true,
                giftPurchaseDenominationId: true,
              },
            },
          },
        }),
      );

      let n = 0;
      for (const lead of due) {
        await this.syncOne(lead);
        n += 1;
      }
      return n;
    } finally {
      this.running = false;
    }
  }

  private async syncOne(lead: LeadRow): Promise<void> {
    const order = lead.order;
    if (order.giftPurchaseDenominationId) {
      await this.patchLead(lead.id, {
        state: 'SKIPPED',
        lastError: 'gift-only order',
        syncedAt: new Date(),
      });
      return;
    }

    const event = computeYourichLeadEvent(order.status);
    const sum = computeYourichLeadSum(order);
    if (lead.lastSentEvent === event && lead.lastSentSum === sum && lead.state === 'SYNCED') {
      return;
    }

    const body: YourichCrmLeadBody = {
      leadCrmId: lead.leadCrmId || order.number,
      leadSum: sum,
      event,
      leadFieldValues: buildLeadFieldValuesName(order.customerName),
    };
    if (lead.refHash?.trim()) body.yrRefLinkHash = lead.refHash.trim();
    if (lead.promoCodeRaw?.trim()) body.leadPromocode = lead.promoCodeRaw.trim();
    if (lead.extUserId?.trim()) body.lead_ext_id = lead.extUserId.trim();
    const offerId = lead.offerId ?? this.client.fallbackOfferId();
    if (offerId && !body.yrRefLinkHash && !body.leadPromocode) {
      body.offerId = offerId;
    }

    const result = await this.client.upsertCrmLead(body);
    const attempts = lead.attempts + 1;

    if (result.ok) {
      await this.patchLead(lead.id, {
        state: 'SYNCED',
        lastSentEvent: event,
        lastSentSum: sum,
        leadId: result.leadId ?? lead.leadId,
        attempts,
        lastError: null,
        lastHttpStatus: result.httpStatus,
        syncedAt: new Date(),
        nextAttemptAt: new Date(Date.now() + 24 * 60 * 60_000),
      });
      return;
    }

    const terminal = attempts >= MAX_ATTEMPTS || result.httpStatus === 401;
    const nextAttemptAt = new Date(Date.now() + backoffMs(attempts));
    await this.patchLead(lead.id, {
      state: 'ERROR',
      attempts,
      lastError: result.errorMessage,
      lastHttpStatus: result.httpStatus || null,
      nextAttemptAt: terminal ? new Date(Date.now() + 7 * 24 * 60 * 60_000) : nextAttemptAt,
    });

    if (terminal) {
      const msg = `YouRich sync failed order=${order.number} http=${result.httpStatus} err=${result.errorMessage}`;
      this.logger.error(`OPS_ALERT ${msg}`);
      await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
        await this.prisma.orderEvent.create({
          data: {
            orderId: order.id,
            type: 'OPS_ALERT',
            message: msg,
            meta: {
              kind: 'yourich_sync',
              httpStatus: result.httpStatus,
              error: result.errorMessage,
            },
          },
        });
      });
      await this.notifyOps(msg);
    }
  }

  private async patchLead(
    id: string,
    data: {
      state?: string;
      lastSentEvent?: string | null;
      lastSentSum?: number | null;
      leadId?: number | null;
      attempts?: number;
      lastError?: string | null;
      lastHttpStatus?: number | null;
      syncedAt?: Date | null;
      nextAttemptAt?: Date;
    },
  ) {
    await this.prisma.runInRlsTransaction({ userId: '', bypass: true }, async () => {
      await this.prisma.orderAffiliateLead.update({ where: { id }, data });
    });
  }

  private async notifyOps(text: string) {
    const to =
      this.config.get<string>('OPS_ALERT_EMAIL')?.trim() ||
      this.config.get<string>('SUPPORT_EMAIL')?.trim();
    if (!to || !this.mail.isConfigured()) {
      this.logger.warn('OPS_ALERT yourich: email skipped (no OPS_ALERT_EMAIL/SMTP)');
      return;
    }
    try {
      await this.mail.sendRaw({
        to,
        subject: '[OPS] YouRich sync failed',
        text,
        html: `<p>${text.replace(/</g, '&lt;')}</p>`,
      });
    } catch (e) {
      this.logger.warn(`OPS_ALERT yourich email failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
