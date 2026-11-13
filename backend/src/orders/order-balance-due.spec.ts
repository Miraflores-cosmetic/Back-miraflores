import { describe, expect, it } from 'vitest';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import {
  pickReusableSurchargePayment,
  resolveOrderBalanceFields,
} from './order-balance-due';

describe('resolveOrderBalanceFields', () => {
  it('PACKING + net under total → balanceDue + canPayBalance', () => {
    const res = resolveOrderBalanceFields(
      {
        total: 20_061,
        refundedAmount: 20_061,
        status: OrderStatus.PACKING,
        giftPurchaseDenominationId: null,
      },
      [{ status: PaymentStatus.REFUNDED, amount: 20_061 }],
    );
    expect(res.balanceDue).toBe(20_061);
    expect(res.canPayBalance).toBe(true);
  });

  it('no balance → canPayBalance false', () => {
    const res = resolveOrderBalanceFields(
      {
        total: 1000,
        refundedAmount: 0,
        status: OrderStatus.PACKING,
        giftPurchaseDenominationId: null,
      },
      [{ status: PaymentStatus.SUCCEEDED, amount: 1000 }],
    );
    expect(res.balanceDue).toBe(0);
    expect(res.canPayBalance).toBe(false);
  });
});

describe('pickReusableSurchargePayment', () => {
  it('находит PENDING surcharge с нужной суммой', () => {
    const row = pickReusableSurchargePayment(
      [
        {
          status: PaymentStatus.PENDING,
          amount: 500,
          externalId: 'yk1',
          confirmationUrl: 'https://yoomoney.ru/x',
          raw: { kind: 'surcharge' },
        },
      ],
      500,
    );
    expect(row?.externalId).toBe('yk1');
  });
});
