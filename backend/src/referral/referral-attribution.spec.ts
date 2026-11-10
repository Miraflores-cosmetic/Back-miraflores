import { describe, expect, it } from 'vitest';
import {
  detectShippingOverlap,
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

describe('detectShippingOverlap', () => {
  it('совпадение ПВЗ', () => {
    expect(
      detectShippingOverlap(
        { pvzCode: 'msk45', city: 'Москва', address: 'ул. А' },
        [{ pvzCode: 'MSK45', city: 'Казань', address: 'ул. Б' }],
      ),
    ).toEqual({ suspect: true, reason: 'pvz:MSK45' });
  });

  it('совпадение city+address', () => {
    expect(
      detectShippingOverlap(
        { city: 'Москва', address: 'Тверская 1', pvzCode: null },
        [{ city: 'москва', address: 'тверская 1', pvzCode: null }],
      ).suspect,
    ).toBe(true);
  });

  it('разные адреса — без флага', () => {
    expect(
      detectShippingOverlap(
        { city: 'Москва', address: 'Тверская 1', pvzCode: 'A1' },
        [{ city: 'Москва', address: 'Арбат 2', pvzCode: 'B2' }],
      ),
    ).toEqual({ suspect: false, reason: null });
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
    ).toEqual({
      code: 'ANNA1',
      referrerUserId: 'u-ref',
      addressMatchSuspect: false,
      addressMatchReason: null,
    });
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

  it('адрес/ПВЗ совпал — attribution ok + suspect flag', () => {
    expect(
      resolveReferralAttribution({
        codeRaw: 'ANNA1',
        referrer,
        buyerUserId: 'u-buyer',
        buyerEmail: 'buyer@example.com',
        buyerPhones: ['+79009998877'],
        referrerPhones: ['+79001112233'],
        buyerShipping: { pvzCode: 'MSK45', city: 'Москва', address: 'x' },
        referrerShipments: [{ pvzCode: 'MSK45', city: 'Москва', address: 'y' }],
      }),
    ).toEqual({
      code: 'ANNA1',
      referrerUserId: 'u-ref',
      addressMatchSuspect: true,
      addressMatchReason: 'pvz:MSK45',
    });
  });

  it('shippingFingerprintFromJson читает pvz из заказа', async () => {
    const { shippingFingerprintFromJson } = await import(
      './referral-attribution'
    );
    expect(
      shippingFingerprintFromJson({
        city: 'Москва',
        address: 'ул. Тверская 1',
        postalCode: '125009',
        pvzCode: 'MSK45',
      }),
    ).toEqual({
      city: 'Москва',
      address: 'ул. Тверская 1',
      postalCode: '125009',
      pvzCode: 'MSK45',
    });
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
