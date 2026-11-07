import { describe, expect, it } from 'vitest';
import { computeCommissionBase } from './commission-base';

describe('computeCommissionBase', () => {
  it('товары − скидка − сертификат − возвраты, без доставки', () => {
    expect(
      computeCommissionBase({
        subtotal: 5000,
        discountTotal: 250,
        giftCertificateAmount: 1000,
        refundedAmount: 0,
      }),
    ).toBe(3750);
    expect(
      computeCommissionBase({
        subtotal: 1000,
        discountTotal: 0,
        giftCertificateAmount: 0,
        refundedAmount: 400,
      }),
    ).toBe(600);
  });

  it('не уходит в минус', () => {
    expect(
      computeCommissionBase({
        subtotal: 100,
        discountTotal: 50,
        giftCertificateAmount: 200,
        refundedAmount: 0,
      }),
    ).toBe(0);
  });

  it('минус referralWalletAmount как store credit', () => {
    expect(
      computeCommissionBase({
        subtotal: 5000,
        discountTotal: 0,
        giftCertificateAmount: 0,
        referralWalletAmount: 1500,
        refundedAmount: 0,
      }),
    ).toBe(3500);
  });

  it('wallet > goods → earn base 0 (shipping-covered edge)', () => {
    // Wallet покрыл goods+часть доставки; commission base без shipping → 0.
    expect(
      computeCommissionBase({
        subtotal: 2000,
        discountTotal: 0,
        giftCertificateAmount: 0,
        referralWalletAmount: 2500,
        refundedAmount: 0,
      }),
    ).toBe(0);
  });
});
