import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMAIL_GLOBAL_ALLOWED_KEYS,
  EMAIL_NOTIFICATION_EVENTS,
  getEmailNotificationEventDef,
  isEmailNotificationEventKey,
  type EmailNotificationEventKey,
} from './email-notification-events';
import {
  accountOrderChatUrl,
  accountOrdersUrl,
  accountSupportChatUrl,
  baseOrderVars,
  formatGiftItemsHtml,
  formatGiftItemsText,
  formatOrderItemsHtml,
  formatOrderItemsText,
  rubLabel,
} from './email-notification-format';
import { MAIL_BRAND } from './email-layout';
import {
  extractIfConditionKeys,
  extractTemplatePlaceholders,
  isEmailIfAllowedKey,
  renderEditableEmail,
  type EmailTemplateVars,
} from './email-notification-render';
import type { BuiltEmail } from './email-templates';
import { ConfigService } from '@nestjs/config';

export type EmailSendPath =
  | 'skipped_disabled'
  | 'rendered_db'
  | 'rendered_legacy'
  | 'failed';

export type EmailNotificationListItem = {
  eventKey: EmailNotificationEventKey;
  label: string;
  description: string;
  enabled: boolean;
  updatedAt: string | null;
  isCustomized: boolean;
  lastSendPath: EmailSendPath | null;
  lastSendAt: string | null;
  lastEditedByEmail: string | null;
  lastEditedAt: string | null;
};

export type EmailNotificationDetail = {
  eventKey: EmailNotificationEventKey;
  label: string;
  description: string;
  enabled: boolean;
  subject: string;
  body: string;
  defaultSubject: string;
  defaultBody: string;
  variables: { key: string; label: string }[];
  /** Ключи из variables, для которых разрешён {{#if key}}. */
  conditionKeys: string[];
  updatedAt: string | null;
  isCustomized: boolean;
  lastSendPath: EmailSendPath | null;
  lastSendAt: string | null;
  lastEditedByEmail: string | null;
  lastEditedByUserId: string | null;
  lastEditedAt: string | null;
};

export type EmailNotificationRevisionItem = {
  id: string;
  eventKey: string;
  subject: string;
  body: string;
  enabled: boolean;
  actorUserId: string | null;
  actorEmail: string | null;
  createdAt: string;
};

export type EmailTemplateActor = {
  userId: string;
  email?: string | null;
};

type TemplateRowCache = {
  enabled: boolean;
  subject: string;
  body: string;
  expiresAt: number;
};

/** TTL кэша строк шаблона для hot path send (инвалидация на update). */
const TEMPLATE_ROW_TTL_MS = 60_000;

