import {
  MAIL_BRAND,
  escapeHtml,
  mailCtaButton,
  mailMutedNote,
  renderMirafloresEmailLayout,
} from './email-layout';

export type BuiltEmail = {
  subject: string;
  text: string;
  html: string;
};

function siteUrl(raw?: string | null): string {
  return (raw ?? '').replace(/\/+$/, '') || 'https://miraflores-shop.com';
}

/** Код подтверждения регистрации. */
export function buildRegistrationOtpEmail(params: {
  code: string;
  siteUrl?: string | null;
}): BuiltEmail {
  const code = params.code.trim();
  const site = siteUrl(params.siteUrl);
  const subject = `Код подтверждения — ${MAIL_BRAND.name}`;
  const text = [
    MAIL_BRAND.name,
    '',
    `Ваш код подтверждения: ${code}`,
    '',
    'Код действует 10 минут.',
    'Никому не сообщайте этот код — сотрудники Miraflores никогда не просят его.',
    '',
    'Если вы не регистрировались на Miraflores, просто проигнорируйте письмо.',
    '',
    site,
  ].join('\n');

  const bodyHtml = [
    `<p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${MAIL_BRAND.muted};">Регистрация</p>`,
    `<p style="margin:0 0 16px;font-size:20px;font-family:Georgia,'Times New Roman',serif;color:${MAIL_BRAND.ink};">Подтвердите email</p>`,
    `<p style="margin:0 0 20px;">Введите этот код на сайте. Он действует <strong>10 минут</strong>.</p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;">
      <tr>
        <td align="center" style="padding:20px 16px;background:${MAIL_BRAND.sand};border:1px solid ${MAIL_BRAND.line};border-radius:4px;">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:32px;letter-spacing:0.28em;font-weight:700;color:${MAIL_BRAND.green};">${escapeHtml(code)}</span>
        </td>
      </tr>
    </table>`,
    `<p style="margin:0;color:${MAIL_BRAND.muted};">Никому не сообщайте код — сотрудники Miraflores никогда не просят его.</p>`,
    mailMutedNote(
      'Если вы не регистрировались на Miraflores, просто проигнорируйте это письмо.',
    ),
  ].join('');

  return {
    subject,
    text,
    html: renderMirafloresEmailLayout({
      preheader: `Код ${code} — действует 10 минут`,
      bodyHtml,
      siteUrl: site,
    }),
  };
}

/** Сброс / первичная установка пароля. */
export function buildPasswordResetEmail(params: {
  resetLink: string;
  siteUrl?: string | null;
}): BuiltEmail {
  const link = params.resetLink.trim();
  const site = siteUrl(params.siteUrl);
  const subject = `Задайте пароль — ${MAIL_BRAND.name}`;
  const text = [
    'Задайте или сбросьте пароль для входа на Miraflores.',
    '',
    'Перейдите по ссылке (действительна 1 час):',
    link,
    '',
    'Если вы не запрашивали это письмо, проигнорируйте его.',
    '',
    site,
  ].join('\n');

  const bodyHtml = [
    `<p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${MAIL_BRAND.muted};">Безопасность</p>`,
    `<p style="margin:0 0 16px;font-size:20px;font-family:Georgia,'Times New Roman',serif;color:${MAIL_BRAND.ink};">Задайте пароль для входа</p>`,
    `<p style="margin:0 0 8px;">Ссылка нужна, чтобы создать или сбросить пароль в личном кабинете Miraflores. Действует <strong>1 час</strong>.</p>`,
    mailCtaButton(link, 'Задать пароль'),
    `<p style="margin:16px 0 0;font-size:12px;color:${MAIL_BRAND.muted};word-break:break-all;">Если кнопка не открывается, скопируйте ссылку:<br/><a href="${escapeHtml(link)}" style="color:${MAIL_BRAND.green};">${escapeHtml(link)}</a></p>`,
    mailMutedNote(
      'Если вы не запрашивали это письмо, просто проигнорируйте его — пароль не изменится.',
    ),
  ].join('');

  return {
    subject,
    text,
    html: renderMirafloresEmailLayout({
      preheader: 'Ссылка для задания пароля действует 1 час',
      bodyHtml,
      siteUrl: site,
    }),
  };
}

