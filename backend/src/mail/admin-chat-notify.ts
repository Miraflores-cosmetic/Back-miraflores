import { escapeHtml, MAIL_BRAND, renderMirafloresEmailLayout } from './email-layout';
import type { BuiltEmail } from './email-templates';

export type AdminChatNotifyKind = 'order' | 'support';

export type AdminChatNotifyInput = {
  kind: AdminChatNotifyKind;
  /** Текст сообщения клиента (уже обрезанный при необходимости). */
  messageText: string;
  customerName?: string | null;
  customerEmail?: string | null;
  orderNumber?: string | null;
  orderId?: string | null;
  customerUserId?: string | null;
  /** Ссылка в админку на тред. */
  adminChatUrl?: string | null;
  siteUrl?: string | null;
};

/** Ops-дубликат админу: новое сообщение клиента в чате (не editable customer template). */
export function buildAdminChatNotifyEmail(input: AdminChatNotifyInput): BuiltEmail {
  const name = (input.customerName || '').trim() || '—';
  const email = (input.customerEmail || '').trim() || '—';
  const message = (input.messageText || '').trim() || '…';
  const isOrder = input.kind === 'order';
  const orderNumber = (input.orderNumber || '').trim();
  const title = isOrder
    ? `Сообщение в чате заказа${orderNumber ? ` ${orderNumber}` : ''}`
    : 'Сообщение в чате поддержки';
  const subject = `[Админ] ${title} — ${MAIL_BRAND.name}`;

  const lines = [
    title,
    '',
    `Клиент: ${name}`,
    `E-mail: ${email}`,
  ];
  if (isOrder && orderNumber) lines.push(`Заказ: ${orderNumber}`);
  lines.push('', 'Сообщение:', message);
  if (input.adminChatUrl?.trim()) {
    lines.push('', `Открыть: ${input.adminChatUrl.trim()}`);
  }

  const linkHtml = input.adminChatUrl?.trim()
    ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(input.adminChatUrl.trim())}" style="color:${MAIL_BRAND.greenDark};">Открыть чат в админке</a></p>`
    : '';

  const orderRow =
    isOrder && orderNumber
      ? `<p style="margin:0 0 6px;"><strong>Заказ:</strong> ${escapeHtml(orderNumber)}</p>`
      : '';

  const bodyHtml = [
    `<p style="margin:0 0 8px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${MAIL_BRAND.muted};">Уведомление админу</p>`,
    `<h1 style="margin:0 0 16px;font-size:22px;font-family:Georgia,'Times New Roman',serif;color:${MAIL_BRAND.greenDark};">${escapeHtml(title)}</h1>`,
    `<p style="margin:0 0 6px;"><strong>Клиент:</strong> ${escapeHtml(name)}</p>`,
    `<p style="margin:0 0 6px;"><strong>E-mail:</strong> ${escapeHtml(email)}</p>`,
    orderRow,
    `<p style="margin:16px 0 8px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${MAIL_BRAND.muted};">Сообщение</p>`,
    `<p style="margin:0;white-space:pre-wrap;line-height:1.5;">${escapeHtml(message)}</p>`,
    linkHtml,
  ].join('');

  return {
    subject,
    text: lines.join('\n'),
    html: renderMirafloresEmailLayout({
      preheader: title,
      bodyHtml,
      siteUrl: input.siteUrl,
    }),
  };
}
