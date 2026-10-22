import { describe, expect, it } from 'vitest';
import {
  buildOrdersCommerceMl,
  orderItemsForOnecExport,
  pricedLinesForOnecExport,
} from './onec-orders.xml';

describe('orderItemsForOnecExport', () => {
  it('includes gratitude gifts with onecId; skips lines without onecId', () => {
    const items = [
      {
        isGratitudeGift: true,
        sku: 'gift',
        variant: { onecId: 'aaa' },
      },
      {
        isGratitudeGift: false,
        sku: 'saleor-v542',
        variant: null,
      },
      {
        isGratitudeGift: false,
        sku: '4610505200353',
        variant: { onecId: '4f3ecdf1-4302-11f1-9a50-f662e7beb2aa' },
      },
    ] as Parameters<typeof orderItemsForOnecExport>[0];

    const out = orderItemsForOnecExport(items);
    expect(out.map((i) => i.sku)).toEqual(['gift', '4610505200353']);
  });
});

function item(opts: {
  id: string;
  sku: string;
  title?: string;
  qty: number;
  unitPrice: number;
  onecId?: string | null;
  isGratitudeGift?: boolean;
}) {
  return {
    id: opts.id,
    sku: opts.sku,
    title: opts.title ?? opts.sku,
    qty: opts.qty,
    unitPrice: opts.unitPrice,
    lineTotal: opts.unitPrice * opts.qty,
    isGratitudeGift: opts.isGratitudeGift ?? false,
    variant:
      opts.onecId === null
        ? null
        : { onecId: opts.onecId ?? `onec-${opts.id}` },
  };
}

describe('pricedLinesForOnecExport', () => {
  it('scales line prices so goods + shipping = order.total (promo)', () => {
    const items = [
      item({ id: 'a', sku: 'A', qty: 1, unitPrice: 1000 }),
      item({ id: 'b', sku: 'B', qty: 1, unitPrice: 1000 }),
    ] as Parameters<typeof pricedLinesForOnecExport>[0]['items'];

    // subtotal 2000, promo 500, shipping 300 → total 1800
    const priced = pricedLinesForOnecExport({
      total: 1800,
      shippingCost: 300,
      items,
    });

    const goodsSum = priced.reduce((s, l) => s + l.lineTotal, 0);
    expect(goodsSum).toBe(1500);
    expect(priced.map((l) => l.unitPrice)).toEqual([750, 750]);
    expect(priced.every((l) => l.lineTotal === l.unitPrice * l.item.qty)).toBe(
      true,
    );
  });

  it('keeps free gratitude gifts at 0', () => {
    const items = [
      item({ id: 'a', sku: 'A', qty: 1, unitPrice: 2000 }),
      item({
        id: 'g',
        sku: 'gift',
        qty: 1,
        unitPrice: 0,
        isGratitudeGift: true,
      }),
    ] as Parameters<typeof pricedLinesForOnecExport>[0]['items'];

    const priced = pricedLinesForOnecExport({
      total: 1500,
      shippingCost: 0,
      items,
    });

    expect(priced.find((l) => l.item.sku === 'gift')!.lineTotal).toBe(0);
    expect(priced.find((l) => l.item.sku === 'A')!.lineTotal).toBe(1500);
  });

  it('writes discounted unit prices into CommerceML XML', () => {
    const order = {
      id: 'ord-1',
      number: '000027',
      createdAt: new Date('2026-01-15T12:00:00Z'),
      email: 'a@b.c',
      phone: '+7000',
      customerName: 'Test',
      customerNote: null,
      userId: null,
      guestId: 'g1',
      status: 'PAID',
      shippingMethod: 'courier',
      shippingAddress: { city: 'Москва' },
      shippingCost: 0,
      total: 800,
      discountTotal: 200,
      subtotal: 1000,
      giftCertificateAmount: 0,
      items: [
        item({ id: 'a', sku: 'SKU1', title: 'Товар', qty: 1, unitPrice: 1000 }),
      ],
      payments: [{ status: 'SUCCEEDED' }],
    };

    const xml = buildOrdersCommerceMl([order as never]);
    expect(xml).toContain('<Сумма>800</Сумма>');
    expect(xml).toContain('<ЦенаЗаЕдиницу>800</ЦенаЗаЕдиницу>');
    expect(xml).toContain('<Номер>000027</Номер>');
    expect(xml).not.toContain('<ЦенаЗаЕдиницу>1000</ЦенаЗаЕдиницу>');
  });
});
