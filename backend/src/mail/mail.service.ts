import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve4 } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as nodemailer from 'nodemailer';
import {
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
} from './email-templates';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

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

  /**
   * На VPS без маршрута IPv6 nodemailer может выбрать AAAA → ENETUNREACH.
   * По умолчанию подключаемся к первому A-записи и задаём servername для TLS/SNI.
   */
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
    await this.sendBuilt(
      params.to,
      buildOrderPaidEmail({
        orderNumber: params.orderNumber,
        siteUrl: this.frontendPublicUrl(),
        total: params.total,
        subtotal: params.subtotal,
        shippingCost: params.shippingCost,
        discountTotal: params.discountTotal,
        giftCertificateAmount: params.giftCertificateAmount,
        items: params.items,
      }),
    );
    this.logger.log(`Order paid email sent to ${params.to} (${params.orderNumber})`);
  }

  async sendOrderShipped(params: {
    to: string;
    orderNumber: string;
    tracking?: string | null;
  }): Promise<void> {
    await this.sendBuilt(
      params.to,
      buildOrderShippedEmail({
        orderNumber: params.orderNumber,
        tracking: params.tracking,
        siteUrl: this.frontendPublicUrl(),
      }),
    );
    this.logger.log(`Order shipped email sent to ${params.to} (${params.orderNumber})`);
  }

  async sendOrderDelivered(params: { to: string; orderNumber: string }): Promise<void> {
    await this.sendBuilt(
      params.to,
      buildOrderDeliveredEmail({
        orderNumber: params.orderNumber,
        siteUrl: this.frontendPublicUrl(),
      }),
    );
    this.logger.log(`Order delivered email sent to ${params.to} (${params.orderNumber})`);
  }

  async sendOrderCancelled(params: { to: string; orderNumber: string }): Promise<void> {
    await this.sendBuilt(
      params.to,
      buildOrderCancelledEmail({
        orderNumber: params.orderNumber,
        siteUrl: this.frontendPublicUrl(),
      }),
    );
    this.logger.log(`Order cancelled email sent to ${params.to} (${params.orderNumber})`);
  }

  async sendOrderUpdated(params: {
    to: string;
    orderNumber: string;
    changesSummary: string;
  }): Promise<void> {
    await this.sendBuilt(
      params.to,
      buildOrderUpdatedEmail({
        orderNumber: params.orderNumber,
        changesSummary: params.changesSummary,
        siteUrl: this.frontendPublicUrl(),
      }),
    );
    this.logger.log(`Order updated email sent to ${params.to} (${params.orderNumber})`);
  }

  async sendOrderSurcharge(params: {
    to: string;
    orderNumber: string;
    amount: number;
    paymentUrl: string;
  }): Promise<void> {
    await this.sendBuilt(
      params.to,
      buildOrderSurchargeEmail({
        orderNumber: params.orderNumber,
        amount: params.amount,
        paymentUrl: params.paymentUrl,
        siteUrl: this.frontendPublicUrl(),
      }),
    );
    this.logger.log(
      `Order surcharge email sent to ${params.to} (${params.orderNumber}, ${params.amount}₽)`,
    );
  }

  async sendOrderRefund(params: {
    to: string;
    orderNumber: string;
    amount: number;
    full?: boolean;
    kind?: 'admin' | 'late';
  }): Promise<void> {
    await this.sendBuilt(
      params.to,
      buildOrderRefundEmail({
        orderNumber: params.orderNumber,
        amount: params.amount,
        full: params.full,
        kind: params.kind,
        siteUrl: this.frontendPublicUrl(),
      }),
    );
    this.logger.log(`Order refund email sent to ${params.to} (${params.orderNumber})`);
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
