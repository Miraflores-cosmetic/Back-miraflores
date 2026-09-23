/**
 * Legacy sync-хелперы для gift-писем.
 * Продакшен-отправка идёт через MailService.sendGift* (шаблоны БД + fallback сюда).
 * Оставлены для unit-тестов builders и maskGiftCertificateCode.
 */

import {
  buildGiftBuyerCopyEmail,
  buildGiftCertificateIssuedEmail,
  buildGiftPurchasePaidEmail,
  type GiftEmailCertItem,
} from '../mail/email-templates';

function siteFromEnv(): string | null {
  return process.env.FRONTEND_PUBLIC_URL?.trim() || null;
}

/** @deprecated Используйте MailService.sendGiftPurchasePaid */
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

/** @deprecated Используйте MailService.sendGiftBuyerCopy */
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

/** @deprecated Используйте MailService.sendGiftCertificateIssued */
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
