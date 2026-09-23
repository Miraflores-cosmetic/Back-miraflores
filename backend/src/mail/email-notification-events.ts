import { MAIL_BRAND } from './email-layout';
import {
  EMAIL_HTML_VAR_KEYS,
  EMAIL_IF_ALLOWED_KEYS,
  EMAIL_SNIPPET_KEYS,
} from './email-notification-render';

/**
 * Реестр editable transactional email (admin/settings).
 *
 * В скоупе: заказы + подарочные сертификаты (commerce).
 * ВНЕ скоупа навсегда (только код / MailService builders):
 *   - registration OTP
 *   - password reset (buyer)
 *   - staff welcome / staff password reset
 *   - OPS alerts (late_payment_failed и т.п. через notifyCustomer/sendRaw)
 *
 * Не добавлять auth/staff/ops ключи в EMAIL_NOTIFICATION_EVENT_KEYS.
 */

/** Стабильные ключи событий (БД + API). */
export const EMAIL_NOTIFICATION_EVENT_KEYS = [
  'order_awaiting_payment',
  'order_paid',
  'order_shipped',
  'order_delivered',
  'order_cancelled',
  'order_updated',
  'order_surcharge',
  'order_refund',
  'gift_purchase_paid',
  'gift_issued',
  'gift_buyer_copy',
] as const;

export type EmailNotificationEventKey =
  (typeof EMAIL_NOTIFICATION_EVENT_KEYS)[number];

export function isEmailNotificationEventKey(
  value: string,
): value is EmailNotificationEventKey {
  return (EMAIL_NOTIFICATION_EVENT_KEYS as readonly string[]).includes(value);
}

export type EmailNotificationVarDoc = {
  key: string;
  label: string;
};

export type EmailNotificationEventDef = {
  key: EmailNotificationEventKey;
  label: string;
  description: string;
  variables: EmailNotificationVarDoc[];
  defaultSubject: string;
  defaultBody: string;
};

const ORDER_COMMON_VARS: EmailNotificationVarDoc[] = [
  { key: 'order.number', label: 'Номер заказа' },
  { key: 'order.url', label: 'Ссылка на заказ в ЛК' },
  { key: 'site.url', label: 'URL витрины' },
  { key: 'site.name', label: 'Название бренда' },
];

const SNIPPET_CTA_PAY: EmailNotificationVarDoc = {
  key: 'cta.pay',
  label: 'Кнопка «Оплатить» (order.pay_url)',
};
const SNIPPET_CTA_ORDER: EmailNotificationVarDoc = {
  key: 'cta.order',
  label: 'Кнопка «Смотреть заказ»',
};
const SNIPPET_CTA_SITE: EmailNotificationVarDoc = {
  key: 'cta.site',
  label: 'Кнопка «На сайт»',
};
const SNIPPET_ORDER_CARD: EmailNotificationVarDoc = {
  key: 'block.order_card',
  label: 'Карточка номера заказа',
};
const SNIPPET_ITEMS: EmailNotificationVarDoc = {
  key: 'block.items',
  label: 'Таблица состава заказа',
};
const SNIPPET_GIFT_ITEMS: EmailNotificationVarDoc = {
  key: 'block.gift_items',
  label: 'Таблица кодов сертификата',
};
const SNIPPET_TOTALS: EmailNotificationVarDoc = {
  key: 'block.totals',
  label: 'Сводка сумм (subtotal/доставка/скидки)',
};

/** Всегда допустимы при валидации шаблона (помимо variables события). */
export const EMAIL_GLOBAL_ALLOWED_KEYS: readonly string[] = [
  'site.url',
  'site.name',
  ...EMAIL_SNIPPET_KEYS,
  ...EMAIL_HTML_VAR_KEYS,
  ...EMAIL_IF_ALLOWED_KEYS,
];