@Injectable()
export class EmailNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(EmailNotificationsService.name);
  private seedPromise: Promise<void> | null = null;
  /** После boot/ensureDefaults — send path не дергает seed на каждый send. */
  private defaultsReady = false;
  private readonly rowCache = new Map<EmailNotificationEventKey, TemplateRowCache>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureDefaults();
      this.logger.log(
        `Email notification defaults ready (${EMAIL_NOTIFICATION_EVENTS.length} events)`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ensureDefaults on boot failed: ${msg}`);
    }
  }

  private frontendPublicUrl(): string {
    return (
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.trim().replace(/\/+$/, '') ||
      'https://miraflores-shop.com'
    );
  }

  /** Идемпотентно создаёт отсутствующие eventKey из реестра (не трогает существующие). */
  async ensureDefaults(): Promise<void> {
    if (this.defaultsReady) return;
    if (!this.seedPromise) {
      this.seedPromise = this.seedMissing()
        .then(() => {
          this.defaultsReady = true;
        })
        .finally(() => {
          this.seedPromise = null;
        });
    }
    await this.seedPromise;
  }

  private async seedMissing(): Promise<void> {
    const existing = await this.prisma.emailNotificationTemplate.findMany({
      select: { eventKey: true },
    });
    const have = new Set(existing.map((r) => r.eventKey));
    const missing = EMAIL_NOTIFICATION_EVENTS.filter((e) => !have.has(e.key));
    if (!missing.length) return;
    await this.prisma.emailNotificationTemplate.createMany({
      data: missing.map((e) => ({
        eventKey: e.key,
        enabled: true,
        subject: e.defaultSubject,
        body: e.defaultBody,
      })),
      skipDuplicates: true,
    });
  }

  private invalidateRowCache(eventKey?: EmailNotificationEventKey): void {
    if (eventKey) this.rowCache.delete(eventKey);
    else this.rowCache.clear();
  }

  /** Строка шаблона с TTL; для send path. */
  private async getCachedTemplateRow(
    eventKey: EmailNotificationEventKey,
  ): Promise<{ enabled: boolean; subject: string; body: string }> {
    const now = Date.now();
    const hit = this.rowCache.get(eventKey);
    if (hit && hit.expiresAt > now) {
      return { enabled: hit.enabled, subject: hit.subject, body: hit.body };
    }

    if (!this.defaultsReady) {
      await this.ensureDefaults();
    }

    const def = getEmailNotificationEventDef(eventKey);
    const row = await this.prisma.emailNotificationTemplate.findUnique({
      where: { eventKey },
      select: { enabled: true, subject: true, body: true },
    });
    const entry: TemplateRowCache = {
      enabled: row?.enabled ?? true,
      subject: row?.subject ?? def.defaultSubject,
      body: row?.body ?? def.defaultBody,
      expiresAt: now + TEMPLATE_ROW_TTL_MS,
    };
    this.rowCache.set(eventKey, entry);
    return entry;
  }

  private validateTemplateText(opts: {
    eventKey: EmailNotificationEventKey;
    subject: string;
    body: string;
  }): void {
    const def = getEmailNotificationEventDef(opts.eventKey);
    const allowed = new Set(def.variables.map((v) => v.key));
    for (const k of EMAIL_GLOBAL_ALLOWED_KEYS) allowed.add(k);

    const ifKeys = extractIfConditionKeys(opts.subject, opts.body);
    const badIf = ifKeys.filter((k) => !isEmailIfAllowedKey(k));
    if (badIf.length) {
      throw new BadRequestException(
        `Недопустимые условия: ${badIf.map((k) => `{{#if ${k}}}`).join(', ')}`,
      );
    }

    const used = extractTemplatePlaceholders(opts.subject, opts.body);
    const unknown = used.filter((k) => !allowed.has(k));
    if (unknown.length) {
      throw new BadRequestException(
        `Неизвестные переменные: ${unknown.map((k) => `{{${k}}}`).join(', ')}`,
      );
    }
  }

  async list(): Promise<EmailNotificationListItem[]> {
    await this.ensureDefaults();
    const rows = await this.prisma.emailNotificationTemplate.findMany();
    const byKey = new Map(rows.map((r) => [r.eventKey, r]));
    return EMAIL_NOTIFICATION_EVENTS.map((def) => {
      const row = byKey.get(def.key);
      const subject = row?.subject ?? def.defaultSubject;
      const body = row?.body ?? def.defaultBody;
      const isCustomized =
        Boolean(row) &&
        (subject !== def.defaultSubject || body !== def.defaultBody);
      return {
        eventKey: def.key,
        label: def.label,
        description: def.description,
        enabled: row?.enabled ?? true,
        updatedAt: row?.updatedAt?.toISOString() ?? null,
        isCustomized,
        lastSendPath: (row?.lastSendPath as EmailSendPath | null) ?? null,
        lastSendAt: row?.lastSendAt?.toISOString() ?? null,
        lastEditedByEmail: row?.lastEditedByEmail ?? null,
        lastEditedAt: row?.lastEditedAt?.toISOString() ?? null,
      };
    });
  }

  async get(eventKey: string): Promise<EmailNotificationDetail> {
    if (!isEmailNotificationEventKey(eventKey)) {
      throw new NotFoundException('Неизвестное событие уведомления');
    }
    await this.ensureDefaults();
    const def = getEmailNotificationEventDef(eventKey);
    const row = await this.prisma.emailNotificationTemplate.findUnique({
      where: { eventKey },
    });
    const subject = row?.subject ?? def.defaultSubject;
    const body = row?.body ?? def.defaultBody;
    const seen = new Set<string>();
    const variables: { key: string; label: string }[] = [];
    for (const v of def.variables) {
      if (seen.has(v.key)) continue;
      seen.add(v.key);
      variables.push({ key: v.key, label: v.label });
    }
    const conditionKeys = variables
      .map((v) => v.key)
      .filter((k) => isEmailIfAllowedKey(k));
    return {
      eventKey: def.key,
      label: def.label,
      description: def.description,
      enabled: row?.enabled ?? true,
      subject,
      body,
      defaultSubject: def.defaultSubject,
      defaultBody: def.defaultBody,
      variables,
      conditionKeys,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      isCustomized:
        Boolean(row) &&
        (subject !== def.defaultSubject || body !== def.defaultBody),
      lastSendPath: (row?.lastSendPath as EmailSendPath | null) ?? null,
      lastSendAt: row?.lastSendAt?.toISOString() ?? null,
      lastEditedByEmail: row?.lastEditedByEmail ?? null,
      lastEditedByUserId: row?.lastEditedByUserId ?? null,
      lastEditedAt: row?.lastEditedAt?.toISOString() ?? null,
    };
  }

  async listRevisions(
    eventKey: string,
    limit = 20,
  ): Promise<EmailNotificationRevisionItem[]> {
    if (!isEmailNotificationEventKey(eventKey)) {
      throw new NotFoundException('Неизвестное событие уведомления');
    }
    const take = Math.min(50, Math.max(1, limit));
    const rows = await this.prisma.emailNotificationTemplateRevision.findMany({
      where: { eventKey },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return rows.map((r) => ({
      id: r.id,
      eventKey: r.eventKey,
      subject: r.subject,
      body: r.body,
      enabled: r.enabled,
      actorUserId: r.actorUserId,
      actorEmail: r.actorEmail,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async update(
    eventKey: string,
    dto: { enabled?: boolean; subject?: string; body?: string },
    actor?: EmailTemplateActor | null,
  ): Promise<EmailNotificationDetail> {
    if (!isEmailNotificationEventKey(eventKey)) {
      throw new NotFoundException('Неизвестное событие уведомления');
    }
    await this.ensureDefaults();
    const def = getEmailNotificationEventDef(eventKey);
    const current = await this.prisma.emailNotificationTemplate.findUnique({
      where: { eventKey },
    });

    const nextSubject =
      dto.subject !== undefined
        ? dto.subject.trim()
        : (current?.subject ?? def.defaultSubject);
    const nextBody =
      dto.body !== undefined
        ? dto.body.replace(/\r\n/g, '\n')
        : (current?.body ?? def.defaultBody);
    const nextEnabled =
      dto.enabled !== undefined ? dto.enabled : (current?.enabled ?? true);

    if (dto.subject !== undefined || dto.body !== undefined) {
      this.validateTemplateText({
        eventKey,
        subject: nextSubject,
        body: nextBody,
      });
    }

    const contentChanged =
      dto.subject !== undefined ||
      dto.body !== undefined ||
      dto.enabled !== undefined;
    if (!contentChanged) {
      return this.get(eventKey);
    }

    const prevSubject = current?.subject ?? def.defaultSubject;
    const prevBody = current?.body ?? def.defaultBody;
    const prevEnabled = current?.enabled ?? true;
    const changed =
      prevSubject !== nextSubject ||
      prevBody !== nextBody ||
      prevEnabled !== nextEnabled;
    if (!changed) {
      return this.get(eventKey);
    }

    const actorEmail = actor?.email?.trim() || null;
    const actorUserId = actor?.userId?.trim() || null;
    const editedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      if (current) {
        await tx.emailNotificationTemplateRevision.create({
          data: {
            eventKey,
            subject: prevSubject,
            body: prevBody,
            enabled: prevEnabled,
            actorUserId,
            actorEmail,
          },
        });
      }
      await tx.emailNotificationTemplate.upsert({
        where: { eventKey },
        create: {
          eventKey,
          enabled: nextEnabled,
          subject: nextSubject,
          body: nextBody,
          lastEditedByUserId: actorUserId,
          lastEditedByEmail: actorEmail,
          lastEditedAt: editedAt,
        },
        update: {
          enabled: nextEnabled,
          subject: nextSubject,
          body: nextBody,
          lastEditedByUserId: actorUserId,
          lastEditedByEmail: actorEmail,
          lastEditedAt: editedAt,
        },
      });
    });

    this.invalidateRowCache(eventKey);
    return this.get(eventKey);
  }

  /**
   * Собрать письмо по шаблону из БД (кэш строки TTL).
   * `null` — событие выключено (не слать).
   */
  async buildForEvent(
    eventKey: EmailNotificationEventKey,
    vars: EmailTemplateVars,
  ): Promise<BuiltEmail | null> {
    const row = await this.getCachedTemplateRow(eventKey);
    if (!row.enabled) return null;

    const site = this.frontendPublicUrl();
    return renderEditableEmail({
      subjectTemplate: row.subject,
      bodyTemplate: row.body,
      vars: {
        'site.url': site,
        ...vars,
      },
      siteUrl: site,
    });
  }

  /** Превью / test-send: sample vars по eventKey; sparse = опциональные пустые. */
  async preview(
    eventKey: string,
    overrides?: {
      subject?: string;
      body?: string;
      sampleVariant?: 'full' | 'sparse';
    },
  ): Promise<BuiltEmail> {
    if (!isEmailNotificationEventKey(eventKey)) {
      throw new NotFoundException('Неизвестное событие уведомления');
    }
    const detail = await this.get(eventKey);
    const site = this.frontendPublicUrl();
    const sample = sampleVarsForEvent(
      eventKey,
      site,
      overrides?.sampleVariant === 'sparse' ? 'sparse' : 'full',
    );
    return renderEditableEmail({
      subjectTemplate: overrides?.subject?.trim() || detail.subject,
      bodyTemplate: overrides?.body?.replace(/\r\n/g, '\n') || detail.body,
      vars: sample,
      siteUrl: site,
    });
  }

  /**
   * Ops badge: путь последней отправки.
   * Raw SQL — не трогаем updatedAt (редактирование шаблона ≠ send).
   */
  async recordSendPath(
    eventKey: EmailNotificationEventKey,
    path: EmailSendPath,
  ): Promise<void> {
    await this.ensureDefaults();
    await this.prisma.$executeRaw`
      UPDATE "EmailNotificationTemplate"
      SET "lastSendPath" = ${path}, "lastSendAt" = NOW()
      WHERE "eventKey" = ${eventKey}
    `;
  }
}

function sampleVarsForEvent(
  eventKey: EmailNotificationEventKey,
  site: string,
  variant: 'full' | 'sparse' = 'full',
): EmailTemplateVars {
  const sparse = variant === 'sparse';
  const payUrl = sparse
    ? ''
    : `${site}/order/pay?orderId=ord_demo&payToken=demo&number=MF-10001`;
  const items = [
    { title: 'Крем 50 мл', qty: 1, lineTotal: 2500 },
    { title: 'Сыворотка', qty: 1, lineTotal: 2000 },
  ];
  const gifts = [
    {
      code: 'GIFT-DEMO-01',
      faceValue: 3000,
      expiresAt: new Date('2026-12-31T00:00:00Z'),
    },
  ];

  /** Полный набор money/items; sparse — пустые #if-поля (items/totals/скидки). */
  const moneyFull = !sparse;
  const common = baseOrderVars({
    orderNumber: 'MF-10001',
    siteUrl: site,
    total: moneyFull ? 4500 : undefined,
    subtotal: moneyFull ? 4500 : undefined,
    shippingCost: moneyFull ? 500 : undefined,
    discountTotal: moneyFull ? 300 : undefined,
    giftCertificateAmount: moneyFull ? 200 : undefined,
    payUrl: undefined,
    tracking: undefined,
    changesSummary: undefined,
    reserveHours: 72,
    items: moneyFull ? items : [],
    refundAmount: undefined,
  });

  const giftFull = !sparse;
  const giftVars: EmailTemplateVars = {
    'gift.items_text': giftFull ? formatGiftItemsText(gifts) : '',
    'gift.items_html': giftFull ? formatGiftItemsHtml(gifts) : '',
    'gift.buyer_email': giftFull ? 'buyer@example.com' : '',
    'gift.recipient_email': giftFull ? 'friend@example.com' : '',
    'gift.intro':
      eventKey === 'gift_issued'
        ? 'Повторно отправляем данные вашего подарочного сертификата Miraflores.'
        : 'Вам выпущен подарочный сертификат Miraflores.',
  };

  const base: EmailTemplateVars = {
    ...common,
    'order.items_text': moneyFull ? formatOrderItemsText(items) : '',
    'order.items_html': moneyFull ? formatOrderItemsHtml(items) : '',
    'order.surcharge_label': '',
    'order.pay_url': '',
    'order.tracking': '',
    'order.tracking_block': '',
    'order.changes_summary': '',
    'site.url': site,
    ...giftVars,
  };

  switch (eventKey) {
    case 'order_awaiting_payment':
      return {
        ...base,
        // full: deep-link; sparse: пустой pay_url → {{#if order.pay_url}} / cta.pay скрыты
        'order.pay_url': payUrl,
        'order.total_label': moneyFull ? rubLabel(4500) : '',
        'order.items_text': '',
        'order.items_html': '',
        'order.totals_block': '',
        'order.subtotal_label': '',
        'order.shipping_label': '',
        'order.discount_label': '',
        'order.gift_label': '',
      };
    case 'order_paid':
      return {
        ...base,
        // sparse: без items/totals → {{#if order.items_html}} / totals скрыты
      };
    case 'order_shipped':
      return {
        ...base,
        'order.tracking': sparse ? '' : '1234567890',
        'order.tracking_block': sparse ? '' : 'Трек-номер: 1234567890',
        'order.items_text': '',
        'order.items_html': '',
        'order.totals_block': '',
        'order.subtotal_label': '',
        'order.shipping_label': '',
        'order.discount_label': '',
        'order.gift_label': '',
      };
    case 'order_delivered':
    case 'order_cancelled':
      return {
        ...base,
        'order.items_text': '',
        'order.items_html': '',
        'order.totals_block': '',
        'order.subtotal_label': '',
        'order.shipping_label': '',
        'order.discount_label': '',
        'order.gift_label': '',
      };
    case 'order_updated':
      return {
        ...base,
        'order.changes_summary': sparse
          ? ''
          : 'Адрес: Москва → СПб; доставка 500 → 700 ₽',
        'order.items_text': '',
        'order.items_html': '',
        'order.totals_block': '',
      };
    case 'order_surcharge':
      return {
        ...base,
        'order.surcharge_label': sparse ? '' : '700 ₽',
        'order.pay_url': payUrl,
        'order.items_text': '',
        'order.items_html': '',
        'order.totals_block': '',
      };
    case 'order_refund': {
      const refundVars = baseOrderVars({
        orderNumber: 'MF-10001',
        siteUrl: site,
        total: 4500,
        refundAmount: sparse ? undefined : 1200,
        refundKind: sparse ? undefined : 'admin',
        refundFull: false,
      });
      return {
        ...base,
        'order.refund_intro': sparse
          ? ''
          : String(refundVars['order.refund_intro'] ?? ''),
        'order.refund_label': sparse
          ? ''
          : String(refundVars['order.refund_label'] ?? ''),
        'order.refund_kind': sparse
          ? ''
          : String(refundVars['order.refund_kind'] ?? ''),
        'order.items_text': '',
        'order.items_html': '',
        'order.totals_block': '',
      };
    }
    case 'gift_purchase_paid':
    case 'gift_issued':
    case 'gift_buyer_copy':
      return {
        ...base,
        'order.items_text': '',
        'order.items_html': '',
        'order.totals_block': '',
        'order.subtotal_label': '',
        'order.shipping_label': '',
        'order.discount_label': '',
        'order.gift_label': '',
      };
    case 'order_chat_reply':
      return {
        ...base,
        'chat.snippet': sparse
          ? ''
          : 'Добрый день! Ваш заказ уже собираем, доставка завтра.',
        'chat.url': accountOrderChatUrl(site, 'preview-order-id'),
        'customer.greeting': sparse ? '' : 'Анна, ',
        'order.items_text': '',
        'order.items_html': '',
        'order.totals_block': '',
      };
    case 'order_chat_support_reply':
      return {
        'site.url': site,
        'site.name': MAIL_BRAND.name,
        'chat.snippet': sparse ? '' : 'Здравствуйте! Подскажите артикул или ссылку на товар.',
        'chat.url': accountSupportChatUrl(site),
        'customer.greeting': sparse ? '' : 'Анна, ',
      };
    default: {
      const _exhaustive: never = eventKey;
      return _exhaustive;
    }
  }
}
