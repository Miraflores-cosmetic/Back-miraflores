import { OrderStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  buildLeadFieldValuesName,
  computeYourichLeadEvent,
  computeYourichLeadSum,
  shouldSyncOrderToYourich,
} from './yourich-lead';

describe('yourich-lead', () => {
  it('сумма: товары − скидка − сертификат − возвраты, без доставки', () => {
    expect(
      computeYourichLeadSum({
        status: OrderStatus.PAID,
        number: 'M-1',
        subtotal: 5000,
        discountTotal: 250,
        giftCertificateAmount: 1000,
        refundedAmount: 0,
        customerName: 'Анна',
        giftPurchaseDenominationId: null,
      }),
    ).toBe(3750);
    expect(
      computeYourichLeadSum({
        status: OrderStatus.PAID,
        number: 'M-1',
        subtotal: 1000,
        discountTotal: 0,
        giftCertificateAmount: 0,
        refundedAmount: 400,
        customerName: null,
        giftPurchaseDenominationId: null,
      }),
    ).toBe(600);
  });

  it('event по статусу', () => {
    expect(computeYourichLeadEvent(OrderStatus.AWAITING_PAYMENT)).toBe('NEW');
    expect(computeYourichLeadEvent(OrderStatus.PAID)).toBe('DEAL');
    expect(computeYourichLeadEvent(OrderStatus.SHIPPED)).toBe('DEAL');
    expect(computeYourichLeadEvent(OrderStatus.CANCELLED)).toBe('CANCEL');
    expect(computeYourichLeadEvent(OrderStatus.REFUNDED)).toBe('CANCEL');
  });

  it('не синкает gift-only и заказы без атрибуции', () => {
    expect(
      shouldSyncOrderToYourich({
        giftPurchaseDenominationId: 'd1',
        refHash: 'abc',
        affiliatePromo: true,
      }),
    ).toBe(false);
    expect(
      shouldSyncOrderToYourich({
        giftPurchaseDenominationId: null,
        refHash: null,
        affiliatePromo: false,
      }),
    ).toBe(false);
    expect(
      shouldSyncOrderToYourich({
        giftPurchaseDenominationId: null,
        refHash: 'h',
        affiliatePromo: false,
      }),
    ).toBe(true);
    expect(
      shouldSyncOrderToYourich({
        giftPurchaseDenominationId: null,
        refHash: null,
        affiliatePromo: true,
      }),
    ).toBe(true);
  });

  it('leadFieldValues — JSON-строка с name', () => {
    expect(JSON.parse(buildLeadFieldValuesName('Анна'))).toEqual([
      { id: 'name', value: 'Анна' },
    ]);
  });
});
