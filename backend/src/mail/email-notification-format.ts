import { escapeHtml, MAIL_BRAND } from './email-layout';
import type { GiftEmailCertItem } from './email-templates';
import type { EmailTemplateVars } from './email-notification-render';

export type OrderEmailItem = {
  title: string;
  qty: number;
  lineTotal: number;
  isGratitudeGift?: boolean;
};

export function rubLabel(amount: number): string {
  const n = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `${n.toLocaleString('ru-RU')} ₽`;
}

export function formatOrderItemsText(items: OrderEmailItem[]): string {
  const rows = items.filter((it) => (it.title || '').trim() || it.qty > 0);
  if (!rows.length) return '';
  const lines = rows.map((it) => {
    const gift = it.isGratitudeGift ? ' (подарок)' : '';
    return `• ${it.title.trim() || 'Товар'}${gift} × ${it.qty} — ${rubLabel(it.lineTotal)}`;
  });
  return ['Состав заказа:', ...lines].join('\n');
}

/** Таблица состава: ячейки escapeHtml, оболочка — trusted HTML для инъекции. */
export function formatOrderItemsHtml(items: OrderEmailItem[]): string {
  const rows = items.filter((it) => (it.title || '').trim() || it.qty > 0);
  if (!rows.length) return '';
  const head = `<p style="margin:16px 0 8px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${MAIL_BRAND.muted};">Состав заказа</p>`;
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border:1px solid ${MAIL_BRAND.line};border-radius:4px;overflow:hidden;">
${rows
  .map((it, i) => {
    const gift = it.isGratitudeGift ? ' (подарок)' : '';
    const title = escapeHtml(`${(it.title || '').trim() || 'Товар'}${gift}`);
    const qty = escapeHtml(String(it.qty));
    const total = escapeHtml(rubLabel(it.lineTotal));
    const border =
      i === 0 ? '0' : `1px solid ${MAIL_BRAND.line}`;
    return `  <tr>
    <td style="padding:10px 14px;font-size:14px;line-height:1.45;color:${MAIL_BRAND.ink};border-top:${border};">${title} × ${qty}</td>
    <td style="padding:10px 14px;font-size:14px;line-height:1.45;color:${MAIL_BRAND.ink};border-top:${border};text-align:right;white-space:nowrap;">${total}</td>
  </tr>`;
  })
  .join('\n')}
</table>`;
  return `${head}${table}`;
}

export function formatGiftItemsText(items: GiftEmailCertItem[]): string {
  return items
    .map((i) => {
      const exp =
        i.expiresAt != null
          ? `Действует до ${i.expiresAt.toLocaleDateString('ru-RU')}`
          : 'Срок действия не ограничен';
      return `• ${i.code} — ${rubLabel(i.faceValue)} — ${exp}`;
    })
    .join('\n');
}

export function formatGiftItemsHtml(items: GiftEmailCertItem[]): string {
  if (!items.length) return '';
  const head = `<p style="margin:16px 0 8px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${MAIL_BRAND.muted};">Сертификат</p>`;
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border:1px solid ${MAIL_BRAND.line};border-radius:4px;overflow:hidden;">
${items
  .map((i, idx) => {
    const exp =
      i.expiresAt != null
        ? `Действует до ${i.expiresAt.toLocaleDateString('ru-RU')}`
        : 'Срок действия не ограничен';
    const border = idx === 0 ? '0' : `1px solid ${MAIL_BRAND.line}`;
    return `  <tr>
    <td style="padding:10px 14px;font-size:14px;line-height:1.45;color:${MAIL_BRAND.ink};border-top:${border};"><strong>${escapeHtml(i.code)}</strong><br/><span style="font-size:12px;color:${MAIL_BRAND.muted};">${escapeHtml(exp)}</span></td>
    <td style="padding:10px 14px;font-size:14px;line-height:1.45;color:${MAIL_BRAND.ink};border-top:${border};text-align:right;white-space:nowrap;">${escapeHtml(rubLabel(i.faceValue))}</td>
  </tr>`;
  })
  .join('\n')}
</table>`;
  return `${head}${table}`;
}

export function accountOrdersUrl(siteUrl: string): string {
  const site = siteUrl.replace(/\/+$/, '') || 'https://miraflores-shop.com';
  return `${site}/profile?tab=orders`;
}

/** Deep-link чата по заказу в ЛК (Front открывает модалку по `chatOrder`). */
export function accountOrderChatUrl(siteUrl: string, orderId: string): string {
  const site = siteUrl.replace(/\/+$/, '') || 'https://miraflores-shop.com';
  const id = orderId.trim();
  return `${site}/profile?tab=orders&chatOrder=${encodeURIComponent(id)}`;
}

/** Deep-link общего чата поддержки (Front: `chatSupport=1`). */
export function accountSupportChatUrl(siteUrl: string): string {
  const site = siteUrl.replace(/\/+$/, '') || 'https://miraflores-shop.com';
  return `${site}/profile?chatSupport=1`;
}

