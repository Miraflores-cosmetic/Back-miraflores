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
  | 'CARRIER_COST'
  | 'ADDRESS_UPDATED'
  | 'ITEMS_UPDATED'
  | 'SURCHARGE_PAID'
  | 'PAYMENT_REMIND';

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

  /**
   * Outbox-aware: не глотает ошибку SMTP (в отличие от runMail).
   * `sent` | `skipped` (нет SMTP) | `failed`.
   */
  async notifyOrderAwaitingPayment(input: {
    to: string;
    orderNumber: string;
    total: number;
    orderId?: string;
    payToken?: string | null;
    payUrl?: string;
    cancelAtLabel?: string;
    /** 1 = 5м, 2 = 24ч, 3 = 48ч */
    stage?: 1 | 2 | 3;
  }): Promise<'sent' | 'skipped' | 'failed'> {
    const label = `Order awaiting payment mail stage=${input.stage ?? 1} ${input.orderNumber} → ${input.to}`;
    if (!this.mail.isConfigured()) {
      this.logger.warn(`${label} skipped (no SMTP)`);
      return 'skipped';
    }
    try {
      await this.mail.sendOrderAwaitingPayment({
        to: input.to,
        orderNumber: input.orderNumber,
        total: input.total,
        orderId: input.orderId,
        payToken: input.payToken,
        payUrl: input.payUrl,
        cancelAtLabel: input.cancelAtLabel,
        stage: input.stage,
      });
      return 'sent';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`${label} failed: ${msg}`);
      return 'failed';
    }
  }

  async notifyOrderPaid(to: string, orderNumber: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { number: orderNumber },
      select: {
        email: true,
        phone: true,
        customerName: true,
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
    if (order) {
      await this.notifyAdminOrderCopy({
        kind: 'paid',
        orderNumber,
        email: order.email,
        phone: order.phone,
        customerName: order.customerName,
        total: order.total,
      });
    }
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

  async notifyOrderCancelled(
    to: string,
    orderNumber: string,
    cancelReason?: string,
  ): Promise<void> {
    await this.runMail(`Order cancelled mail ${orderNumber} → ${to}`, () =>
      this.mail.sendOrderCancelled({ to, orderNumber, cancelReason }),
    );
    const order = await this.prisma.order.findUnique({
      where: { number: orderNumber },
      select: {
        email: true,
        phone: true,
        customerName: true,
        total: true,
      },
    });
    if (order) {
      await this.notifyAdminOrderCopy({
        kind: 'cancelled',
        orderNumber,
        email: order.email,
        phone: order.phone,
        customerName: order.customerName,
        total: order.total,
        cancelReason,
      });
    }
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
    const order = await this.prisma.order.findUnique({
      where: { number: input.orderNumber },
      select: {
        email: true,
        phone: true,
        customerName: true,
        total: true,
      },
    });
    if (order) {
      await this.notifyAdminOrderCopy({
        kind: 'refunded',
        orderNumber: input.orderNumber,
        email: order.email,
        phone: order.phone,
        customerName: order.customerName,
        total: order.total,
        refundAmount: input.amount,
      });
    }
  }

  /**
   * Ops-дубль админу при создании заказа (покупателю сразу не шлём).
   * Env: ORDER_ADMIN_NOTIFY_EMAIL (default mira-robot@miraflores-shop.ru).
   */
  async notifyAdminOrderCreated(orderNumber: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { number: orderNumber },
      select: {
        email: true,
        phone: true,
        customerName: true,
        total: true,
        items: {
          orderBy: { id: 'asc' },
          select: { title: true, qty: true, lineTotal: true },
        },
      },
    });
    if (!order) return;
    await this.notifyAdminOrderCopy({
      kind: 'created',
      orderNumber,
      email: order.email,
      phone: order.phone,
      customerName: order.customerName,
      total: order.total,
      items: order.items,
    });
  }

  private async notifyAdminOrderCopy(input: {
    kind: 'created' | 'paid' | 'cancelled' | 'refunded';
    orderNumber: string;
    email: string;
    phone: string;
    customerName?: string | null;
    total: number;
    items?: Array<{ title: string; qty: number; lineTotal: number }>;
    refundAmount?: number;
    cancelReason?: string | null;
  }): Promise<void> {
    await this.runMail(
      `Admin order notify kind=${input.kind} ${input.orderNumber}`,
      () => this.mail.sendAdminOrderNotify(input),
    );
  }

  async notifyGiftPurchasePaid(input: {
    to: string;
    orderNumber: string;
    items: Array<{ code: string; faceValue: number; expiresAt: Date | null }>;
    buyerEmail?: string;
  }): Promise<void> {
    await this.runMail(
      `Gift purchase paid mail ${input.orderNumber} → ${input.to}`,
      () => this.mail.sendGiftPurchasePaid(input),
    );
  }

  async notifyGiftBuyerCopy(input: {
    to: string;
    orderNumber: string;
    recipientEmail: string;
  }): Promise<void> {
    await this.runMail(
      `Gift buyer copy mail ${input.orderNumber} → ${input.to}`,
      () => this.mail.sendGiftBuyerCopy(input),
    );
  }

  async notifyGiftCertificateIssued(input: {
    to: string;
    items: Array<{ code: string; faceValue: number; expiresAt: Date | null }>;
    resend?: boolean;
  }): Promise<boolean> {
    if (!this.mail.isConfigured()) {
      this.logger.warn('Gift issued mail skipped (no SMTP)');
      return false;
    }
    try {
      await this.mail.sendGiftCertificateIssued(input);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Gift issued mail failed: ${msg}`);
      return false;
    }
  }
}
