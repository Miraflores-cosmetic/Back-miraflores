import { escapeHtml, MAIL_BRAND, renderMirafloresEmailLayout } from './email-layout';
import { rubLabel } from './email-notification-format';
import type { BuiltEmail } from './email-templates';

export type AdminOrderNotifyKind =
  | 'created'
  | 'paid'
  | 'cancelled'
  | 'refunded';

export type AdminOrderNotifyItem = {
  title: string;
  qty: number;
  lineTotal: number;
};

export type AdminOrderNotifyInput = {
  kind: AdminOrderNotifyKind;
  orderNumber: string;
  customerName?: string | null;
  email: string;
  phone: string;
  total: number;
  /** Только для created. */
  items?: AdminOrderNotifyItem[];
  /** Только для refunded. */
  refundAmount?: number;
  cancelReason?: string | null;
  siteUrl?: string | null;
};

const KIND_TITLE: Record<AdminOrderNotifyKind, string> = {
  created: 'Новый заказ',
  paid: 'Заказ оплачен',
  cancelled: 'Заказ отменён',
  refunded: 'Возврат по заказу',
};

function itemsText(items: AdminOrderNotifyItem[]): string {
  if (!items.length) return '—';
  return items
    .map((it) => {
      const title = (it.title || '').trim() || 'Товар';
      return `• ${title} × ${it.qty} — ${rubLabel(it.lineTotal)}`;
    })
    .join('\n');
}

function itemsHtml(items: AdminOrderNotifyItem[]): string {
  if (!items.length) {
    return `<p style="margin:0;color:${MAIL_BRAND.muted};">—</p>`;
  }
  const rows = items
    .map((it, i) => {
      const title = escapeHtml((it.title || '').trim() || 'Товар');
      const border = i === 0 ? '0' : `1px solid ${MAIL_BRAND.line}`;
      return `<tr>
  <td style="padding:8px 12px;border-top:${border};">${title} × ${escapeHtml(String(it.qty))}</td>
  <td style="padding:8px 12px;border-top:${border};text-align:right;white-space:nowrap;">${escapeHtml(rubLabel(it.lineTotal))}</td>
</tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${MAIL_BRAND.line};border-radius:4px;overflow:hidden;">${rows}</table>`;
}

/** Ops-дубликат админу (не editable customer template). */
export function buildAdminOrderNotifyEmail(
  input: AdminOrderNotifyInput,
): BuiltEmail {
  const number = input.orderNumber.trim();
  const name = (input.customerName || '').trim() || '—';
  const email = (input.email || '').trim() || '—';
  const phone = (input.phone || '').trim() || '—';
  const total = Number.isFinite(input.total) ? input.total : 0;
  const title = KIND_TITLE[input.kind];
  const subject = `[Админ] ${title} ${number} — ${MAIL_BRAND.name}`;

  const lines = [
    title,
    '',
    `Номер: ${number}`,
    `ФИО: ${name}`,
    `E-mail: ${email}`,
    `Тел: ${phone}`,
    `Сумма: ${rubLabel(total)}`,
  ];
  if (input.kind === 'refunded' && input.refundAmount != null) {
    lines.push(`Возврат: ${rubLabel(input.refundAmount)}`);
  }
  if (input.kind === 'cancelled' && (input.cancelReason || '').trim()) {
    lines.push(`Причина: ${input.cancelReason!.trim()}`);
  }
  if (input.kind === 'created') {
    lines.push('', 'Состав:', itemsText(input.items ?? []));
  }

  const text = lines.join('\n');

  const extraRows: string[] = [];
  if (input.kind === 'refunded' && input.refundAmount != null) {
    extraRows.push(
      `<p style="margin:8px 0 0;"><strong>Возврат:</strong> ${escapeHtml(rubLabel(input.refundAmount))}</p>`,
    );
  }
  if (input.kind === 'cancelled' && (input.cancelReason || '').trim()) {
    extraRows.push(
      `<p style="margin:8px 0 0;"><strong>Причина:</strong> ${escapeHtml(input.cancelReason!.trim())}</p>`,
    );
  }
  if (input.kind === 'created') {
    extraRows.push(
      `<p style="margin:16px 0 8px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${MAIL_BRAND.muted};">Состав</p>`,
      itemsHtml(input.items ?? []),
    );
  }

  const bodyHtml = [
    `<p style="margin:0 0 8px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${MAIL_BRAND.muted};">Уведомление админу</p>`,
    `<h1 style="margin:0 0 16px;font-size:22px;font-family:Georgia,'Times New Roman',serif;color:${MAIL_BRAND.greenDark};">${escapeHtml(title)}</h1>`,
    `<p style="margin:0 0 6px;"><strong>Номер:</strong> ${escapeHtml(number)}</p>`,
    `<p style="margin:0 0 6px;"><strong>ФИО:</strong> ${escapeHtml(name)}</p>`,
    `<p style="margin:0 0 6px;"><strong>E-mail:</strong> ${escapeHtml(email)}</p>`,
    `<p style="margin:0 0 6px;"><strong>Тел:</strong> ${escapeHtml(phone)}</p>`,
    `<p style="margin:0 0 6px;"><strong>Сумма:</strong> ${escapeHtml(rubLabel(total))}</p>`,
    ...extraRows,
  ].join('');

  return {
    subject,
    text,
    html: renderMirafloresEmailLayout({
      preheader: `${title} ${number}`,
      bodyHtml,
      siteUrl: input.siteUrl,
    }),
  };
}
