import { BadRequestException } from '@nestjs/common';
import {
  GiftCertificateLedgerKind,
  GiftCertificateStatus,
  Prisma,
} from '@prisma/client';
import { normalizeGiftCertificateCode } from './gift-certificate-code.util';

type LockedCert = {
  id: string;
  code: string;
  balance: number;
  faceValue: number;
  status: GiftCertificateStatus;
  expiresAt: Date | null;
};

export type GiftApplyResult = {
  certificateId: string;
  code: string;
  faceValue: number;
  balance: number;
  applyAmount: number;
  /** subtotal после промо, до сертификата */
  payableBeforeGift: number;
  /** к оплате картой после сертификата */
  total: number;
};

export function computeGiftApplyAmount(
  balance: number,
  payableBeforeGift: number,
): number {
  return Math.min(
    Math.max(0, Math.floor(balance)),
    Math.max(0, Math.floor(payableBeforeGift)),
  );
}

function assertUsable(row: LockedCert, now = new Date()) {
  if (row.status === GiftCertificateStatus.REVOKED) {
    throw new BadRequestException('Сертификат отозван');
  }
  if (row.status === GiftCertificateStatus.USED_UP || row.balance <= 0) {
    throw new BadRequestException('Баланс сертификата исчерпан');
  }
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    throw new BadRequestException('Срок действия сертификата истёк');
  }
  if (row.status === GiftCertificateStatus.EXPIRED) {
    throw new BadRequestException('Срок действия сертификата истёк');
  }
  if (row.status !== GiftCertificateStatus.ACTIVE) {
    throw new BadRequestException('Сертификат недоступен');
  }
}

/** Soft validate (без lock) для превью в корзине. */
export async function findUsableGiftCertificate(
  prisma: Prisma.TransactionClient | { giftCertificate: Prisma.GiftCertificateDelegate },
  codeRaw: string,
) {
  const code = normalizeGiftCertificateCode(codeRaw);
  if (code.length < 6) {
    throw new BadRequestException('Некорректный код сертификата');
  }

  const lookup = async () => {
    const row = await prisma.giftCertificate.findFirst({
      where: { code: { equals: code, mode: 'insensitive' } },
      select: {
        id: true,
        code: true,
        balance: true,
        faceValue: true,
        status: true,
        expiresAt: true,
      },
    });
    if (!row) throw new BadRequestException('Сертификат не найден');
    assertUsable(row);
    return row;
  };

  // Buyer RLS: SELECT только своих — redeem чужого кода нужен local bypass.
  if (
    typeof (prisma as Prisma.TransactionClient).$executeRaw === 'function' &&
    typeof (prisma as Prisma.TransactionClient).$queryRaw === 'function'
  ) {
    return withLocalRlsBypass(prisma as Prisma.TransactionClient, lookup);
  }
  return lookup();
}

/**
 * Резерв (CAPTURE) баланса под заказ при create (FOR UPDATE).
 * Баланс уменьшается сразу — до оплаты или отмены/TTL (~60 мин).
 * RELEASE — при abandon/cancel/TTL/full refund.
 */
export async function holdGiftCertificateForOrder(
  tx: Prisma.TransactionClient,
  opts: {
    certificateId: string;
    orderId: string;
    applyAmount: number;
  },
): Promise<GiftApplyResult> {
  const amount = Math.floor(opts.applyAmount);
  if (amount < 1) {
    throw new BadRequestException('Сумма списания с сертификата должна быть ≥ 1');
  }

  return withLocalRlsBypass(tx, async () => {
    const locked = await tx.$queryRaw<LockedCert[]>`
      SELECT id, code, balance, "faceValue", status, "expiresAt"
      FROM "GiftCertificate"
      WHERE id = ${opts.certificateId}
      FOR UPDATE
    `;
    const row = locked[0];
    if (!row) throw new BadRequestException('Сертификат не найден');
    assertUsable(row);
    if (row.balance < amount) {
      throw new BadRequestException('Недостаточно средств на сертификате');
    }

    const nextBalance = row.balance - amount;
    const nextStatus =
      nextBalance <= 0
        ? GiftCertificateStatus.USED_UP
        : GiftCertificateStatus.ACTIVE;

    await tx.giftCertificate.update({
      where: { id: row.id },
      data: { balance: nextBalance, status: nextStatus },
    });
    await tx.giftCertificateLedger.create({
      data: {
        certificateId: row.id,
        kind: GiftCertificateLedgerKind.CAPTURE,
        amount: -amount,
        balanceAfter: nextBalance,
        orderId: opts.orderId,
        note: 'Резерв под заказ',
      },
    });

    return {
      certificateId: row.id,
      code: row.code,
      faceValue: row.faceValue,
      balance: nextBalance,
      applyAmount: amount,
      payableBeforeGift: amount, // caller fills real payable; kept for shape
      total: 0,
    };
  });
}