/**
 * Реестр событий MVP: заказы + сертификаты.
 * defaultSubject/Body — сиды и fallback, если строки ещё нет в БД.
 * Rich fidelity: сниппеты {{cta.*}} / {{block.*}} (не произвольный HTML).
 */
export const EMAIL_NOTIFICATION_EVENTS: readonly EmailNotificationEventDef[] = [
  {
    key: 'order_awaiting_payment',
    label: 'Заказ ожидает оплаты',
    description: 'После оформления заказа со статусом «Ожидает оплаты».',
    variables: [
      ...ORDER_COMMON_VARS,
      { key: 'order.total_label', label: 'Сумма к оплате (с ₽)' },
      { key: 'order.pay_url', label: 'Ссылка на оплату (deep-link)' },
      { key: 'order.reserve_hours', label: 'Срок резерва, часов' },
      SNIPPET_ORDER_CARD,
      SNIPPET_CTA_PAY,
      SNIPPET_CTA_ORDER,
    ],
    defaultSubject: `Заказ {{order.number}} ожидает оплаты — ${MAIL_BRAND.name}`,
    defaultBody: [
      'Здравствуйте!',
      '',
      'Мы получили ваш заказ на сайте Miraflores.',
      '',
      '{{block.order_card}}',
      '',
      'Товары зарезервированы на {{order.reserve_hours}} ч. Если оплата не поступит вовремя, заказ будет отменён автоматически.',
      '',
      '{{#if order.pay_url}}',
      '{{cta.pay}}',
      '',
      '{{/if}}',
      'Или откройте заказ в кабинете:',
      '{{order.url}}',
      '',
      'Вопросы — на info@miraflores.ru.',
    ].join('\n'),
  },
  {
    key: 'order_paid',
    label: 'Заказ оплачен',
    description: 'После успешной оплаты обычного заказа.',
    variables: [
      ...ORDER_COMMON_VARS,
      { key: 'order.total_label', label: 'Итого оплачено (с ₽)' },
      { key: 'order.subtotal_label', label: 'Сумма товаров (с ₽)' },
      { key: 'order.shipping_label', label: 'Доставка (с ₽)' },
      { key: 'order.discount_label', label: 'Скидка (с ₽)' },
      { key: 'order.gift_label', label: 'Сертификат (с ₽)' },
      { key: 'order.totals_block', label: 'Сводка сумм (текст)' },
      { key: 'order.items_text', label: 'Состав заказа (текст)' },
      { key: 'order.items_html', label: 'Состав заказа (HTML-таблица)' },
      SNIPPET_ORDER_CARD,
      SNIPPET_ITEMS,
      SNIPPET_TOTALS,
      SNIPPET_CTA_ORDER,
    ],
    defaultSubject: `Заказ {{order.number}} оплачен — ${MAIL_BRAND.name}`,
    defaultBody: [
      'Спасибо за покупку!',
      '',
      'Заказ оплачен и передан в обработку.',
      '',
      '{{block.order_card}}',
      '',
      '{{#if order.items_html}}',
      '{{order.items_html}}',
      '{{/if}}',
      '',
      '{{#if order.totals_block}}',
      '{{block.totals}}',
      '{{/if}}',
      '',
      '{{cta.order}}',
      '',
      'Мы пришлём письмо, когда заказ будет отправлен.',
    ].join('\n'),
  },
  {
    key: 'order_shipped',
    label: 'Заказ отправлен',
    description: 'Когда заказ передан в службу доставки.',
    variables: [
      ...ORDER_COMMON_VARS,
      { key: 'order.tracking', label: 'Трек-номер' },
      { key: 'order.tracking_block', label: 'Строка «Трек-номер: …»' },
      SNIPPET_ORDER_CARD,
      SNIPPET_CTA_ORDER,
    ],
    defaultSubject: `Заказ {{order.number}} отправлен — ${MAIL_BRAND.name}`,
    defaultBody: [
      'Заказ отправлен.',
      '',
      '{{block.order_card}}',
      '',
      '{{#if order.tracking_block}}',
      '{{order.tracking_block}}',
      '',
      '{{/if}}',
      '{{cta.order}}',
      '',
      'Когда заказ доставят, пришлём ещё одно письмо.',
    ].join('\n'),
  },
  {
    key: 'order_delivered',
    label: 'Заказ доставлен',
    description: 'Когда заказ отмечен доставленным.',
    variables: [...ORDER_COMMON_VARS, SNIPPET_ORDER_CARD, SNIPPET_CTA_ORDER],
    defaultSubject: `Заказ {{order.number}} доставлен — ${MAIL_BRAND.name}`,
    defaultBody: [
      'Заказ доставлен. Спасибо, что выбрали Miraflores!',
      '',
      '{{block.order_card}}',
      '',
      '{{cta.order}}',
      '',
      'Будем рады отзыву о покупке.',
    ].join('\n'),
  },
  {
    key: 'order_cancelled',
    label: 'Заказ отменён',
    description: 'При отмене заказа.',
    variables: [...ORDER_COMMON_VARS, SNIPPET_ORDER_CARD, SNIPPET_CTA_SITE],
    defaultSubject: `Заказ {{order.number}} отменён — ${MAIL_BRAND.name}`,
    defaultBody: [
      'Заказ отменён.',
      '',
      '{{block.order_card}}',
      '',
      'Если это произошло по ошибке или нужна помощь — напишите на info@miraflores.ru.',
      '',
      '{{cta.site}}',
    ].join('\n'),
  },
  {
    key: 'order_updated',
    label: 'Заказ изменён',
    description: 'Админ изменил адрес и/или состав (если включено уведомление).',
    variables: [
      ...ORDER_COMMON_VARS,
      { key: 'order.changes_summary', label: 'Краткое описание изменений' },
      SNIPPET_ORDER_CARD,
      SNIPPET_CTA_ORDER,
    ],
    defaultSubject: `Заказ {{order.number}} изменён — ${MAIL_BRAND.name}`,
    defaultBody: [
      'По заказу внесены изменения:',
      '',
      '{{block.order_card}}',
      '',
      '{{order.changes_summary}}',
      '',
      '{{cta.order}}',
      '',
      'Вопросы — на info@miraflores.ru.',
    ].join('\n'),
  },
  {
    key: 'order_surcharge',
    label: 'Доплата по заказу',
    description: 'Ссылка на доплату после увеличения суммы.',
    variables: [
      ...ORDER_COMMON_VARS,
      { key: 'order.surcharge_label', label: 'Сумма доплаты (с ₽)' },
      { key: 'order.pay_url', label: 'Ссылка на оплату доплаты' },
      SNIPPET_ORDER_CARD,
      SNIPPET_CTA_PAY,
      SNIPPET_CTA_ORDER,
    ],
    defaultSubject: `Доплата по заказу {{order.number}} — ${MAIL_BRAND.name}`,
    defaultBody: [
      'По заказу изменилась сумма.',
      '',
      '{{block.order_card}}',
      '',
      'К доплате: {{order.surcharge_label}}',
      '',
      '{{#if order.pay_url}}',
      '{{cta.pay}}',
      '',
      '{{/if}}',
      'Откройте заказ в кабинете:',
      '{{cta.order}}',
    ].join('\n'),
  },
  {
    key: 'order_refund',
    label: 'Возврат по заказу',
    description: 'Ручной или автоматический возврат средств.',
    variables: [
      ...ORDER_COMMON_VARS,
      { key: 'order.refund_intro', label: 'Вводная (late / full / partial)' },
      { key: 'order.refund_label', label: 'Сумма возврата (с ₽)' },
      { key: 'order.refund_kind', label: 'Тип: admin | late | full' },
      SNIPPET_ORDER_CARD,
      SNIPPET_CTA_ORDER,
    ],
    defaultSubject: `Возврат по заказу {{order.number}} — ${MAIL_BRAND.name}`,
    defaultBody: [
      '{{order.refund_intro}}',
      '',
      '{{block.order_card}}',
      '',
      '{{#if order.refund_label}}',
      'Сумма: {{order.refund_label}}',
      '',
      '{{/if}}',
      'Срок зачисления зависит от банка.',
      '',
      '{{cta.order}}',
    ].join('\n'),
  },
  {
    key: 'gift_purchase_paid',
    label: 'Сертификат: оплачен на сайте',
    description: 'Коды сертификатов покупателю после оплаты.',
    variables: [
      ...ORDER_COMMON_VARS,
      { key: 'gift.items_text', label: 'Список кодов (текст)' },
      { key: 'gift.items_html', label: 'Список кодов (HTML-таблица)' },
      { key: 'gift.buyer_email', label: 'Email покупателя' },
      SNIPPET_GIFT_ITEMS,
      SNIPPET_CTA_SITE,
    ],
    defaultSubject: `Ваш подарочный сертификат ({{order.number}}) — ${MAIL_BRAND.name}`,
    defaultBody: [
      'Здравствуйте!',
      '',
      'Оплата заказа {{order.number}} прошла успешно. Ваш подарочный сертификат Miraflores:',
      '',
      '{{#if gift.items_html}}',
      '{{gift.items_html}}',
      '{{/if}}',
      '',
      'Введите код при оформлении заказа в поле «Промокод или сертификат».',
      '',
      'Сохраните это письмо — код понадобится при оплате.',
      '',
      '{{cta.site}}',
    ].join('\n'),
  },
  {
    key: 'gift_issued',
    label: 'Сертификат: выпуск / повторная отправка',
    description: 'Ручной выпуск или resend из админки.',
    variables: [
      { key: 'site.url', label: 'URL витрины' },
      { key: 'site.name', label: 'Название бренда' },
      { key: 'gift.items_text', label: 'Список кодов (текст)' },
      { key: 'gift.items_html', label: 'Список кодов (HTML-таблица)' },
      { key: 'gift.intro', label: 'Вводная фраза (выпуск / повтор)' },
      SNIPPET_GIFT_ITEMS,
      SNIPPET_CTA_SITE,
    ],
    defaultSubject: `Ваш подарочный сертификат — ${MAIL_BRAND.name}`,
    defaultBody: [
      'Здравствуйте!',
      '',
      '{{gift.intro}}',
      '',
      '{{#if gift.items_html}}',
      '{{gift.items_html}}',
      '{{/if}}',
      '',
      'Введите код при оформлении заказа в поле «Промокод или сертификат».',
      '',
      'Если вы не ожидали это письмо, просто проигнорируйте его.',
      '',
      '{{cta.site}}',
    ].join('\n'),
  },
  {
    key: 'gift_buyer_copy',
    label: 'Сертификат: копия покупателю',
    description: 'Если код ушёл на другой email получателя.',
    variables: [
      ...ORDER_COMMON_VARS,
      { key: 'gift.recipient_email', label: 'Email получателя кода' },
      SNIPPET_CTA_SITE,
    ],
    defaultSubject: `Сертификат оплачен ({{order.number}}) — ${MAIL_BRAND.name}`,
    defaultBody: [
      'Оплата заказа {{order.number}} прошла успешно.',
      '',
      'Код сертификата отправлен на {{gift.recipient_email}}.',
      '',
      'Если адрес получателя указан неверно — напишите на info@miraflores.ru.',
      '',
      '{{cta.site}}',
    ].join('\n'),
  },
];

export function getEmailNotificationEventDef(
  key: EmailNotificationEventKey,
): EmailNotificationEventDef {
  const def = EMAIL_NOTIFICATION_EVENTS.find((e) => e.key === key);
  if (!def) {
    throw new Error(`Unknown email notification event: ${key}`);
  }
  return def;
}