/** Превью текста сообщения чата для email. */
export function chatMessageSnippet(body: string, attachmentCount: number): string {
  const t = body.trim();
  if (t) return t.slice(0, 280);
  if (attachmentCount > 0) return '(вложение)';
  return '…';
}

export function customerEmailGreeting(displayName: string | null | undefined): string {
  const n = displayName?.trim();
  return n ? `${n}, ` : '';
}

/**
 * Deep-link оплаты из письма: Front `/order/pay` кладёт payToken в sessionStorage
 * и сразу стартует ЮKassa (осознанный exception к «payToken не в URL»).
 */
export function guestOrderPayUrl(opts: {
  siteUrl: string;
  orderId: string;
  orderNumber: string;
  payToken: string;
}): string {
  const site = opts.siteUrl.replace(/\/+$/, '') || 'https://miraflores-shop.com';
  const qs = new URLSearchParams({
    orderId: opts.orderId.trim(),
    payToken: opts.payToken.trim(),
    number: opts.orderNumber.trim(),
  });
  return `${site}/order/pay?${qs.toString()}`;
}

export function refundIntroText(opts: {
  orderNumber: string;
  amount: number;
  full?: boolean;
  kind?: 'admin' | 'late';
}): string {
  const number = opts.orderNumber.trim();
  const amountLabel = rubLabel(opts.amount);
  if (opts.kind === 'late') {
    return `Срок оплаты заказа ${number} истёк. Платёж отменён, средства вернутся автоматически.`;
  }
  if (opts.full) {
    return `По заказу ${number} оформлен полный возврат на ${amountLabel}.`;
  }
  return `По заказу ${number} оформлен возврат на ${amountLabel}.`;
}

function moneyOrEmpty(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n) || n === 0) return '';
  return rubLabel(n);
}

export function baseOrderVars(opts: {
  orderNumber: string;
  siteUrl: string;
  total?: number;
  subtotal?: number;
  shippingCost?: number;
  discountTotal?: number;
  giftCertificateAmount?: number;
  payUrl?: string;
  tracking?: string | null;
  changesSummary?: string;
  reserveHours?: number;
  items?: OrderEmailItem[];
  itemsText?: string;
  refundAmount?: number;
  refundFull?: boolean;
  refundKind?: 'admin' | 'late';
}): EmailTemplateVars {
  const site = opts.siteUrl.replace(/\/+$/, '') || 'https://miraflores-shop.com';
  const orderUrl = accountOrdersUrl(site);
  const tracking = (opts.tracking || '').trim();
  const items = opts.items ?? [];
  const itemsText =
    opts.itemsText || (items.length ? formatOrderItemsText(items) : '');
  const itemsHtml = items.length ? formatOrderItemsHtml(items) : '';

  const subtotalLabel = moneyOrEmpty(opts.subtotal);
  const shippingLabel = moneyOrEmpty(opts.shippingCost);
  const discountLabel = moneyOrEmpty(opts.discountTotal);
  const giftLabel = moneyOrEmpty(opts.giftCertificateAmount);
  const totalLabel =
    opts.total != null && Number.isFinite(opts.total)
      ? rubLabel(opts.total)
      : '';

  const totalsLines: string[] = [];
  if (subtotalLabel) totalsLines.push(`Товары: ${subtotalLabel}`);
  if (shippingLabel) totalsLines.push(`Доставка: ${shippingLabel}`);
  if (discountLabel) totalsLines.push(`Скидка: −${discountLabel}`);
  if (giftLabel) totalsLines.push(`Сертификат: −${giftLabel}`);
  if (totalLabel) totalsLines.push(`Итого: ${totalLabel}`);
  const totalsBlock = totalsLines.join('\n');

  const refundIntro =
    opts.refundAmount != null && Number.isFinite(opts.refundAmount)
      ? refundIntroText({
          orderNumber: opts.orderNumber,
          amount: opts.refundAmount,
          full: opts.refundFull,
          kind: opts.refundKind,
        })
      : '';

  return {
    'site.name': MAIL_BRAND.name,
    'site.url': site,
    'order.number': opts.orderNumber.trim(),
    'order.url': orderUrl,
    'order.pay_url': (opts.payUrl || '').trim(),
    'order.total_label': totalLabel,
    'order.subtotal_label': subtotalLabel,
    'order.shipping_label': shippingLabel,
    'order.discount_label': discountLabel,
    'order.gift_label': giftLabel,
    'order.totals_block': totalsBlock,
    'order.tracking': tracking,
    'order.tracking_block': tracking ? `Трек-номер: ${tracking}` : '',
    'order.changes_summary': (opts.changesSummary || '').trim(),
    'order.reserve_hours':
      opts.reserveHours != null ? String(opts.reserveHours) : '',
    'order.items_text': itemsText,
    'order.items_html': itemsHtml,
    'order.refund_intro': refundIntro,
    'order.refund_label':
      opts.refundAmount != null && Number.isFinite(opts.refundAmount)
        ? rubLabel(opts.refundAmount)
        : '',
    'order.refund_kind':
      opts.refundFull
        ? 'full'
        : opts.refundKind
          ? opts.refundKind
          : '',
  };
}
