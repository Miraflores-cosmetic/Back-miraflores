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

  it('refund режет только card-covered (не двойнит с wallet)', () => {
    // goods 5000, wallet 1000 → card 4000; refund 2000 → base 2000.
    expect(
      computeCommissionBase({
        subtotal: 5000,
        discountTotal: 0,
        giftCertificateAmount: 0,
        referralWalletAmount: 1000,
        refundedAmount: 2000,
      }),
    ).toBe(2000);
  });

  it('после proportional RELEASE remaining+released = исходный wallet', () => {
    // goods 10000, wallet 3000, card 7000; refund card 3500 → RELEASE 1500.
    // Без released: 10000−1500−3500=5000 (баг). С released: 10000−3000−3500=3500.
    expect(
      computeCommissionBase({
        subtotal: 10000,
        discountTotal: 0,
        giftCertificateAmount: 0,
        referralWalletAmount: 1500,
        referralWalletReleasedAmount: 1500,
        refundedAmount: 3500,
      }),
    ).toBe(3500);
    // goods 5000, wallet 1000; refund 2000 → RELEASE 500 → base остаётся 2000.
    expect(
      computeCommissionBase({
        subtotal: 5000,
        discountTotal: 0,
        giftCertificateAmount: 0,
        referralWalletAmount: 500,
        referralWalletReleasedAmount: 500,
        refundedAmount: 2000,
      }),
    ).toBe(2000);
  });
});
