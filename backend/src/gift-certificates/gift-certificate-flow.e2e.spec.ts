import { describe, expect, it, vi } from 'vitest';
import {
  GiftCertificateLedgerKind,
  GiftCertificateStatus,
} from '@prisma/client';
import {
  holdGiftCertificateForOrder,
  releaseGiftCertificateForOrder,
} from './gift-certificate-hold.util';
import { expireOverdueGiftCertificates } from './gift-certificate-expire.util';

/**
 * E2E-поток без HTTP: issue → CAPTURE (checkout) → RELEASE (cancel / full refund).
 * Stateful in-memory store вместо Prisma.
 */
function createGiftStore(seed: {
  id: string;
  code: string;
  faceValue: number;
  balance: number;
  status: GiftCertificateStatus;
  expiresAt?: Date | null;
}) {
  const cert = { ...seed, expiresAt: seed.expiresAt ?? null };
  const ledger: Array<{
    id: string;
    certificateId: string;
    kind: GiftCertificateLedgerKind;
    amount: number;
    balanceAfter: number;
    orderId: string | null;
    note: string | null;
  }> = [];
  let ledgerSeq = 0;

  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = String(strings);
      if (sql.includes('current_setting')) return [{ v: 'off' }];
      if (sql.includes('FOR UPDATE') || sql.includes('GiftCertificate')) {
        return [
          {
            id: cert.id,
            code: cert.code,
            balance: cert.balance,
            faceValue: cert.faceValue,
            status: cert.status,
            expiresAt: cert.expiresAt,
          },
        ];
      }
      return [];
    }),
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    giftCertificate: {
      update: vi.fn().mockImplementation(async ({ data }: { data: Partial<typeof cert> }) => {
        Object.assign(cert, data);
        return { ...cert };
      }),
      updateMany: vi.fn().mockImplementation(
        async ({
          where,
          data,
        }: {
          where: { status?: GiftCertificateStatus; expiresAt?: { lte: Date } };
          data: { status: GiftCertificateStatus };
        }) => {
          if (
            where.status === cert.status &&
            where.expiresAt?.lte &&
            cert.expiresAt &&
            cert.expiresAt.getTime() <= where.expiresAt.lte.getTime()
          ) {
            cert.status = data.status;
            return { count: 1 };
          }
          return { count: 0 };
        },
      ),
    },
    giftCertificateLedger: {
      findMany: vi.fn().mockImplementation(
        async ({
          where,
        }: {
          where: {
            orderId?: string | null;
            certificateId?: string;
            kind?:
              | GiftCertificateLedgerKind
              | { in: GiftCertificateLedgerKind[] };
          };
        }) =>
          ledger.filter((e) => {
            if (
              where.orderId !== undefined &&
              e.orderId !== where.orderId
            ) {
              return false;
            }
            if (
              where.certificateId !== undefined &&
              e.certificateId !== where.certificateId
            ) {
              return false;
            }
            if (where.kind == null) return true;
            if (typeof where.kind === 'object' && 'in' in where.kind) {
              return where.kind.in.includes(e.kind);
            }
            return e.kind === where.kind;
          }),
      ),
      count: vi.fn().mockImplementation(
        async ({
          where,
        }: {
          where: {
            orderId?: string | null;
            certificateId?: string;
            kind?: GiftCertificateLedgerKind;
          };
        }) =>
          ledger.filter((e) => {
            if (
              where.orderId !== undefined &&
              e.orderId !== where.orderId
            ) {
              return false;
            }
            if (
              where.certificateId !== undefined &&
              e.certificateId !== where.certificateId
            ) {
              return false;
            }
            if (where.kind != null && e.kind !== where.kind) return false;
            return true;
          }).length,
      ),
      create: vi.fn().mockImplementation(
        async ({
          data,
        }: {
          data: {
            certificateId: string;
            kind: GiftCertificateLedgerKind;
            amount: number;
            balanceAfter: number;
            orderId?: string | null;
            note?: string | null;
          };
        }) => {
          const row = {
            id: `led-${++ledgerSeq}`,
            certificateId: data.certificateId,
            kind: data.kind,
            amount: data.amount,
            balanceAfter: data.balanceAfter,
            orderId: data.orderId ?? null,
            note: data.note ?? null,
          };
          ledger.push(row);
          return row;
        },
      ),
    },
  };

  return { cert, ledger, tx };
}

