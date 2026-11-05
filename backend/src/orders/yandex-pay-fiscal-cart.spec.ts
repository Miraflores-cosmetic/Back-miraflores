import { describe, expect, it } from 'vitest';
import {
  buildYandexPayFiscalCart,
  scaleLineTotalsTo,
} from './yandex-pay-fiscal-cart';

function sum(items: { totalRub: number }[]) {
  return items.reduce((s, i) => s + i.totalRub, 0);
}

describe('buildYandexPayFiscalCart', () => {
  it('plain goods: без правок', () => {
    const items = buildYandexPayFiscalCart({
      number: 'MF-1',
      total: 1500,
      shippingCost: 0,
      items: [
        {
          id: 'i1',
          variantId: 'v1',
          title: 'Крем',
          qty: 1,
          unitPrice: 1500,
        },
      ],
    });
    expect(items).toEqual([
      {
        productId: 'v1',
        title: 'Крем',
        quantity: 1,
        totalRub: 1500,
      },
    ]);
  });

  it('shipping-as-line: total = goods + shipping', () => {
    const items = buildYandexPayFiscalCart({
      number: 'MF-1',
      total: 1300,
      shippingCost: 300,
      items: [
        {
          id: 'i1',
          variantId: 'v1',
          title: 'Крем',
          qty: 1,
          unitPrice: 1000,
        },
      ],
    });
    expect(sum(items)).toBe(1300);
    expect(items.find((i) => i.productId === 'shipping')).toEqual({
      productId: 'shipping',
      title: 'Доставка',
      quantity: 1,
      totalRub: 300,
    });
    expect(items.find((i) => i.productId === 'v1')?.totalRub).toBe(1000);
  });

  it('promo ratio shrink без доставки', () => {
    const items = buildYandexPayFiscalCart({
      number: 'MF-1',
      total: 800,
      shippingCost: 0,
      items: [
        {
          id: 'i1',
          variantId: 'v1',
          title: 'A',
          qty: 1,
          unitPrice: 600,
        },
        {
          id: 'i2',
          variantId: 'v2',
          title: 'B',
          qty: 1,
          unitPrice: 400,
        },
      ],
    });
    expect(sum(items)).toBe(800);
    expect(items.every((i) => i.productId !== 'shipping')).toBe(true);
  });

  it('promo + shipping: товары сжимаются, доставка отдельной строкой', () => {
    // goods 1000, promo −200 → 800; ship 300 → total 1100
    const items = buildYandexPayFiscalCart({
      number: 'MF-1',
      total: 1100,
      shippingCost: 300,
      items: [
        {
          id: 'i1',
          variantId: 'v1',
          title: 'Крем',
          qty: 1,
          unitPrice: 1000,
        },
      ],
    });
    expect(sum(items)).toBe(1100);
    expect(items.find((i) => i.productId === 'shipping')?.totalRub).toBe(300);
    expect(items.find((i) => i.productId === 'v1')?.totalRub).toBe(800);
  });

  it('gift certificate + shipping: goodsTarget = total − ship', () => {
    // goods 1000 + ship 300 − gift 500 = 800
    const items = buildYandexPayFiscalCart({
      number: 'MF-1',
      total: 800,
      shippingCost: 300,
      items: [
        {
          id: 'i1',
          variantId: 'v1',
          title: 'Крем',
          qty: 1,
          unitPrice: 1000,
        },
      ],
    });
    expect(sum(items)).toBe(800);
    expect(items.find((i) => i.productId === 'shipping')?.totalRub).toBe(300);
    expect(items.find((i) => i.productId === 'v1')?.totalRub).toBe(500);
  });

  it('gift съел доставку (ship ≥ total): без отдельной shipping, ratio в товары', () => {
    // goods 200 + ship 300 − gift 450 = 50
    const items = buildYandexPayFiscalCart({
      number: 'MF-1',
      total: 50,
      shippingCost: 300,
      items: [
        {
          id: 'i1',
          variantId: 'v1',
          title: 'Крем',
          qty: 1,
          unitPrice: 200,
        },
      ],
    });
    expect(sum(items)).toBe(50);
    expect(items.find((i) => i.productId === 'shipping')).toBeUndefined();
    expect(items[0]?.totalRub).toBe(50);
  });

  it('gratitude gifts исключаются', () => {
    const items = buildYandexPayFiscalCart({
      number: 'MF-1',
      total: 1000,
      shippingCost: 0,
      items: [
        {
          id: 'i1',
          variantId: 'v1',
          title: 'Крем',
          qty: 1,
          unitPrice: 1000,
        },
        {
          id: 'g1',
          variantId: 'gift',
          title: 'Подарок',
          qty: 1,
          unitPrice: 0,
          isGratitudeGift: true,
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].productId).toBe('v1');
    expect(sum(items)).toBe(1000);
  });

  it('gift-denom only (нет paid lines) → одна позиция', () => {
    const items = buildYandexPayFiscalCart({
      number: 'MF-G',
      total: 3000,
      shippingCost: 0,
      giftPurchaseDenominationId: 'den1',
      items: [],
    });
    expect(items).toEqual([
      {
        productId: 'gift-cert',
        title: 'Сертификат MF-G',
        quantity: 1,
        totalRub: 3000,
      },
    ]);
  });

  it('qty>1: totalRub = unit × qty до scale', () => {
    const items = buildYandexPayFiscalCart({
      number: 'MF-1',
      total: 1800,
      shippingCost: 0,
      items: [
        {
          id: 'i1',
          variantId: 'v1',
          title: 'Крем',
          qty: 2,
          unitPrice: 1000,
        },
      ],
    });
    expect(sum(items)).toBe(1800);
    expect(items[0].quantity).toBe(2);
    expect(items[0].totalRub).toBe(1800);
  });
});

describe('scaleLineTotalsTo', () => {
  it('копейки на последней позиции', () => {
    const out = scaleLineTotalsTo(
      [
        { productId: 'a', title: 'A', quantity: 1, totalRub: 100 },
        { productId: 'b', title: 'B', quantity: 1, totalRub: 100 },
        { productId: 'c', title: 'C', quantity: 1, totalRub: 100 },
      ],
      100,
    );
    expect(sum(out)).toBe(100);
  });

  it('агрессивный shrink не раздувает сумму через max(1)', () => {
    const out = scaleLineTotalsTo(
      [
        { productId: 'a', title: 'A', quantity: 1, totalRub: 500 },
        { productId: 'b', title: 'B', quantity: 1, totalRub: 500 },
      ],
      1,
    );
    expect(sum(out)).toBe(1);
  });
});
