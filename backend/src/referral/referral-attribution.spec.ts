import { describe, expect, it } from 'vitest';
import {
  phonesOverlap,
  resolveReferralAttribution,
} from './referral-attribution';

const referrer = {
  id: 'u-ref',
  email: 'anna@example.com',
  referralCode: 'ANNA1',
  referralCodeActive: true,
  isActive: true,
};

describe('phonesOverlap', () => {
  it('совпадение last-10 при разных форматах', () => {
    expect(
      phonesOverlap(['8 (900) 111-22-33'], ['+7 900 111 22 33']),
    ).toBe(true);
  });

  it('короткие номера игнорируются', () => {
    expect(phonesOverlap(['12345'], ['12345'])).toBe(false);
  });

  it('любой из списка покупателя vs любой реферера', () => {
    expect(
      phonesOverlap(
        ['+79009998877', '8 900 111 22 33'],
        ['+79001112233', null],
      ),
    ).toBe(true);
  });
});

describe('resolveReferralAttribution', () => {
  it('ok для чужого покупателя', () => {
    expect(
      resolveReferralAttribution({
        codeRaw: 'anna1',
        referrer,
        buyerUserId: 'u-buyer',
        buyerEmail: 'buyer@example.com',
        buyerPhones: ['+79009998877'],
        referrerPhones: ['+79001112233'],
      }),
    ).toEqual({ code: 'ANNA1', referrerUserId: 'u-ref' });
  });

  it('self: тот же userId', () => {
    expect(
      resolveReferralAttribution({
        codeRaw: 'ANNA1',
        referrer,
        buyerUserId: 'u-ref',
        buyerEmail: 'other@example.com',
        buyerPhones: ['+79009998877'],
        referrerPhones: ['+79001112233'],
      }),
    ).toBeNull();
  });

  it('self: тот же email', () => {
    expect(
      resolveReferralAttribution({
        codeRaw: 'ANNA1',
        referrer,
        buyerUserId: null,
        buyerEmail: 'anna@example.com',
        buyerPhones: ['+79009998877'],
        referrerPhones: ['+79001112233'],
      }),
    ).toBeNull();
  });

  it('self: phone checkout совпал с реферером', () => {
    expect(
      resolveReferralAttribution({
        codeRaw: 'ANNA1',
        referrer,
        buyerUserId: 'u-buyer',
        buyerEmail: 'buyer@example.com',
        buyerPhones: ['8 (900) 111-22-33'],
        referrerPhones: ['+79001112233'],
      }),
    ).toBeNull();
  });

  it('self: shipping phone совпал с адресом реферера', () => {
    expect(
      resolveReferralAttribution({
        codeRaw: 'ANNA1',
        referrer,
        buyerUserId: 'u-buyer',
        buyerEmail: 'buyer@example.com',
        buyerPhones: ['+79009998877', '+79005554433'],
        referrerPhones: ['+79001112233', '+79005554433'],
      }),
    ).toBeNull();
  });

  it('неактивный код / юзер', () => {
    expect(
      resolveReferralAttribution({
        codeRaw: 'ANNA1',
        referrer: { ...referrer, referralCodeActive: false },
        buyerUserId: 'u-buyer',
        buyerEmail: 'buyer@example.com',
        buyerPhones: ['+79009998877'],
        referrerPhones: ['+79001112233'],
      }),
    ).toBeNull();
  });
});
