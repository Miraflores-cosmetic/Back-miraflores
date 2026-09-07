import { BadRequestException } from '@nestjs/common';
import {
  GiftCertificateLedgerKind,
  GiftCertificateSource,
  GiftCertificateStatus,
  Prisma,
} from '@prisma/client';
import { allocateUniqueGiftCode } from './gift-certificate-code.allocate';
import { closeOpenGiftCapturesOnRevoke } from './gift-certificate-hold.util';

export const GIFT_PURCHASE_SKU = 'GIFT_CERTIFICATE';

/** Guest-cart variantId для номинала: `gift-denom:<denominationId>`. */
export const GIFT_DENOM_CART_PREFIX = 'gift-denom:';

export function giftDenomCartVariantId(denominationId: string): string {
  return `${GIFT_DENOM_CART_PREFIX}${denominationId}`;
}

export function parseGiftDenomCartVariantId(
  variantId: string | null | undefined,
): string | null {
  const raw = (variantId ?? '').trim();
  if (!raw.startsWith(GIFT_DENOM_CART_PREFIX)) return null;
  const id = raw.slice(GIFT_DENOM_CART_PREFIX.length).trim();
  return id || null;
}

export function isGiftDenomCartLine(line: {
  variantId?: string | null;
  sku?: string | null;
}): boolean {
  return (
    Boolean(parseGiftDenomCartVariantId(line.variantId)) ||
    Boolean(parseGiftPurchaseSkuDenomId(line.sku))
  );
}

/** digital gift-denom vs physical catalog — нельзя в одном заказе. */
export function assertGiftDenomCartNotMixedWithPhysical(
  lines: ReadonlyArray<{ variantId?: string | null; sku?: string | null }>,
): { giftOnly: boolean; physicalOnly: boolean } {
  let gift = false;
  let physical = false;
  for (const line of lines) {
    if (isGiftDenomCartLine(line)) gift = true;
    else physical = true;
  }
  if (gift && physical) {
    throw new BadRequestException(
      'Нельзя оформить подарочные сертификаты вместе с обычными товарами — оформите отдельно',
    );
  }
  return { giftOnly: gift && !physical, physicalOnly: physical && !gift };
}

export function giftPurchaseSkuForDenom(denominationId: string): string {
  return `${GIFT_PURCHASE_SKU}:${denominationId}`;
}

/** sku `GIFT_CERTIFICATE` или `GIFT_CERTIFICATE:<denomId>` → denomId (для prefixed). */
export function parseGiftPurchaseSkuDenomId(
  sku: string | null | undefined,
): string | null {
  const raw = (sku ?? '').trim();
  if (!raw.startsWith(GIFT_PURCHASE_SKU)) return null;
  if (raw === GIFT_PURCHASE_SKU) return null;
  if (!raw.startsWith(`${GIFT_PURCHASE_SKU}:`)) return null;
  const id = raw.slice(GIFT_PURCHASE_SKU.length + 1).trim();
  return id || null;
}

function addDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export type IssuedGiftPurchase = {
  id: string;
  code: string;
  faceValue: number;
  expiresAt: Date | null;
};

/** Код покупки с balance < faceValue (CAPTURE/redeem) — refund покупки запрещён. */
export type GiftPurchaseSpentCert = {
  id: string;
  code: string;
  faceValue: number;
  balance: number;
  spent: number;
};

export function analyzeGiftPurchaseSpend(
  certs: ReadonlyArray<{
    id: string;
    code: string;
    faceValue: number;
    balance: number;
    status: GiftCertificateStatus | string;
  }>,
): {
  unused: boolean;
  spentCerts: GiftPurchaseSpentCert[];
  spentTotal: number;
} {
  const spentCerts: GiftPurchaseSpentCert[] = [];
  for (const c of certs) {
    if (c.status === GiftCertificateStatus.REVOKED || c.status === 'REVOKED') {
      continue;
    }
    const face = Math.max(0, Math.floor(c.faceValue));
    const bal = Math.max(0, Math.floor(c.balance));
    const spent = Math.max(0, face - bal);
    if (spent > 0) {
      spentCerts.push({
        id: c.id,
        code: c.code,
        faceValue: face,
        balance: bal,
        spent,
      });
    }
  }
  const spentTotal = spentCerts.reduce((s, c) => s + c.spent, 0);
  return { unused: spentCerts.length === 0, spentCerts, spentTotal };
}

/**
 * Блок refund покупки, если выданный код уже частично/полностью потрачен.
 * Нет clawback на redeem-заказ и нет пропорционального возврата покупки.
 */
export function assertGiftPurchaseCodesUnusedForRefund(
  certs: ReadonlyArray<{
    id: string;
    code: string;
    faceValue: number;
    balance: number;
    status: GiftCertificateStatus | string;
  }>,
): void {
  const { unused, spentCerts, spentTotal } = analyzeGiftPurchaseSpend(certs);
  if (unused) return;
  const sample = spentCerts
    .slice(0, 3)
    .map((c) => `${c.code} (−${c.spent} ₽)`)
    .join(', ');
  throw new BadRequestException(
    `Нельзя вернуть покупку сертификата: код(ы) уже использованы на ${spentTotal} ₽` +
      (sample ? ` (${sample}${spentCerts.length > 3 ? '…' : ''})` : '') +
      '. Сначала полный возврат товарного заказа с этим сертификатом (баланс вернётся) ' +
      'или ручная корректировка в «Сертификаты». Автоматический clawback на redeem-заказ не делается.',
  );
}

