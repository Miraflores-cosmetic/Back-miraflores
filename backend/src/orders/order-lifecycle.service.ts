import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

export type OrderEventType =
  | 'CREATED'
  | 'PAID'
  | 'MARK_PAID'
  | 'STATUS_CHANGED'
  | 'CANCELLED'
  | 'SHIPPED'
  | 'TRACKING_SENT'
  | 'DELIVERED'
  | 'REFUND'
  | 'NOTE'
  | 'OPS_ALERT'
  | 'CARRIER_REGISTERED'
  | 'ADDRESS_UPDATED'
  | 'ITEMS_UPDATED'
  | 'SURCHARGE_PAID';

@Injectable()
export class OrderLifecycleService {
  private readonly logger = new Logger(OrderLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async addEvent(
    tx: Prisma.TransactionClient | PrismaService,
    input: {
      orderId: string;
      type: OrderEventType;
      message: string;
      actorUserId?: string | null;
      meta?: Prisma.InputJsonValue;
    },
  ) {
    return tx.orderEvent.create({
      data: {
        orderId: input.orderId,
        type: input.type,
        message: input.message,
        actorUserId: input.actorUserId ?? null,
        meta: input.meta ?? undefined,
      },
    });
  }

  async notifyCustomer(input: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    if (!this.mail.isConfigured()) {
      this.logger.warn(`Order mail skipped (no SMTP): ${input.subject} → ${input.to}`);
      return;
    }
    try {
      await this.mail.sendRaw(input);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Order mail failed: ${msg}`);
    }
  }

  private async runMail(
    label: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    if (!this.mail.isConfigured()) {
      this.logger.warn(`${label} skipped (no SMTP)`);
      return;
    }
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`${label} failed: ${msg}`);
    }
  }

  async notifyOrderPaid(to: string, orderNumber: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { number: orderNumber },
      select: {
        total: true,
        subtotal: true,
        shippingCost: true,
        discountTotal: true,
        giftCertificateAmount: true,
        items: {
          orderBy: { id: 'asc' },
          select: {
            title: true,
            qty: true,
            lineTotal: true,
            isGratitudeGift: true,
          },
        },
      },
    });
    await this.runMail(`Order paid mail ${orderNumber} → ${to}`, () =>
      this.mail.sendOrderPaid({
        to,
        orderNumber,
        total: order?.total,
        subtotal: order?.subtotal,
        shippingCost: order?.shippingCost,
        discountTotal: order?.discountTotal,
        giftCertificateAmount: order?.giftCertificateAmount,
        items: order?.items.map((it) => ({
          title: it.title,
          qty: it.qty,
          lineTotal: it.lineTotal,
          isGratitudeGift: it.isGratitudeGift,
        })),
      }),
    );
  }

  async notifyOrderShipped(
    to: string,
    orderNumber: string,
    tracking?: string | null,
  ): Promise<void> {
    await this.runMail(`Order shipped mail ${orderNumber} → ${to}`, () =>
      this.mail.sendOrderShipped({ to, orderNumber, tracking }),
    );
  }

  async notifyOrderDelivered(to: string, orderNumber: string): Promise<void> {
    await this.runMail(`Order delivered mail ${orderNumber} → ${to}`, () =>
      this.mail.sendOrderDelivered({ to, orderNumber }),
    );
  }

  async notifyOrderCancelled(to: string, orderNumber: string): Promise<void> {
    await this.runMail(`Order cancelled mail ${orderNumber} → ${to}`, () =>
      this.mail.sendOrderCancelled({ to, orderNumber }),
    );
  }

  async notifyOrderUpdated(input: {
    to: string;
    orderNumber: string;
    changesSummary: string;
  }): Promise<void> {
    await this.runMail(
      `Order updated mail ${input.orderNumber} → ${input.to}`,
      () => this.mail.sendOrderUpdated(input),
    );
  }

  async notifyOrderSurcharge(input: {
    to: string;
    orderNumber: string;
    amount: number;
    paymentUrl: string;
  }): Promise<void> {
    await this.runMail(
      `Order surcharge mail ${input.orderNumber} → ${input.to}`,
      () => this.mail.sendOrderSurcharge(input),
    );
  }

  async notifyOrderRefund(input: {
    to: string;
    orderNumber: string;
    amount: number;
    full?: boolean;
    kind?: 'admin' | 'late';
  }): Promise<void> {
    await this.runMail(
      `Order refund mail ${input.orderNumber} → ${input.to}`,
      () => this.mail.sendOrderRefund(input),
    );
  }
}
