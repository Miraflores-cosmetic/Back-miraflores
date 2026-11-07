import { describe, expect, it } from 'vitest';
import { OrderStatus } from '@prisma/client';
import {
  assertOrderEditable,
  balanceAfterTotal,
  netPaidAmount,
  recalcOrderTotal,
} from './order-admin-edit';

describe('order-admin-edit', () => {
  it('gen helpers: balance and total', () => {
    expect(recalcOrderTotal({
      subtotal: 1000,
      discountTotal: 100,
      giftCertificateAmount: 50,
      shippingCost: 200,
    })).toBe(1050);
    expect(recalcOrderTotal({
      subtotal: 1000,
      discountTotal: 0,
      giftCertificateAmount: 0,
      referralWalletAmount: 300,
      shippingCost: 200,
    })).toBe(900);

    expect(balanceAfterTotal(1200, 1000)).toEqual({
      balanceDue: 200,
      refundSuggested: 0,
    });
    expect(balanceAfterTotal(700, 1000)).toEqual({
      balanceDue: 0,
      refundSuggested: 300,
    });
  });

  it('netPaidAmount', () => {
    expect(
      netPaidAmount(
        [
          { status: 'SUCCEEDED', amount: 1000 },
          { status: 'PENDING', amount: 200 },
        ],
        100,
      ),
    ).toBe(900);
  });

  it('assertOrderEditable blocks shipped', () => {
    expect(() => assertOrderEditable(OrderStatus.SHIPPED)).toThrow();
    expect(() => assertOrderEditable(OrderStatus.PAID)).not.toThrow();
  });
});
