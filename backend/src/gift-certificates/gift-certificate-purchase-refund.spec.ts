import { BadRequestException } from '@nestjs/common';
import { GiftCertificateStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  analyzeGiftPurchaseSpend,
  assertGiftPurchaseCodesUnusedForRefund,
} from './gift-certificate-purchase.util';

describe('gift purchase refund after redeem', () => {
  it('unused codes → unused', () => {
    const certs = [
      {
        id: '1',
        code: 'JC-A',
        faceValue: 5000,
        balance: 5000,
        status: GiftCertificateStatus.ACTIVE,
      },
    ];
    const r = analyzeGiftPurchaseSpend(certs);
    expect(r.unused).toBe(true);
    expect(r.spentTotal).toBe(0);
    expect(() => assertGiftPurchaseCodesUnusedForRefund(certs)).not.toThrow();
  });

  it('partial spend → block refund', () => {
    const certs = [
      {
        id: '1',
        code: 'JC-A',
        faceValue: 5000,
        balance: 2000,
        status: GiftCertificateStatus.ACTIVE,
      },
    ];
    const r = analyzeGiftPurchaseSpend(certs);
    expect(r.unused).toBe(false);
    expect(r.spentTotal).toBe(3000);
    expect(() => assertGiftPurchaseCodesUnusedForRefund(certs)).toThrow(
      BadRequestException,
    );
    try {
      assertGiftPurchaseCodesUnusedForRefund(certs);
    } catch (e) {
      expect(String((e as Error).message)).toMatch(/уже использованы на 3000/);
      expect(String((e as Error).message)).toMatch(/clawback/i);
    }
  });

  it('USED_UP → block', () => {
    const certs = [
      {
        id: '1',
        code: 'JC-B',
        faceValue: 3000,
        balance: 0,
        status: GiftCertificateStatus.USED_UP,
      },
    ];
    expect(analyzeGiftPurchaseSpend(certs).spentTotal).toBe(3000);
    expect(() => assertGiftPurchaseCodesUnusedForRefund(certs)).toThrow(
      BadRequestException,
    );
  });

  it('REVOKED spent codes ignored (already closed)', () => {
    const r = analyzeGiftPurchaseSpend([
      {
        id: '1',
        code: 'JC-C',
        faceValue: 5000,
        balance: 0,
        status: GiftCertificateStatus.REVOKED,
      },
    ]);
    expect(r.unused).toBe(true);
  });
});