/**
 * Идемпотентный RELEASE по orderId (CAPTURE без RELEASE на этот certificateId).
 * REVOKED: баланс не восстанавливаем, но пишем RELEASE — иначе hold «сгорает»
 * без закрытия в ledger и повторные попытки не догоняют остальные CAPTURE.
 */
export async function releaseGiftCertificateForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  opts?: { note?: string },
): Promise<boolean> {
  return withLocalRlsBypass(tx, async () => {
    const captures = await tx.giftCertificateLedger.findMany({
      where: { orderId, kind: GiftCertificateLedgerKind.CAPTURE },
      orderBy: { createdAt: 'asc' },
    });
    if (!captures.length) return false;

    const alreadyReleased = await tx.giftCertificateLedger.findMany({
      where: { orderId, kind: GiftCertificateLedgerKind.RELEASE },
      select: { certificateId: true },
    });
    const releasedCertIds = new Set(alreadyReleased.map((r) => r.certificateId));

    const note = opts?.note?.trim() || 'Возврат при отмене заказа';
    let released = false;
    for (const cap of captures) {
      if (releasedCertIds.has(cap.certificateId)) continue;

      const restore = Math.abs(cap.amount);
      if (restore <= 0) continue;

      const locked = await tx.$queryRaw<LockedCert[]>`
        SELECT id, code, balance, "faceValue", status, "expiresAt"
        FROM "GiftCertificate"
        WHERE id = ${cap.certificateId}
        FOR UPDATE
      `;
      const row = locked[0];
      if (!row) continue;

      if (row.status === GiftCertificateStatus.REVOKED) {
        await tx.giftCertificateLedger.create({
          data: {
            certificateId: row.id,
            kind: GiftCertificateLedgerKind.RELEASE,
            amount: restore,
            balanceAfter: 0,
            orderId,
            note: `${note} (сертификат отозван — баланс не восстановлен)`,
          },
        });
        releasedCertIds.add(row.id);
        released = true;
        continue;
      }

      const nextBalance = row.balance + restore;
      const expired =
        row.expiresAt != null && row.expiresAt.getTime() <= Date.now();
      const nextStatus = expired
        ? GiftCertificateStatus.EXPIRED
        : GiftCertificateStatus.ACTIVE;

      await tx.giftCertificate.update({
        where: { id: row.id },
        data: { balance: nextBalance, status: nextStatus },
      });
      await tx.giftCertificateLedger.create({
        data: {
          certificateId: row.id,
          kind: GiftCertificateLedgerKind.RELEASE,
          amount: restore,
          balanceAfter: nextBalance,
          orderId,
          note,
        },
      });
      releasedCertIds.add(row.id);
      released = true;
    }
    return released;
  });
}

/**
 * Закрыть открытые CAPTURE сертификата RELEASE-ами без восстановления баланса.
 * Нужен при REVOKED (admin revoke / purchase refund), иначе hold «висит» в ledger.
 */
export async function closeOpenGiftCapturesOnRevoke(
  tx: Prisma.TransactionClient,
  certificateId: string,
  opts?: { actorUserId?: string | null; note?: string },
): Promise<number> {
  const openCaptures = await tx.giftCertificateLedger.findMany({
    where: {
      certificateId,
      kind: GiftCertificateLedgerKind.CAPTURE,
      orderId: { not: null },
    },
    select: { orderId: true, amount: true },
  });
  const note =
    opts?.note?.trim() ||
    'Закрытие hold при отзыве сертификата (баланс не восстановлен)';
  let n = 0;
  for (const cap of openCaptures) {
    if (!cap.orderId) continue;
    const hasRelease = await tx.giftCertificateLedger.count({
      where: {
        certificateId,
        orderId: cap.orderId,
        kind: GiftCertificateLedgerKind.RELEASE,
      },
    });
    if (hasRelease > 0) continue;
    const restore = Math.abs(cap.amount);
    if (restore < 1) continue;
    await tx.giftCertificateLedger.create({
      data: {
        certificateId,
        kind: GiftCertificateLedgerKind.RELEASE,
        amount: restore,
        balanceAfter: 0,
        orderId: cap.orderId,
        actorUserId: opts?.actorUserId ?? null,
        note,
      },
    });
    n += 1;
  }
  return n;
}

/**
 * Временный bypass RLS в текущей tx (нужен buyer checkout: CAPTURE/RELEASE чужого кода).
 * Восстанавливает предыдущее значение GUC.
 */
async function withLocalRlsBypass<T>(
  tx: Prisma.TransactionClient,
  fn: () => Promise<T>,
): Promise<T> {
  const rows = await tx.$queryRaw<Array<{ v: string | null }>>`
    SELECT current_setting('app.rls_bypass', true) AS v
  `;
  const prev = rows[0]?.v?.trim() ? rows[0].v! : 'off';
  await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
  try {
    return await fn();
  } finally {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', ${prev}, true)`;
  }
}
