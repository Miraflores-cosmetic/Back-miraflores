import { describe, expect, it } from 'vitest';
import {
  applyPercentOffLines,
  buildItemsSavePayload,
  estimateAfterItemsEdit,
  matchingPresetPct,
  priceAfterPercentOff,
  PCT_PRESETS,
  type DraftOrderLineLike,
} from './orderItemsEditHelpers';

function line(
  over: Partial<DraftOrderLineLike> & Pick<DraftOrderLineLike, 'key'>,
): DraftOrderLineLike {
  return {
    variantId: 'v1',
    shadeId: null,
    title: 'Serum',
    sku: 'SKU-1',
    qty: 1,
    unitPrice: 1000,
    originalUnitPrice: 1000,
    ...over,
  };
}

describe('priceAfterPercentOff / matchingPresetPct', () => {
  it('snapshot: пресеты −5/−10/−15/−20 от 1000', () => {
    expect(
      PCT_PRESETS.map((p) => ({
        pct: p,
        price: priceAfterPercentOff(1000, p),
      })),
    ).toEqual([
      { pct: 5, price: 950 },
      { pct: 10, price: 900 },
      { pct: 15, price: 850 },
      { pct: 20, price: 800 },
    ]);
  });

  it('не накапливает: повторный −10% от original, не от текущей', () => {
    const once = priceAfterPercentOff(1000, 10);
    expect(once).toBe(900);
    expect(priceAfterPercentOff(1000, 10)).toBe(900);
    expect(priceAfterPercentOff(once, 10)).toBe(810); // если ошибочно от текущей
  });

  it('matchingPresetPct узнаёт пресет', () => {
    expect(matchingPresetPct(1000, 900)).toBe(10);
    expect(matchingPresetPct(1000, 850)).toBe(15);
    expect(matchingPresetPct(1000, 877)).toBeNull();
  });

  it('clamp pct 0…100', () => {
    expect(priceAfterPercentOff(1000, -5)).toBe(1000);
    expect(priceAfterPercentOff(1000, 150)).toBe(0);
  });
});

describe('applyPercentOffLines', () => {
  it('режет только целевую строку; gift пропускает', () => {
    const lines = [
      line({ key: 'a', unitPrice: 1000, originalUnitPrice: 1000 }),
      line({
        key: 'gift',
        unitPrice: 0,
        originalUnitPrice: 0,
        isGratitudeGift: true,
      }),
      line({ key: 'b', unitPrice: 500, originalUnitPrice: 500 }),
    ];
    const next = applyPercentOffLines(lines, 10, 'a');
    expect(next.find((l) => l.key === 'a')?.unitPrice).toBe(900);
    expect(next.find((l) => l.key === 'b')?.unitPrice).toBe(500);
    expect(next.find((l) => l.key === 'gift')?.unitPrice).toBe(0);
  });

  it('bulk −% на все кроме gift', () => {
    const lines = [
      line({ key: 'a', originalUnitPrice: 1000, unitPrice: 1000 }),
      line({
        key: 'g',
        isGratitudeGift: true,
        originalUnitPrice: 0,
        unitPrice: 0,
      }),
    ];
    const next = applyPercentOffLines(lines, 20);
    expect(next[0].unitPrice).toBe(800);
    expect(next[1].unitPrice).toBe(0);
  });
});

describe('estimateAfterItemsEdit', () => {
  it('товары → промо clamp → gift clamp → доставка → итог / balanceDue', () => {
    // subtotal 400, promo was 500 → clamp 400; gift 800 → maxGift=0+100=100
    const e = estimateAfterItemsEdit({
      subtotal: 400,
      discountTotal: 500,
      giftCertificateAmount: 800,
      shippingCost: 100,
      netPaid: 0,
    });
    expect(e).toMatchObject({
      discount: 400,
      gift: 100,
      wallet: 0,
      shipping: 100,
      total: 0,
      balanceDue: 0,
      refundSuggested: 0,
      discountClamped: true,
      giftClamped: true,
      walletClamped: false,
    });
  });

  it('wallet clamp после gift (XOR обычно 0, но оценка безопасна)', () => {
    const e = estimateAfterItemsEdit({
      subtotal: 1000,
      discountTotal: 0,
      giftCertificateAmount: 0,
      referralWalletAmount: 900,
      shippingCost: 100,
      netPaid: 0,
    });
    expect(e.wallet).toBe(900);
    expect(e.total).toBe(200);
    expect(e.walletClamped).toBe(false);

    const clamped = estimateAfterItemsEdit({
      subtotal: 300,
      discountTotal: 0,
      giftCertificateAmount: 0,
      referralWalletAmount: 900,
      shippingCost: 0,
      netPaid: 0,
    });
    expect(clamped.wallet).toBe(300);
    expect(clamped.walletClamped).toBe(true);
    expect(clamped.total).toBe(0);
  });

  it('снижение товаров при netPaid → refundSuggested', () => {
    const e = estimateAfterItemsEdit({
      subtotal: 500,
      discountTotal: 0,
      giftCertificateAmount: 0,
      shippingCost: 0,
      netPaid: 1000,
    });
    expect(e.total).toBe(500);
    expect(e.refundSuggested).toBe(500);
    expect(e.balanceDue).toBe(0);
  });

  it('рост товаров при netPaid → balanceDue', () => {
    const e = estimateAfterItemsEdit({
      subtotal: 1500,
      discountTotal: 0,
      giftCertificateAmount: 0,
      shippingCost: 200,
      netPaid: 1000,
    });
    expect(e.total).toBe(1700);
    expect(e.balanceDue).toBe(700);
  });
});

describe('buildItemsSavePayload', () => {
  it('нормализует qty/price; gift → unitPrice 0', () => {
    const payload = buildItemsSavePayload(
      [
        line({
          key: 'a',
          qty: 2.6,
          unitPrice: 900.4,
          shadeId: 'sh1',
        }),
        line({
          key: 'g',
          isGratitudeGift: true,
          unitPrice: 999,
          originalUnitPrice: 0,
          qty: 0,
        }),
      ],
      true,
    );
    expect(payload).toEqual({
      notifyCustomer: true,
      items: [
        {
          variantId: 'v1',
          shadeId: 'sh1',
          qty: 3,
          unitPrice: 900,
          title: 'Serum',
          sku: 'SKU-1',
          isGratitudeGift: undefined,
        },
        {
          variantId: 'v1',
          shadeId: null,
          qty: 1,
          unitPrice: 0,
          title: 'Serum',
          sku: 'SKU-1',
          isGratitudeGift: true,
        },
      ],
    });
  });

  it('notifyCustomer: false в payload', () => {
    expect(buildItemsSavePayload([line({ key: 'a' })], false).notifyCustomer).toBe(
      false,
    );
  });
});
