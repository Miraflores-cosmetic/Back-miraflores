import { describe, expect, it } from 'vitest';
import {
  catalogGiftMixBlockedReason,
  draftLineFromGiftDenom,
  draftLineMergeKey,
  isGiftOnlyDraftLines,
  nextWizardStep,
  prevWizardStep,
  resolveCreateOrderUiFollowUp,
  step1FieldErrors,
  stepNextBlockedReason,
} from './helpers';
import type { DraftLine, ShippingDraft } from './types';

const line = (over: Partial<DraftLine> = {}): DraftLine => ({
  key: 'k1',
  variantId: 'v1',
  shadeId: null,
  shadeName: null,
  title: 'Товар',
  sku: 'SKU',
  catalogPrice: 1000,
  unitPrice: 1000,
  qty: 1,
  ...over,
});

const shipping = (): ShippingDraft =>
  ({
    selection: { dropoff: 'courier' },
    shippingCost: 100,
    shippingMethod: 'CDEK',
    address: {
      city: 'Москва',
      address: 'Тверская 1',
      apartment: '',
      region: '',
      district: '',
      postalCode: '',
      phone: '',
      recipientName: '',
      pvzCode: '',
      comment: 'x',
    },
  }) as ShippingDraft;

describe('stepNextBlockedReason', () => {
  it('user mode без userId блокирует шаг 1', () => {
    expect(
      stepNextBlockedReason({
        step: 1,
        clientMode: 'user',
        userId: null,
        customerName: 'Иван',
        email: 'a@b.com',
        phone: '+79991234567',
        lines: [],
        promoCode: '',
        giftCertificateCode: '',
        shipping: null,
      }),
    ).toMatch(/Выберите пользователя/);
  });

  it('guest с валидными полями — ок', () => {
    expect(
      stepNextBlockedReason({
        step: 1,
        clientMode: 'guest',
        userId: null,
        customerName: 'Иван',
        email: 'a@b.com',
        phone: '+79991234567',
        lines: [],
        promoCode: '',
        giftCertificateCode: '',
        shipping: null,
      }),
    ).toBeNull();
  });

  it('невалидный email на шаге 1', () => {
    expect(
      stepNextBlockedReason({
        step: 1,
        clientMode: 'guest',
        userId: null,
        customerName: 'Иван',
        email: 'not-an-email',
        phone: '+79991234567',
        lines: [],
        promoCode: '',
        giftCertificateCode: '',
        shipping: null,
      }),
    ).toMatch(/корректный email/i);
    expect(
      step1FieldErrors({
        clientMode: 'guest',
        userId: null,
        customerName: 'Иван',
        email: 'not-an-email',
        phone: '+79991234567',
      }).email,
    ).toMatch(/корректный email/i);
  });

  it('пустой состав блокирует шаг 2', () => {
    expect(
      stepNextBlockedReason({
        step: 2,
        clientMode: 'guest',
        userId: null,
        customerName: 'Иван',
        email: 'a@b.com',
        phone: '+79991234567',
        lines: [],
        promoCode: '',
        giftCertificateCode: '',
        shipping: null,
      }),
    ).toMatch(/позицию/);
  });

  it('promo+gift XOR на шаге 3', () => {
    expect(
      stepNextBlockedReason({
        step: 3,
        clientMode: 'guest',
        userId: null,
        customerName: 'Иван',
        email: 'a@b.com',
        phone: '+79991234567',
        lines: [line()],
        promoCode: 'SALE',
        giftCertificateCode: 'GIFT',
        shipping: null,
      }),
    ).toMatch(/взаимоисключающ/);
  });

  it('без доставки блокирует шаг 4', () => {
    expect(
      stepNextBlockedReason({
        step: 4,
        clientMode: 'guest',
        userId: null,
        customerName: 'Иван',
        email: 'a@b.com',
        phone: '+79991234567',
        lines: [line()],
        promoCode: '',
        giftCertificateCode: '',
        shipping: null,
      }),
    ).toMatch(/доставку/);
  });

  it('gift-only не требует доставку на шаге 4', () => {
    expect(
      stepNextBlockedReason({
        step: 4,
        clientMode: 'guest',
        userId: null,
        customerName: 'Иван',
        email: 'a@b.com',
        phone: '+79991234567',
        lines: [line({ variantId: 'gift-denom:d1' })],
        promoCode: '',
        giftCertificateCode: '',
        shipping: null,
        giftOnly: true,
      }),
    ).toBeNull();
  });

  it('gift-only шаги 3↔5', () => {
    expect(isGiftOnlyDraftLines([line({ variantId: 'gift-denom:d1' })])).toBe(
      true,
    );
    expect(isGiftOnlyDraftLines([line(), line({ variantId: 'gift-denom:d1' })])).toBe(
      false,
    );
    expect(nextWizardStep(3, true)).toBe(5);
    expect(prevWizardStep(5, true)).toBe(3);
  });

  it('draftLineMergeKey различает оттенки', () => {
    expect(draftLineMergeKey('v1', 'sh1')).not.toBe(draftLineMergeKey('v1', 'sh2'));
    expect(draftLineMergeKey('v1', null)).not.toBe(draftLineMergeKey('v1', 'sh1'));
  });

  it('catalog/gift mix blocked', () => {
    expect(
      catalogGiftMixBlockedReason([line()], 'gift'),
    ).toMatch(/отдельно/i);
    expect(
      catalogGiftMixBlockedReason(
        [line({ variantId: 'gift-denom:d1' })],
        'catalog',
      ),
    ).toMatch(/отдельно/i);
    expect(catalogGiftMixBlockedReason([], 'gift')).toBeNull();
  });

  it('draftLineFromGiftDenom', () => {
    const row = draftLineFromGiftDenom({
      id: 'd1',
      name: '3к',
      faceValue: 3000,
    });
    expect(row.variantId).toBe('gift-denom:d1');
    expect(row.unitPrice).toBe(3000);
    expect(row.shadeId).toBeNull();
  });

  it('resolveCreateOrderUiFollowUp', () => {
    expect(
      resolveCreateOrderUiFollowUp({
        payMode: 'awaiting_link',
        orderId: 'o1',
        orderNumber: 'N1',
        paymentLink: 'https://pay.example/x',
      }).kind,
    ).toBe('payment_link');
    expect(
      resolveCreateOrderUiFollowUp({
        payMode: 'awaiting_link',
        orderId: 'o1',
        orderNumber: 'N1',
        paymentLink: null,
        paymentError: 'ЮKassa down',
      }),
    ).toMatchObject({ kind: 'follow_up', message: 'ЮKassa down' });
    expect(
      resolveCreateOrderUiFollowUp({
        payMode: 'awaiting_link',
        orderId: 'o1',
        orderNumber: 'N1',
        paymentLink: null,
      }),
    ).toMatchObject({ kind: 'follow_up' });
    expect(
      resolveCreateOrderUiFollowUp({
        payMode: 'awaiting',
        orderId: 'o1',
        orderNumber: 'N1',
        paymentLink: null,
      }),
    ).toEqual({ kind: 'redirect', orderId: 'o1' });
  });

  it('шаг 5 ждёт preview', () => {
    expect(
      stepNextBlockedReason({
        step: 5,
        clientMode: 'guest',
        userId: null,
        customerName: 'Иван',
        email: 'a@b.com',
        phone: '+79991234567',
        lines: [line()],
        promoCode: '',
        giftCertificateCode: '',
        shipping: shipping(),
        hasPreview: false,
      }),
    ).toMatch(/превью/);
  });
});
