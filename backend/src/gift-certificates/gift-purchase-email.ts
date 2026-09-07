/** Общие письма по подарочным сертификатам. */

import {
  buildGiftBuyerCopyEmail,
  buildGiftCertificateIssuedEmail,
  buildGiftPurchasePaidEmail,
  type GiftEmailCertItem,
} from '../mail/email-templates';

function siteFromEnv(): string | null {
  return process.env.FRONTEND_PUBLIC_URL?.trim() || null;
}

/** После оплаты покупки на сайте. */
export function giftPurchasePaidEmail(params: {
  orderNumber: string;
  items: GiftEmailCertItem[];
  recipientEmail: string;
  buyerEmail: string;
}): { subject: string; text: string; html: string; to: string } {
  const { orderNumber, items, recipientEmail, buyerEmail } = params;
  const to = recipientEmail || buyerEmail;
  const built = buildGiftPurchasePaidEmail({
    orderNumber,
    items,
    buyerEmail: buyerEmail !== to ? buyerEmail : undefined,
    siteUrl: siteFromEnv(),
  });
  return { to, ...built };
}

/** Копия покупателю, если код ушёл на другой email. */
export function giftBuyerCopyEmail(params: {
  orderNumber: string;
  recipientEmail: string;
  to: string;
}): { subject: string; text: string; html: string; to: string } {
  const built = buildGiftBuyerCopyEmail({
    orderNumber: params.orderNumber,
    recipientEmail: params.recipientEmail,
    siteUrl: siteFromEnv(),
  });
  return { to: params.to, ...built };
}

/** Ручной выпуск / повторная отправка из админки. */
export function giftCertificateIssuedEmail(params: {
  items: GiftEmailCertItem[];
  to: string;
  resend?: boolean;
}): { subject: string; text: string; html: string; to: string } {
  const built = buildGiftCertificateIssuedEmail({
    items: params.items,
    resend: params.resend,
    siteUrl: siteFromEnv(),
  });
  return { to: params.to, ...built };
}

/** Маскировка кода в логах: JC-XXXX-****-**** */
export function maskGiftCertificateCode(code: string): string {
  const n = code.trim().toUpperCase();
  if (n.length < 8) return '****';
  const parts = n.split('-');
  if (parts.length >= 4) {
    return `${parts[0]}-${parts[1]}-****-****`;
  }
  return `${n.slice(0, 6)}…`;
}
