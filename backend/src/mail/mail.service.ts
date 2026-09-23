import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve4 } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as nodemailer from 'nodemailer';
import {
  getEmailNotificationEventDef,
  type EmailNotificationEventKey,
} from './email-notification-events';
import {
  baseOrderVars,
  formatGiftItemsHtml,
  formatGiftItemsText,
  guestOrderPayUrl,
  rubLabel,
} from './email-notification-format';
import {
  renderEditableEmail,
  type EmailTemplateVars,
} from './email-notification-render';
import {
  EmailNotificationsService,
  type EmailSendPath,
} from './email-notifications.service';
import {
  buildGiftBuyerCopyEmail,
  buildGiftCertificateIssuedEmail,
  buildGiftPurchasePaidEmail,
  buildOrderCancelledEmail,
  buildOrderDeliveredEmail,
  buildOrderPaidEmail,
  buildOrderRefundEmail,
  buildOrderShippedEmail,
  buildOrderSurchargeEmail,
  buildOrderUpdatedEmail,
  buildPasswordResetEmail,
  buildRegistrationOtpEmail,
  buildStaffAdminPasswordResetEmail,
  buildStaffAdminWelcomeEmail,
  type BuiltEmail,
  type GiftEmailCertItem,
} from './email-templates';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly emailNotifications: EmailNotificationsService,
  ) {}

  frontendPublicUrl(): string {
    return (
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.trim().replace(/\/+$/, '') ||
      'http://localhost:5173'
    );
  }

  isConfigured(): boolean {
    const host = this.config.get<string>('SMTP_HOST')?.trim();
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const pass = (this.config.get<string>('SMTP_PASSWORD') ?? '').replace(/\s/g, '');
    return Boolean(host && user && pass);
  }

  private async smtpConnectTarget(hostname: string): Promise<{ host: string; servername?: string }> {
    const raw = String(this.config.get('SMTP_FORCE_IPV4', 'true')).toLowerCase();
    const forceIpv4 = !['0', 'false', 'no', 'off'].includes(raw);
    if (!forceIpv4 || isIP(hostname)) {
      return { host: hostname };
    }
    try {
      const v4 = await resolve4(hostname);
      if (!v4.length) {
        this.logger.warn(`SMTP_FORCE_IPV4: нет A-записей для ${hostname}, подключаемся по имени`);
        return { host: hostname };
      }
      return { host: v4[0], servername: hostname };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`SMTP_FORCE_IPV4: resolve4(${hostname}) — ${msg}, подключаемся по имени`);
    }
    return { host: hostname };
  }

  private transporter(target: { host: string; servername?: string }) {
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const passRaw = this.config.get<string>('SMTP_PASSWORD') ?? '';
    const pass = passRaw.replace(/\s/g, '');
    if (!target.host || !user || !pass) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const port = Number(this.config.get('SMTP_PORT', 465));
    const secure =
      String(this.config.get('SMTP_SECURE', 'true')).toLowerCase() === 'true' || port === 465;
    const requireTls =
      port === 587 &&
      !['0', 'false', 'no', 'off'].includes(
        String(this.config.get('SMTP_REQUIRE_TLS', 'true')).toLowerCase(),
      );
    return nodemailer.createTransport({
      host: target.host,
      ...(target.servername ? { servername: target.servername } : {}),
      port,
      secure,
      auth: { user, pass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 15_000,
      ...(requireTls ? { requireTLS: true } : {}),
    });
  }

  private async send(params: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    const from =
      this.config.get<string>('MAIL_FROM')?.trim() ||
      this.config.get<string>('SMTP_USER')?.trim();
    if (!from) {
      throw new Error('MAIL_FROM или SMTP_USER нужен для отправки почты');
    }
    const replyTo = this.config.get<string>('MAIL_REPLY_TO')?.trim() || undefined;
    const configuredHost = this.config.get<string>('SMTP_HOST')?.trim();
    if (!configuredHost) {
      throw new Error('SMTP_HOST, SMTP_USER и SMTP_PASSWORD должны быть заданы для отправки почты');
    }
    const endpoint = await this.smtpConnectTarget(configuredHost);
    const transport = this.transporter(endpoint);
    await transport.sendMail({
      from,
      ...(replyTo ? { replyTo } : {}),
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
  }

  async sendRaw(params: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    await this.send(params);
  }

  private async sendBuilt(to: string, built: BuiltEmail): Promise<void> {
    await this.send({ to, ...built });
  }

  /**
   * Клиентские письма (заказы/сертификаты): шаблон из БД.
   * Auth OTP / password / staff / OPS — не сюда (hardcoded builders).
   * Выключенный event → skipped_disabled.
   * Ошибка рендера/БД → rendered_legacy.
   * Успех БД → rendered_db. Оба пути упали → failed.
   */
  private async sendNotification(
    to: string,
    eventKey: EmailNotificationEventKey,
    vars: EmailTemplateVars,
    context: string,
    fallback: () => BuiltEmail,
  ): Promise<void> {
    const base = `email_notification event=${eventKey} to=${to} ${context}`;
    const notePath = (path: EmailSendPath, extra = '') => {
      this.logger.log(`${base} path=${path}${extra ? ` ${extra}` : ''}`);
      void this.emailNotifications.recordSendPath(eventKey, path).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`${base} recordSendPath failed: ${msg}`);
      });
    };

    try {
      const built = await this.emailNotifications.buildForEvent(eventKey, vars);
      if (!built) {
        notePath('skipped_disabled');
        return;
      }
      await this.sendBuilt(to, built);
      notePath('rendered_db');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`${base} path=rendered_legacy reason=${msg}`);
      try {
        await this.sendBuilt(to, fallback());
        notePath('rendered_legacy', `reason=${msg}`);
      } catch (e2) {
        const msg2 = e2 instanceof Error ? e2.message : String(e2);
        notePath('failed', `reason=${msg2}`);
        throw e2;
      }
    }
  }

  async sendRegistrationOtp(to: string, code: string): Promise<void> {
    await this.sendBuilt(
      to,
      buildRegistrationOtpEmail({ code, siteUrl: this.frontendPublicUrl() }),
    );
    this.logger.log(`Registration OTP email sent to ${to}`);
  }

  async sendPasswordResetLink(params: { to: string; resetLink: string }): Promise<void> {
    await this.sendBuilt(
      params.to,
      buildPasswordResetEmail({
        resetLink: params.resetLink,
        siteUrl: this.frontendPublicUrl(),
      }),
    );
    this.logger.log(`Password reset email sent to ${params.to}`);
  }

  async sendOrderAwaitingPayment(params: {
    to: string;
    orderNumber: string;
    total: number;
    reserveHours?: number;
    /** Deep-link `/order/pay` (не confirmation URL ЮKassa). */
    payUrl?: string;
    /** Для сборки guest deep-link `/order/pay?...`. */
    orderId?: string;
    payToken?: string | null;
  }): Promise<void> {
    const site = this.frontendPublicUrl();
    const minutes = Number.parseInt(
      this.config.get<string>('ORDER_AWAITING_TTL_MINUTES') || '60',
      10,
    );
    const reserveHours =
      params.reserveHours ??
      Math.max(1, Math.ceil((Number.isFinite(minutes) ? minutes : 60) / 60));

    let payUrl = (params.payUrl || '').trim();
    const payToken = params.payToken?.trim() || '';
    const orderId = params.orderId?.trim() || '';
    if (!payUrl && payToken && orderId) {
      payUrl = guestOrderPayUrl({
        siteUrl: site,
        orderId,
        orderNumber: params.orderNumber,
        payToken,
      });
    }

    const vars = baseOrderVars({
      orderNumber: params.orderNumber,
      siteUrl: site,
      total: params.total,
      payUrl: payUrl || undefined,
      reserveHours,
    });
    const def = getEmailNotificationEventDef('order_awaiting_payment');
    await this.sendNotification(
      params.to,
      'order_awaiting_payment',
      vars,
      `order=${params.orderNumber}`,
      () =>
        renderEditableEmail({
          subjectTemplate: def.defaultSubject,
          bodyTemplate: def.defaultBody,
          vars,
          siteUrl: site,
        }),
    );
  }

  async sendOrderPaid(params: {
    to: string;
    orderNumber: string;
    total?: number;
    subtotal?: number;
    shippingCost?: number;
    discountTotal?: number;
    giftCertificateAmount?: number;
    items?: Array<{
      title: string;
      qty: number;
      lineTotal: number;
      isGratitudeGift?: boolean;
    }>;
  }): Promise<void> {
    const site = this.frontendPublicUrl();
    await this.sendNotification(
      params.to,
      'order_paid',
      baseOrderVars({
        orderNumber: params.orderNumber,
        siteUrl: site,
        total: params.total,
        subtotal: params.subtotal,
        shippingCost: params.shippingCost,
        discountTotal: params.discountTotal,
        giftCertificateAmount: params.giftCertificateAmount,
        items: params.items,
      }),
      `order=${params.orderNumber}`,
      () =>
        buildOrderPaidEmail({
          orderNumber: params.orderNumber,
          siteUrl: site,
          total: params.total,
          subtotal: params.subtotal,
          shippingCost: params.shippingCost,
          discountTotal: params.discountTotal,
          giftCertificateAmount: params.giftCertificateAmount,
          items: params.items,
        }),
    );
  }

  async sendOrderShipped(params: {
    to: string;
    orderNumber: string;
    tracking?: string | null;
  }): Promise<void> {
    const site = this.frontendPublicUrl();
    await this.sendNotification(
      params.to,
      'order_shipped',
      baseOrderVars({
        orderNumber: params.orderNumber,
        siteUrl: site,
        tracking: params.tracking,
      }),
      `order=${params.orderNumber}`,
      () =>
        buildOrderShippedEmail({
          orderNumber: params.orderNumber,
          tracking: params.tracking,
          siteUrl: site,
        }),
    );
  }

  async sendOrderDelivered(params: { to: string; orderNumber: string }): Promise<void> {
    const site = this.frontendPublicUrl();
    await this.sendNotification(
      params.to,
      'order_delivered',
      baseOrderVars({
        orderNumber: params.orderNumber,
        siteUrl: site,
      }),
      `order=${params.orderNumber}`,
      () =>
        buildOrderDeliveredEmail({
          orderNumber: params.orderNumber,
          siteUrl: site,
        }),
    );
  }

  async sendOrderCancelled(params: { to: string; orderNumber: string }): Promise<void> {
    const site = this.frontendPublicUrl();
    await this.sendNotification(
      params.to,
      'order_cancelled',
      baseOrderVars({
        orderNumber: params.orderNumber,
        siteUrl: site,
      }),
      `order=${params.orderNumber}`,
      () =>
        buildOrderCancelledEmail({
          orderNumber: params.orderNumber,
          siteUrl: site,
        }),
    );
  }

  async sendOrderUpdated(params: {
    to: string;
    orderNumber: string;
    changesSummary: string;
  }): Promise<void> {
    const site = this.frontendPublicUrl();
    await this.sendNotification(
      params.to,
      'order_updated',
      baseOrderVars({
        orderNumber: params.orderNumber,
        siteUrl: site,
        changesSummary: params.changesSummary,
      }),
      `order=${params.orderNumber}`,
      () =>
        buildOrderUpdatedEmail({
          orderNumber: params.orderNumber,
          changesSummary: params.changesSummary,
          siteUrl: site,
        }),
    );
  }

  async sendOrderSurcharge(params: {
    to: string;
    orderNumber: string;
    amount: number;
    paymentUrl: string;
  }): Promise<void> {
    const site = this.frontendPublicUrl();
    await this.sendNotification(
      params.to,
      'order_surcharge',
      {
        ...baseOrderVars({
          orderNumber: params.orderNumber,
          siteUrl: site,
          payUrl: params.paymentUrl,
        }),
        'order.surcharge_label': rubLabel(params.amount),
      },
      `order=${params.orderNumber}`,
      () =>
        buildOrderSurchargeEmail({
          orderNumber: params.orderNumber,
          amount: params.amount,
          paymentUrl: params.paymentUrl,
          siteUrl: site,
        }),
    );
  }

  async sendOrderRefund(params: {
    to: string;
    orderNumber: string;
    amount: number;
    full?: boolean;
    kind?: 'admin' | 'late';
  }): Promise<void> {
    const kind = params.kind ?? 'admin';
    const site = this.frontendPublicUrl();
    await this.sendNotification(
      params.to,
      'order_refund',
      baseOrderVars({
        orderNumber: params.orderNumber,
        siteUrl: site,
        refundAmount: params.amount,
        refundFull: params.full,
        refundKind: kind,
      }),
      `order=${params.orderNumber}`,
      () =>
        buildOrderRefundEmail({
          orderNumber: params.orderNumber,
          amount: params.amount,
          full: params.full,
          kind,
          siteUrl: site,
        }),
    );
  }

  async sendGiftPurchasePaid(params: {
    to: string;
    orderNumber: string;
    items: GiftEmailCertItem[];
    buyerEmail?: string;
  }): Promise<void> {
    const site = this.frontendPublicUrl();
    await this.sendNotification(
      params.to,
      'gift_purchase_paid',
      {
        ...baseOrderVars({
          orderNumber: params.orderNumber,
          siteUrl: site,
        }),
        'gift.items_text': formatGiftItemsText(params.items),
        'gift.items_html': formatGiftItemsHtml(params.items),
        'gift.buyer_email': (params.buyerEmail || '').trim(),
      },
      `order=${params.orderNumber}`,
      () =>
        buildGiftPurchasePaidEmail({
          orderNumber: params.orderNumber,
          items: params.items,
          buyerEmail: params.buyerEmail,
          siteUrl: site,
        }),
    );
  }

  async sendGiftBuyerCopy(params: {
    to: string;
    orderNumber: string;
    recipientEmail: string;
  }): Promise<void> {
    const site = this.frontendPublicUrl();
    await this.sendNotification(
      params.to,
      'gift_buyer_copy',
      {
        ...baseOrderVars({
          orderNumber: params.orderNumber,
          siteUrl: site,
        }),
        'gift.recipient_email': params.recipientEmail.trim(),
      },
      `order=${params.orderNumber}`,
      () =>
        buildGiftBuyerCopyEmail({
          orderNumber: params.orderNumber,
          recipientEmail: params.recipientEmail,
          siteUrl: site,
        }),
    );
  }

  async sendGiftCertificateIssued(params: {
    to: string;
    items: GiftEmailCertItem[];
    resend?: boolean;
  }): Promise<void> {
    const plural = params.items.length > 1;
    const resend = Boolean(params.resend);
    const intro = resend
      ? 'Повторно отправляем данные вашего подарочного сертификата Miraflores.'
      : plural
        ? 'Вам выпущены подарочные сертификаты Miraflores.'
        : 'Вам выпущен подарочный сертификат Miraflores.';
    const site = this.frontendPublicUrl();
    await this.sendNotification(
      params.to,
      'gift_issued',
      {
        'site.url': site,
        'gift.items_text': formatGiftItemsText(params.items),
        'gift.items_html': formatGiftItemsHtml(params.items),
        'gift.intro': intro,
      },
      `items=${params.items.length}`,
      () =>
        buildGiftCertificateIssuedEmail({
          items: params.items,
          resend,
          siteUrl: site,
        }),
    );
  }

  async sendStaffAdminWelcome(params: {
    to: string;
    password: string;
    loginUrl: string;
    staffDisplayName?: string | null;
  }): Promise<void> {
    await this.sendBuilt(
      params.to,
      buildStaffAdminWelcomeEmail({
        ...params,
        siteUrl: this.frontendPublicUrl(),
      }),
    );
    this.logger.log(`Staff admin welcome email sent to ${params.to}`);
  }

  async sendStaffAdminPasswordReset(params: {
    to: string;
    password: string;
    loginUrl: string;
    staffDisplayName?: string | null;
  }): Promise<void> {
    await this.sendBuilt(
      params.to,
      buildStaffAdminPasswordResetEmail({
        ...params,
        siteUrl: this.frontendPublicUrl(),
      }),
    );
    this.logger.log(`Staff admin password reset email sent to ${params.to}`);
  }
}