describe('gift certificate flow E2E', () => {
  it('issue → redeem CAPTURE → cancel RELEASE восстанавливает баланс', async () => {
    const { cert, ledger, tx } = createGiftStore({
      id: 'c1',
      code: 'JC-FLOW-TEST-0001',
      faceValue: 2000,
      balance: 2000,
      status: GiftCertificateStatus.ACTIVE,
    });

    // ISSUE (как admin issue)
    ledger.push({
      id: 'led-issue',
      certificateId: cert.id,
      kind: GiftCertificateLedgerKind.ISSUE,
      amount: 2000,
      balanceAfter: 2000,
      orderId: null,
      note: 'Выпуск',
    });

    await holdGiftCertificateForOrder(tx as never, {
      certificateId: cert.id,
      orderId: 'ord-awaiting',
      applyAmount: 2000,
    });
    expect(cert.balance).toBe(0);
    expect(cert.status).toBe(GiftCertificateStatus.USED_UP);
    expect(ledger.some((e) => e.kind === GiftCertificateLedgerKind.CAPTURE)).toBe(
      true,
    );

    const released = await releaseGiftCertificateForOrder(tx as never, 'ord-awaiting', {
      note: 'Возврат при отмене заказа',
    });
    expect(released).toBe(true);
    expect(cert.balance).toBe(2000);
    expect(cert.status).toBe(GiftCertificateStatus.ACTIVE);
    expect(ledger.some((e) => e.kind === GiftCertificateLedgerKind.RELEASE)).toBe(
      true,
    );
  });

  it('issue → redeem → full refund RELEASE (как PAID refund)', async () => {
    const { cert, tx } = createGiftStore({
      id: 'c2',
      code: 'JC-FLOW-TEST-0002',
      faceValue: 5000,
      balance: 5000,
      status: GiftCertificateStatus.ACTIVE,
    });

    await holdGiftCertificateForOrder(tx as never, {
      certificateId: cert.id,
      orderId: 'ord-paid',
      applyAmount: 2000,
    });
    expect(cert.balance).toBe(3000);
    expect(cert.status).toBe(GiftCertificateStatus.ACTIVE);

    // Partial: RELEASE не зовём (как admin refund partial)
    expect(cert.balance).toBe(3000);

    // Full refund
    const released = await releaseGiftCertificateForOrder(tx as never, 'ord-paid', {
      note: 'Возврат при полном refund заказа',
    });
    expect(released).toBe(true);
    expect(cert.balance).toBe(5000);
    expect(cert.status).toBe(GiftCertificateStatus.ACTIVE);

    // Идемпотентность второго RELEASE
    const again = await releaseGiftCertificateForOrder(tx as never, 'ord-paid');
    expect(again).toBe(false);
    expect(cert.balance).toBe(5000);
  });

  it('release→re-hold (clamp) → full RELEASE снимает только net', async () => {
    const { cert, tx } = createGiftStore({
      id: 'c3',
      code: 'JC-FLOW-TEST-0003',
      faceValue: 5000,
      balance: 5000,
      status: GiftCertificateStatus.ACTIVE,
    });

    await holdGiftCertificateForOrder(tx as never, {
      certificateId: cert.id,
      orderId: 'ord-clamp',
      applyAmount: 800,
    });
    expect(cert.balance).toBe(4200);

    await releaseGiftCertificateForOrder(tx as never, 'ord-clamp', {
      note: 'Пересчёт при изменении состава',
    });
    expect(cert.balance).toBe(5000);

    await holdGiftCertificateForOrder(tx as never, {
      certificateId: cert.id,
      orderId: 'ord-clamp',
      applyAmount: 100,
    });
    expect(cert.balance).toBe(4900);

    const released = await releaseGiftCertificateForOrder(tx as never, 'ord-clamp', {
      note: 'Возврат при полном refund заказа',
    });
    expect(released).toBe(true);
    expect(cert.balance).toBe(5000);
  });

  it('expire worker не трогает USED_UP (только ACTIVE + expiresAt)', async () => {
    const past = new Date(Date.now() - 86_400_000);
    const usedUp = createGiftStore({
      id: 'c-used',
      code: 'JC-USED-UP-0001',
      faceValue: 1000,
      balance: 0,
      status: GiftCertificateStatus.USED_UP,
      expiresAt: past,
    });
    const activeExpired = createGiftStore({
      id: 'c-act',
      code: 'JC-ACT-EXP-0001',
      faceValue: 1000,
      balance: 500,
      status: GiftCertificateStatus.ACTIVE,
      expiresAt: past,
    });

    const n1 = await expireOverdueGiftCertificates(usedUp.tx as never, new Date());
    expect(n1).toBe(0);
    expect(usedUp.cert.status).toBe(GiftCertificateStatus.USED_UP);

    const n2 = await expireOverdueGiftCertificates(
      activeExpired.tx as never,
      new Date(),
    );
    expect(n2).toBe(1);
    expect(activeExpired.cert.status).toBe(GiftCertificateStatus.EXPIRED);
  });
});