function collectPurchaseQtyByDenom(order: {
  giftPurchaseDenominationId: string | null;
  items: Array<{ sku: string | null; qty: number }>;
}): Map<string, number> {
  const byDenom = new Map<string, number>();
  const add = (denomId: string, qty: number) => {
    const n = Math.max(0, Math.floor(qty));
    if (!denomId || n <= 0) return;
    byDenom.set(denomId, (byDenom.get(denomId) ?? 0) + n);
  };

  for (const item of order.items) {
    const sku = (item.sku ?? '').trim();
    const fromSku = parseGiftPurchaseSkuDenomId(sku);
    if (fromSku) {
      add(fromSku, item.qty);
      continue;
    }
    if (sku === GIFT_PURCHASE_SKU && order.giftPurchaseDenominationId) {
      add(order.giftPurchaseDenominationId, item.qty);
    }
  }

  if (byDenom.size === 0 && order.giftPurchaseDenominationId) {
    add(order.giftPurchaseDenominationId, 1);
  }

  // Cap total issued certificates per order.
  let remaining = 20;
  for (const [id, qty] of [...byDenom.entries()]) {
    if (remaining <= 0) {
      byDenom.delete(id);
      continue;
    }
    const capped = Math.min(qty, remaining);
    byDenom.set(id, capped);
    remaining -= capped;
  }

  return byDenom;
}

/**
 * Идемпотентный выпуск сертификатов после оплаты заказа-покупки.
 * Поддерживает legacy sku GIFT_CERTIFICATE + giftPurchaseDenominationId
 * и cart-checkout sku GIFT_CERTIFICATE:<denomId> (несколько номиналов).
 */
export async function ensureGiftPurchaseIssue(
  tx: Prisma.TransactionClient,
  order: {
    id: string;
    email: string;
    giftPurchaseDenominationId: string | null;
    giftPurchaseRecipientEmail: string | null;
    items: Array<{ sku: string | null; qty: number }>;
  },
): Promise<IssuedGiftPurchase[]> {
  const qtyByDenom = collectPurchaseQtyByDenom(order);
  if (qtyByDenom.size === 0) return [];

  const existing = await tx.giftCertificate.findMany({
    where: { purchaseOrderId: order.id },
    select: {
      id: true,
      code: true,
      faceValue: true,
      expiresAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  if (existing.length) return existing;

  const recipientEmail =
    order.giftPurchaseRecipientEmail?.trim().toLowerCase() ||
    order.email.trim().toLowerCase();

  const recipientUser = recipientEmail
    ? await tx.user.findUnique({
        where: { email: recipientEmail },
        select: { id: true },
      })
    : null;

  const issuedAt = new Date();
  const issued: IssuedGiftPurchase[] = [];

  for (const [denomId, count] of qtyByDenom) {
    const denom = await tx.giftCertificateDenomination.findUnique({
      where: { id: denomId },
    });
    if (!denom || count <= 0) continue;

    const expiresAt =
      denom.validityDays != null ? addDays(issuedAt, denom.validityDays) : null;

    for (let i = 0; i < count; i++) {
      const code = await allocateUniqueGiftCode(tx);
      const cert = await tx.giftCertificate.create({
        data: {
          code,
          denominationId: denom.id,
          faceValue: denom.faceValue,
          balance: denom.faceValue,
          status: GiftCertificateStatus.ACTIVE,
          source: GiftCertificateSource.PURCHASE,
          issuedAt,
          expiresAt,
          recipientEmail,
          recipientUserId: recipientUser?.id ?? null,
          purchaseOrderId: order.id,
          note: `Покупка в заказе`,
        },
        select: {
          id: true,
          code: true,
          faceValue: true,
          expiresAt: true,
        },
      });
      await tx.giftCertificateLedger.create({
        data: {
          certificateId: cert.id,
          kind: GiftCertificateLedgerKind.ISSUE,
          amount: denom.faceValue,
          balanceAfter: denom.faceValue,
          orderId: order.id,
          note: 'Покупка на сайте',
        },
      });
      issued.push(cert);
    }
  }

  return issued;
}

/**
 * Полный refund заказа-покупки: отзывает выпущенные коды (идемпотентно).
 * Без этого деньги возвращаются, а ACTIVE-коды остаются spendable.
 *
 * Политика: если код уже потрачен (balance < faceValue) — нельзя вернуть покупку
 * (нет clawback на redeem-заказ). Сначала полный refund товарного заказа
 * (RELEASE вернёт баланс) или ручная корректировка в admin.
 */
export async function revokeGiftCertificatesIssuedByPurchaseOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  opts?: { note?: string; actorUserId?: string | null },
): Promise<number> {
  const rows = await tx.giftCertificate.findMany({
    where: {
      purchaseOrderId: orderId,
      status: { not: GiftCertificateStatus.REVOKED },
    },
    select: {
      id: true,
      code: true,
      balance: true,
      faceValue: true,
      status: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!rows.length) return 0;

  assertGiftPurchaseCodesUnusedForRefund(rows);

  const note = opts?.note?.trim() || 'Отзыв при возврате покупки сертификата';
  let n = 0;
  for (const row of rows) {
    await tx.giftCertificate.update({
      where: { id: row.id },
      data: {
        balance: 0,
        status: GiftCertificateStatus.REVOKED,
      },
    });
    await tx.giftCertificateLedger.create({
      data: {
        certificateId: row.id,
        kind: GiftCertificateLedgerKind.REVOKE,
        amount: -Math.max(0, row.balance),
        balanceAfter: 0,
        orderId,
        actorUserId: opts?.actorUserId ?? null,
        note,
      },
    });
    await closeOpenGiftCapturesOnRevoke(tx, row.id, {
      actorUserId: opts?.actorUserId ?? null,
      note: 'Закрытие hold при отзыве кодов покупки (баланс не восстановлен)',
    });
    n += 1;
  }
  return n;
}

