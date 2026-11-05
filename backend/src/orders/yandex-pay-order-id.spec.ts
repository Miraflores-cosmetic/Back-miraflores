import { describe, expect, it } from 'vitest';
import {
  nextYandexPayMerchantOrderId,
  parseYandexPayAttempt,
} from './yandex-pay-order-id';

describe('yandex-pay-order-id', () => {
  const orderId = 'ord-abc';

  it('parse: Order.id → attempt 1 (legacy)', () => {
    expect(parseYandexPayAttempt(orderId, orderId)).toBe(1);
  });

  it('parse: versioned id', () => {
    expect(parseYandexPayAttempt(orderId, `${orderId}:3`)).toBe(3);
  });

  it('next: пусто → :1', () => {
    expect(nextYandexPayMerchantOrderId(orderId, [])).toBe(`${orderId}:1`);
  });

  it('next: после :2 и legacy → :3', () => {
    expect(
      nextYandexPayMerchantOrderId(orderId, [
        orderId,
        `${orderId}:2`,
        'yp-ord-abc-uuid',
      ]),
    ).toBe(`${orderId}:3`);
  });
});
