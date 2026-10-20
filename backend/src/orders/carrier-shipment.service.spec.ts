import { describe, expect, it } from 'vitest';
import { buildCdekPackagesFromOrderItems } from './carrier-shipment.service';

describe('buildCdekPackagesFromOrderItems', () => {
  it('включает подарок благодарности в состав накладной СДЭК', () => {
    const pkgs = buildCdekPackagesFromOrderItems([
      {
        title: 'Крем',
        sku: '4610505200025',
        qty: 1,
        unitPrice: 5000,
        isGratitudeGift: false,
      },
      {
        title: 'Подарок',
        sku: '4694872410287',
        qty: 1,
        unitPrice: 0,
        isGratitudeGift: true,
      },
    ]);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0].items).toHaveLength(2);
    expect(pkgs[0].items[1]).toMatchObject({
      name: 'Подарок',
      ware_key: '4694872410287',
      cost: 0,
      amount: 1,
    });
  });
});