/** Успешная оплата обычного заказа (не gift). */
export type OrderPaidEmailItem = {
  title: string;
  qty: number;
  lineTotal: number;
  isGratitudeGift?: boolean;
};

function rubLabel(amount: number): string {
  const n = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `${n.toLocaleString('ru-RU')} ₽`;
}

function orderPaidItemsText(items: OrderPaidEmailItem[]): string {
  return items
    .map((it) => {
      const qty = Math.max(1, Math.floor(it.qty) || 1);
      const gift = it.isGratitudeGift ? ' (подарок)' : '';
      return `• ${it.title.trim() || 'Товар'}${gift} × ${qty} — ${rubLabel(it.lineTotal)}`;
    })
    .join('\n');
}

function orderPaidItemsHtml(items: OrderPaidEmailItem[]): string {
  const rows = items
    .map((it, i) => {
      const qty = Math.max(1, Math.floor(it.qty) || 1);
      const title = escapeHtml((it.title || 'Товар').trim() || 'Товар');
      const gift = it.isGratitudeGift
        ? ` <span style="color:${MAIL_BRAND.muted};font-size:12px;">· подарок</span>`
        : '';
      const border =
        i < items.length - 1 ? `border-bottom:1px solid ${MAIL_BRAND.line};` : '';
      return `<tr>
        <td style="padding:10px 0;${border}vertical-align:top;">
          <p style="margin:0;font-size:14px;color:${MAIL_BRAND.ink};line-height:1.35;">${title}${gift}</p>
          <p style="margin:4px 0 0;font-size:12px;color:${MAIL_BRAND.muted};">${qty} шт.</p>
        </td>
        <td style="padding:10px 0 10px 12px;${border}vertical-align:top;text-align:right;white-space:nowrap;font-size:14px;color:${MAIL_BRAND.ink};">${escapeHtml(rubLabel(it.lineTotal))}</td>
      </tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">${rows}</table>`;
}

function orderPaidTotalsHtml(params: {
  subtotal?: number;
  shippingCost?: number;
  discountTotal?: number;
  giftCertificateAmount?: number;
  total: number;
}): string {
  const rows: string[] = [];
  const push = (label: string, value: string, strong = false) => {
    rows.push(`<tr>
      <td style="padding:4px 0;font-size:13px;color:${MAIL_BRAND.muted};">${escapeHtml(label)}</td>
      <td style="padding:4px 0;font-size:13px;text-align:right;color:${MAIL_BRAND.ink};${strong ? 'font-weight:700;font-size:15px;' : ''}">${escapeHtml(value)}</td>
    </tr>`);
  };
  if (params.subtotal != null) push('Товары', rubLabel(params.subtotal));
  if (params.shippingCost != null && params.shippingCost > 0) {
    push('Доставка', rubLabel(params.shippingCost));
  }
  if (params.discountTotal != null && params.discountTotal > 0) {
    push('Скидка', `−${rubLabel(params.discountTotal)}`);
  }
  if (params.giftCertificateAmount != null && params.giftCertificateAmount > 0) {
    push('Сертификат', `−${rubLabel(params.giftCertificateAmount)}`);
  }
  push('Итого оплачено', rubLabel(params.total), true);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">${rows.join('')}</table>`;
}

export function buildOrderPaidEmail(params: {
  orderNumber: string;
  siteUrl?: string | null;
  accountOrdersPath?: string;
  total?: number;
  subtotal?: number;
  shippingCost?: number;
  discountTotal?: number;
  giftCertificateAmount?: number;
  items?: OrderPaidEmailItem[];
}): BuiltEmail {
  const number = params.orderNumber.trim();
  const site = siteUrl(params.siteUrl);
  const ordersPath = params.accountOrdersPath ?? '/profile?tab=orders';
  const ordersUrl = `${site}${ordersPath.startsWith('/') ? ordersPath : `/${ordersPath}`}`;
  const items = (params.items ?? []).filter((it) => (it.title || '').trim() || it.qty > 0);
  const hasTotal = params.total != null && Number.isFinite(params.total);
  const totalLabel = hasTotal ? rubLabel(params.total!) : null;
  const subject = totalLabel
    ? `Заказ ${number} оплачен (${totalLabel}) — ${MAIL_BRAND.name}`
    : `Заказ ${number} оплачен — ${MAIL_BRAND.name}`;
  const textParts = [
    'Спасибо за покупку!',
    '',
    `Заказ ${number} оплачен и передан в обработку.`,
  ];
  if (items.length) {
    textParts.push('', 'Состав заказа:', orderPaidItemsText(items));
  }
  if (totalLabel) {
    textParts.push('', `Итого оплачено: ${totalLabel}`);
  }
  textParts.push('', `Статус заказа: ${ordersUrl}`, '', site);
  const text = textParts.join('\n');

  const bodyHtml = [
    eyebrow('Заказ'),
    title('Оплата прошла успешно'),
    `<p style="margin:0 0 16px;">Спасибо за покупку. Заказ <strong>${escapeHtml(number)}</strong> оплачен и передан в обработку.</p>`,
    orderNumberCard(
      number,
      totalLabel
        ? `<p style="margin:10px 0 0;font-size:14px;color:${MAIL_BRAND.ink};">Сумма: <strong>${escapeHtml(totalLabel)}</strong></p>`
        : '',
    ),
    items.length
      ? `<p style="margin:16px 0 8px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${MAIL_BRAND.muted};">Состав заказа</p>${orderPaidItemsHtml(items)}`
      : '',
    hasTotal
      ? orderPaidTotalsHtml({
          subtotal: params.subtotal,
          shippingCost: params.shippingCost,
          discountTotal: params.discountTotal,
          giftCertificateAmount: params.giftCertificateAmount,
          total: params.total!,
        })
      : '',
    mailCtaButton(ordersUrl, 'Смотреть заказ'),
    mailMutedNote(
      'Мы пришлём письмо, когда заказ будет отправлен. Вопросы — на info@miraflores.ru.',
    ),
  ].join('');

  return {
    subject,
    text,
    html: renderMirafloresEmailLayout({
      preheader: totalLabel
        ? `Заказ ${number} оплачен на ${totalLabel}`
        : `Заказ ${number} оплачен`,
      bodyHtml,
      siteUrl: site,
    }),
  };
}

function eyebrow(label: string): string {
  return `<p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${MAIL_BRAND.muted};">${escapeHtml(label)}</p>`;
}

function title(text: string): string {
  return `<p style="margin:0 0 16px;font-size:20px;font-family:Georgia,'Times New Roman',serif;color:${MAIL_BRAND.ink};">${escapeHtml(text)}</p>`;
}

function orderNumberCard(number: string, extraHtml = ''): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;background:${MAIL_BRAND.sand};border:1px solid ${MAIL_BRAND.line};border-radius:4px;">
      <tr>
        <td style="padding:16px 18px;">
          <p style="margin:0;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${MAIL_BRAND.muted};">Номер заказа</p>
          <p style="margin:6px 0 0;font-size:18px;font-family:Georgia,'Times New Roman',serif;color:${MAIL_BRAND.green};">${escapeHtml(number)}</p>
          ${extraHtml}
        </td>
      </tr>
    </table>`;
}

function profileUrl(site: string, path = '/profile?tab=orders'): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${site}${p}`;
}

/** Заказ отправлен. */
export function buildOrderShippedEmail(params: {
  orderNumber: string;
  tracking?: string | null;
  siteUrl?: string | null;
}): BuiltEmail {
  const number = params.orderNumber.trim();
  const tracking = params.tracking?.trim() || '';
  const site = siteUrl(params.siteUrl);
  const subject = `Заказ ${number} отправлен — ${MAIL_BRAND.name}`;
  const text = [
    `Заказ ${number} отправлен.`,
    tracking ? `Трек-номер: ${tracking}` : '',
    '',
    `Статус: ${profileUrl(site)}`,
    site,
  ]
    .filter(Boolean)
    .join('\n');

  const trackHtml = tracking
    ? `<p style="margin:12px 0 0;font-size:13px;color:${MAIL_BRAND.ink};">Трек-номер: <strong style="letter-spacing:0.04em">${escapeHtml(tracking)}</strong></p>`
    : '';

  const bodyHtml = [
    eyebrow('Доставка'),
    title('Заказ в пути'),
    `<p style="margin:0 0 16px;">Заказ <strong>${escapeHtml(number)}</strong> передан в службу доставки.</p>`,
    orderNumberCard(number, trackHtml),
    mailCtaButton(profileUrl(site), 'Смотреть заказ'),
    mailMutedNote('Когда заказ доставят, пришлём ещё одно письмо.'),
  ].join('');

  return {
    subject,
    text,
    html: renderMirafloresEmailLayout({
      preheader: tracking
        ? `Заказ ${number} отправлен · ${tracking}`
        : `Заказ ${number} отправлен`,
      bodyHtml,
      siteUrl: site,
    }),
  };
}

/** Заказ доставлен. */
export function buildOrderDeliveredEmail(params: {
  orderNumber: string;
  siteUrl?: string | null;
}): BuiltEmail {
  const number = params.orderNumber.trim();
  const site = siteUrl(params.siteUrl);
  const subject = `Заказ ${number} доставлен — ${MAIL_BRAND.name}`;
  const text = [
    `Заказ ${number} доставлен. Спасибо за покупку!`,
    '',
    profileUrl(site),
    site,
  ].join('\n');

  const bodyHtml = [
    eyebrow('Доставка'),
    title('Заказ доставлен'),
    `<p style="margin:0 0 16px;">Заказ <strong>${escapeHtml(number)}</strong> доставлен. Спасибо, что выбрали Miraflores!</p>`,
    orderNumberCard(number),
    mailCtaButton(profileUrl(site), 'Перейти в кабинет'),
    mailMutedNote('Будем рады отзыву о покупке в личном кабинете.'),
  ].join('');

  return {
    subject,
    text,
    html: renderMirafloresEmailLayout({
      preheader: `Заказ ${number} доставлен`,
      bodyHtml,
      siteUrl: site,
    }),
  };
}

/** Заказ отменён. */
export function buildOrderCancelledEmail(params: {
  orderNumber: string;
  siteUrl?: string | null;
}): BuiltEmail {
  const number = params.orderNumber.trim();
  const site = siteUrl(params.siteUrl);
  const subject = `Заказ ${number} отменён — ${MAIL_BRAND.name}`;
  const text = [
    `Заказ ${number} отменён.`,
    '',
    'Если у вас остались вопросы — напишите на info@miraflores.ru.',
    site,
  ].join('\n');

  const bodyHtml = [
    eyebrow('Заказ'),
    title('Заказ отменён'),
    `<p style="margin:0 0 16px;">Заказ <strong>${escapeHtml(number)}</strong> отменён. Если это произошло по ошибке или нужна помощь — ответьте на это письмо или напишите на info@miraflores.ru.</p>`,
    orderNumberCard(number),
    mailCtaButton(site, 'На сайт Miraflores'),
    mailMutedNote('Новый заказ можно оформить в любое время на сайте.'),
  ].join('');

  return {
    subject,
    text,
    html: renderMirafloresEmailLayout({
      preheader: `Заказ ${number} отменён`,
      bodyHtml,
      siteUrl: site,
    }),
  };
}

/** Админ изменил адрес и/или состав заказа. */
export function buildOrderUpdatedEmail(params: {
  orderNumber: string;
  changesSummary: string;
  siteUrl?: string | null;
}): BuiltEmail {
  const number = params.orderNumber.trim();
  const summary = params.changesSummary.trim() || 'Заказ обновлён менеджером.';
  const site = siteUrl(params.siteUrl);
  const subject = `Заказ ${number} изменён — ${MAIL_BRAND.name}`;
  const text = [
    `По заказу ${number} внесены изменения.`,
    '',
    summary,
    '',
    `Статус: ${profileUrl(site)}`,
    site,
  ].join('\n');

  const bodyHtml = [
    eyebrow('Заказ'),
    title('Заказ обновлён'),
    `<p style="margin:0 0 16px;">По заказу <strong>${escapeHtml(number)}</strong> внесены изменения:</p>`,
    `<p style="margin:0 0 16px;white-space:pre-line;">${escapeHtml(summary)}</p>`,
    orderNumberCard(number),
    mailCtaButton(profileUrl(site), 'Смотреть заказ'),
    mailMutedNote('Если у вас есть вопросы — напишите на info@miraflores.ru.'),
  ].join('');

  return {
    subject,
    text,
    html: renderMirafloresEmailLayout({
      preheader: `Заказ ${number} изменён`,
      bodyHtml,
      siteUrl: site,
    }),
  };
}

/** Ссылка на доплату после увеличения суммы заказа. */
export function buildOrderSurchargeEmail(params: {
  orderNumber: string;
  amount: number;
  paymentUrl: string;
  siteUrl?: string | null;
}): BuiltEmail {
  const number = params.orderNumber.trim();
  const amount = Number.isFinite(params.amount) ? Math.round(params.amount) : 0;
  const amountLabel = `${amount.toLocaleString('ru-RU')} ₽`;
  const payUrl = params.paymentUrl.trim();
  const site = siteUrl(params.siteUrl);
  const subject = `Доплата по заказу ${number} — ${MAIL_BRAND.name}`;
  const text = [
    `По заказу ${number} изменилась сумма. Нужна доплата ${amountLabel}.`,
    '',
    `Оплатить: ${payUrl}`,
    '',
    site,
  ].join('\n');

  const bodyHtml = [
    eyebrow('Оплата'),
    title('Нужна доплата'),
    `<p style="margin:0 0 16px;">По заказу <strong>${escapeHtml(number)}</strong> изменилась сумма. К доплате: <strong>${escapeHtml(amountLabel)}</strong>.</p>`,
    orderNumberCard(number),
    mailCtaButton(payUrl, 'Оплатить доплату'),
    mailMutedNote('Ссылка ведёт на безопасную оплату ЮKassa. Вопросы — на info@miraflores.ru.'),
  ].join('');

  return {
    subject,
    text,
    html: renderMirafloresEmailLayout({
      preheader: `Доплата ${amountLabel} по заказу ${number}`,
      bodyHtml,
      siteUrl: site,
    }),
  };
}

/** Возврат средств. */
export function buildOrderRefundEmail(params: {
  orderNumber: string;
  amount: number;
  full?: boolean;
  /** admin — ручной возврат; late — автовозврат после истечения оплаты */
  kind?: 'admin' | 'late';
  siteUrl?: string | null;
}): BuiltEmail {
  const number = params.orderNumber.trim();
  const amount = Number.isFinite(params.amount) ? params.amount : 0;
  const amountLabel = `${amount.toLocaleString('ru-RU')} ₽`;
  const site = siteUrl(params.siteUrl);
  const kind = params.kind ?? 'admin';
  const subject = `Возврат по заказу ${number} — ${MAIL_BRAND.name}`;

  const text =
    kind === 'late'
      ? [
          `Срок оплаты заказа ${number} истёк. Платёж отменён, средства вернутся автоматически.`,
          '',
          site,
        ].join('\n')
      : [
          params.full
            ? `По заказу ${number} оформлен полный возврат на ${amountLabel}.`
            : `По заказу ${number} оформлен возврат на ${amountLabel}.`,
          '',
          'Срок зачисления зависит от банка.',
          site,
        ].join('\n');

  const lead =
    kind === 'late'
      ? `<p style="margin:0 0 16px;">Срок оплаты заказа <strong>${escapeHtml(number)}</strong> истёк. Платёж отменён — средства вернутся автоматически (срок зависит от банка).</p>`
      : params.full
        ? `<p style="margin:0 0 16px;">По заказу <strong>${escapeHtml(number)}</strong> оформлен полный возврат на <strong>${escapeHtml(amountLabel)}</strong>.</p>`
        : `<p style="margin:0 0 16px;">По заказу <strong>${escapeHtml(number)}</strong> оформлен возврат на <strong>${escapeHtml(amountLabel)}</strong>.</p>`;

  const amountExtra =
    kind === 'admin'
      ? `<p style="margin:12px 0 0;font-size:13px;color:${MAIL_BRAND.ink};">Сумма: <strong>${escapeHtml(amountLabel)}</strong></p>`
      : '';

  const bodyHtml = [
    eyebrow('Возврат'),
    title(kind === 'late' ? 'Платёж отменён' : 'Возврат оформлен'),
    lead,
    orderNumberCard(number, amountExtra),
    mailCtaButton(profileUrl(site), 'Личный кабинет'),
    mailMutedNote('Вопросы по возврату — на info@miraflores.ru.'),
  ].join('');

  return {
    subject,
    text,
    html: renderMirafloresEmailLayout({
      preheader:
        kind === 'late'
          ? `Возврат по заказу ${number}`
          : `Возврат ${amountLabel} · заказ ${number}`,
      bodyHtml,
      siteUrl: site,
    }),
  };
}

export type GiftEmailCertItem = {
  code: string;
  faceValue: number;
  expiresAt: Date | null;
};

function formatFace(faceValue: number): string {
  return `${faceValue.toLocaleString('ru-RU')} ₽`;
}

function formatExpiry(expiresAt: Date | null): string {
  return expiresAt != null
    ? `Действует до ${expiresAt.toLocaleDateString('ru-RU')}`
    : 'Срок действия не ограничен';
}

function giftItemsListText(items: GiftEmailCertItem[]): string {
  return items
    .map((i) => `• ${i.code} — ${formatFace(i.faceValue)} — ${formatExpiry(i.expiresAt)}`)
    .join('\n');
}

function giftItemsListHtml(items: GiftEmailCertItem[]): string {
  const rows = items
    .map((item, i) => {
      const border =
        i < items.length - 1
          ? `border-bottom:1px solid ${MAIL_BRAND.line};`
          : '';
      const meta = `${formatFace(item.faceValue)} · ${formatExpiry(item.expiresAt)}`;
      return `<tr>
      <td style="padding:14px 18px;${border}">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;letter-spacing:0.12em;color:${MAIL_BRAND.green};font-weight:700;">
          ${escapeHtml(item.code)}
        </div>
        <div style="margin-top:6px;font-size:13px;line-height:1.4;color:${MAIL_BRAND.muted};">
          ${escapeHtml(meta)}
        </div>
      </td>
    </tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px;background:${MAIL_BRAND.sand};border:1px solid ${MAIL_BRAND.line};border-radius:4px;">
    ${rows}
  </table>`;
}

function normalizeGiftEmailItems(params: {
  items?: GiftEmailCertItem[];
  codes?: string[];
  faceValue?: number;
  expiresAt?: Date | null;
}): GiftEmailCertItem[] {
  if (params.items?.length) return params.items;
  const codes = params.codes ?? [];
  const face = Math.max(0, Math.floor(params.faceValue ?? 0));
  return codes.map((code) => ({
    code,
    faceValue: face,
    expiresAt: params.expiresAt ?? null,
  }));
}

/** Подарочный сертификат после оплаты на сайте. */
export function buildGiftPurchasePaidEmail(params: {
  orderNumber: string;
  /** Предпочтительно: код + номинал + срок по каждому сертификату. */
  items?: GiftEmailCertItem[];
  /** @deprecated используйте items. */
  codes?: string[];
  faceValue?: number;
  expiresAt?: Date | null;
  buyerEmail?: string;
  siteUrl?: string | null;
}): BuiltEmail {
  const number = params.orderNumber.trim();
  const items = normalizeGiftEmailItems(params);
  const site = siteUrl(params.siteUrl);
  const plural = items.length > 1;
  const subject = plural
    ? `Ваши подарочные сертификаты (${number}) — ${MAIL_BRAND.name}`
    : `Ваш подарочный сертификат (${number}) — ${MAIL_BRAND.name}`;

  const text = [
    'Здравствуйте!',
    '',
    plural
      ? `Оплата заказа ${number} прошла успешно. Ваши подарочные сертификаты Miraflores:`
      : `Оплата заказа ${number} прошла успешно. Ваш подарочный сертификат Miraflores:`,
    '',
    giftItemsListText(items),
    '',
    'Введите код при оформлении заказа на сайте в поле «Промокод или сертификат».',
    params.buyerEmail ? `Покупка оформлена на ${params.buyerEmail}.` : '',
    site,
  ]
    .filter(Boolean)
    .join('\n');

  const bodyHtml = [
    eyebrow('Подарок'),
    title(plural ? 'Ваши сертификаты' : 'Ваш сертификат'),
    `<p style="margin:0 0 16px;">Оплата заказа <strong>${escapeHtml(number)}</strong> прошла успешно.</p>`,
    giftItemsListHtml(items),
    `<p style="margin:0 0 8px;">Введите код при оформлении заказа в поле «Промокод или сертификат».</p>`,
    mailCtaButton(site, 'Перейти в магазин'),
    mailMutedNote('Сохраните это письмо — код понадобится при оплате.'),
  ].join('');

  return {
    subject,
    text,
    html: renderMirafloresEmailLayout({
      preheader: plural
        ? `Сертификаты по заказу ${number}`
        : `Сертификат по заказу ${number}`,
      bodyHtml,
      siteUrl: site,
    }),
  };
}

/** Ручной выпуск / resend сертификата из админки. */
export function buildGiftCertificateIssuedEmail(params: {
  items?: GiftEmailCertItem[];
  codes?: string[];
  faceValue?: number;
  expiresAt?: Date | null;
  resend?: boolean;
  siteUrl?: string | null;
}): BuiltEmail {
  const items = normalizeGiftEmailItems(params);
  const site = siteUrl(params.siteUrl);
  const plural = items.length > 1;
  const resend = Boolean(params.resend);

  const subject = plural
    ? resend
      ? `Повторная отправка: ваши сертификаты — ${MAIL_BRAND.name}`
      : `Ваши подарочные сертификаты — ${MAIL_BRAND.name}`
    : resend
      ? `Повторная отправка: сертификат — ${MAIL_BRAND.name}`
      : `Ваш подарочный сертификат — ${MAIL_BRAND.name}`;

  const intro = resend
    ? 'Повторно отправляем данные вашего подарочного сертификата Miraflores.'
    : plural
      ? 'Вам выпущены подарочные сертификаты Miraflores.'
      : 'Вам выпущен подарочный сертификат Miraflores.';

  const text = [
    'Здравствуйте!',
    '',
    intro,
    '',
    giftItemsListText(items),
    '',
    'Введите код при оформлении заказа на сайте в поле «Промокод или сертификат».',
    '',
    'Если вы не ожидали это письмо, просто проигнорируйте его.',
    site,
  ].join('\n');

  const bodyHtml = [
    eyebrow('Подарок'),
    title(resend ? 'Повторная отправка' : plural ? 'Ваши сертификаты' : 'Ваш сертификат'),
    `<p style="margin:0 0 16px;">${escapeHtml(intro)}</p>`,
    giftItemsListHtml(items),
    `<p style="margin:0 0 8px;">Введите код при оформлении заказа в поле «Промокод или сертификат».</p>`,
    mailCtaButton(site, 'Перейти в магазин'),
    mailMutedNote(
      'Если вы не ожидали это письмо, просто проигнорируйте его.',
    ),
  ].join('');

  return {
    subject,
    text,
    html: renderMirafloresEmailLayout({
      preheader: resend ? 'Повторная отправка сертификата' : 'Подарочный сертификат Miraflores',
      bodyHtml,
      siteUrl: site,
    }),
  };
}

/** Копия покупателю, если код сертификата ушёл другому email. */
export function buildGiftBuyerCopyEmail(params: {
  orderNumber: string;
  recipientEmail: string;
  siteUrl?: string | null;
}): BuiltEmail {
  const number = params.orderNumber.trim();
  const recipient = params.recipientEmail.trim();
  const site = siteUrl(params.siteUrl);
  const subject = `Сертификат оплачен (${number}) — ${MAIL_BRAND.name}`;
  const text = [
    `Оплата заказа ${number} прошла успешно.`,
    `Код сертификата отправлен на ${recipient}.`,
    '',
    site,
  ].join('\n');

  const bodyHtml = [
    eyebrow('Подарок'),
    title('Сертификат оплачен'),
    `<p style="margin:0 0 16px;">Оплата заказа <strong>${escapeHtml(number)}</strong> прошла успешно. Код отправлен на <strong>${escapeHtml(recipient)}</strong>.</p>`,
    orderNumberCard(number),
    mailCtaButton(site, 'На сайт Miraflores'),
    mailMutedNote('Если адрес получателя указан неверно — напишите на info@miraflores.ru.'),
  ].join('');

  return {
    subject,
    text,
    html: renderMirafloresEmailLayout({
      preheader: `Код отправлен на ${recipient}`,
      bodyHtml,
      siteUrl: site,
    }),
  };
}

/** Доступ сотрудника в админку. */
export function buildStaffAdminWelcomeEmail(params: {
  to: string;
  password: string;
  loginUrl: string;
  staffDisplayName?: string | null;
  siteUrl?: string | null;
}): BuiltEmail {
  const hello = params.staffDisplayName?.trim()
    ? `Здравствуйте, ${params.staffDisplayName.trim()}!`
    : 'Здравствуйте!';
  const site = siteUrl(params.siteUrl);
  const subject = `Доступ в админ-панель — ${MAIL_BRAND.name}`;
  const text = [
    hello,
    '',
    'Вам выдан доступ в админ-панель Miraflores.',
    '',
    `Страница входа: ${params.loginUrl}`,
    `Email: ${params.to}`,
    `Пароль: ${params.password}`,
    '',
    'Сохраните пароль в надёжном месте. Если вы не ожидали это письмо, обратитесь к администратору.',
  ].join('\n');

  const bodyHtml = [
    eyebrow('Админ-панель'),
    title('Доступ открыт'),
    `<p style="margin:0 0 16px;">${escapeHtml(hello)} Вам выдан доступ в админ-панель Miraflores.</p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;background:${MAIL_BRAND.sand};border:1px solid ${MAIL_BRAND.line};border-radius:4px;">
      <tr><td style="padding:16px 18px;">
        <p style="margin:0 0 8px;font-size:13px;color:${MAIL_BRAND.muted};">Email</p>
        <p style="margin:0 0 14px;"><strong>${escapeHtml(params.to)}</strong></p>
        <p style="margin:0 0 8px;font-size:13px;color:${MAIL_BRAND.muted};">Временный пароль</p>
        <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:18px;letter-spacing:0.06em;color:${MAIL_BRAND.green};"><strong>${escapeHtml(params.password)}</strong></p>
      </td></tr>
    </table>`,
    mailCtaButton(params.loginUrl, 'Войти в админку'),
    mailMutedNote(
      'Сохраните пароль в надёжном месте. Если вы не ожидали письмо — сразу сообщите администратору.',
    ),
  ].join('');

  return {
    subject,
    text,
    html: renderMirafloresEmailLayout({
      preheader: 'Доступ в админ-панель Miraflores',
      bodyHtml,
      siteUrl: site,
    }),
  };
}

/** Сброс пароля сотрудника админки. */
export function buildStaffAdminPasswordResetEmail(params: {
  to: string;
  password: string;
  loginUrl: string;
  staffDisplayName?: string | null;
  siteUrl?: string | null;
}): BuiltEmail {
  const hello = params.staffDisplayName?.trim()
    ? `Здравствуйте, ${params.staffDisplayName.trim()}!`
    : 'Здравствуйте!';
  const site = siteUrl(params.siteUrl);
  const subject = `Новый пароль админ-панели — ${MAIL_BRAND.name}`;
  const text = [
    hello,
    '',
    'Администратор сбросил ваш пароль для входа в админ-панель Miraflores.',
    '',
    `Страница входа: ${params.loginUrl}`,
    `Email: ${params.to}`,
    `Новый пароль: ${params.password}`,
    '',
    'Сохраните пароль в надёжном месте. Если вы не ожидали это письмо, обратитесь к администратору.',
  ].join('\n');

  const bodyHtml = [
    eyebrow('Админ-панель'),
    title('Новый пароль'),
    `<p style="margin:0 0 16px;">${escapeHtml(hello)} Администратор сбросил ваш пароль для входа в админ-панель Miraflores.</p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;background:${MAIL_BRAND.sand};border:1px solid ${MAIL_BRAND.line};border-radius:4px;">
      <tr><td style="padding:16px 18px;">
        <p style="margin:0 0 8px;font-size:13px;color:${MAIL_BRAND.muted};">Email</p>
        <p style="margin:0 0 14px;"><strong>${escapeHtml(params.to)}</strong></p>
        <p style="margin:0 0 8px;font-size:13px;color:${MAIL_BRAND.muted};">Новый пароль</p>
        <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:18px;letter-spacing:0.06em;color:${MAIL_BRAND.green};"><strong>${escapeHtml(params.password)}</strong></p>
      </td></tr>
    </table>`,
    mailCtaButton(params.loginUrl, 'Войти в админку'),
    mailMutedNote(
      'Если вы не запрашивали сброс — сразу сообщите администратору и не входите по этой ссылке.',
    ),
  ].join('');

  return {
    subject,
    text,
    html: renderMirafloresEmailLayout({
      preheader: 'Новый пароль админ-панели Miraflores',
      bodyHtml,
      siteUrl: site,
    }),
  };
}
