import { describe, expect, it } from 'vitest';
import { listCardVolumeOptions, toCardVolumeOptions } from './catalog-card.util';

describe('listCardVolumeOptions', () => {
  const base = {
    orderMinQty: 1,
    orderMaxQty: null as number | null,
    stock: 10,
    stockReserve: 0,
    compareAt: null as number | null,
  };

  it('returns undefined for a single sellable volume', () => {
    expect(
      listCardVolumeOptions([
        { id: 'v1', name: '50 мл', price: 1000, ...base },
      ]),
    ).toBeUndefined();
  });

  it('caps maxQty at 1 for isSample without «пробник» in name', () => {
    const opts = toCardVolumeOptions([
      {
        id: 'v1',
        name: 'Крем 5 мл',
        isSample: true,
        price: 200,
        ...base,
        orderMaxQty: 10,
      },
      { id: 'v2', name: '50 мл', price: 1000, ...base },
    ]);
    const sample = opts.find((o) => o.id === 'v1');
    expect(sample).toBeUndefined();
    expect(opts).toHaveLength(1);
  });

  it('returns options when 2+ sellable volumes', () => {
    const opts = listCardVolumeOptions([
      { id: 'v1', name: '50 мл', price: 1000, ...base },
      { id: 'v2', name: '100 мл', price: 1800, ...base },
    ]);
    expect(opts).toHaveLength(2);
  });

  it('PLP JSON is smaller without variants[] on single-volume cards', () => {
    const manySingle = Array.from({ length: 24 }, (_, i) => ({
      id: `p${i}`,
      slug: `p${i}`,
      name: `Product ${i}`,
      productType: 'крем',
      price: 1000 + i,
      oldPrice: null,
      discountPercent: null,
      priceFrom: false,
      variantId: `v${i}`,
      variantName: '50 мл',
      available: 5,
      minQty: 1,
      maxQty: 5,
      imageUrl: '/uploads/x.jpg',
      imageUrls: ['/uploads/x.jpg'],
      mediaType: 'image' as const,
    }));

    const withVariants = manySingle.map((c) => ({
      ...c,
      variants: toCardVolumeOptions([
        {
          id: c.variantId!,
          name: '50 мл',
          price: c.price,
          compareAt: null,
          orderMinQty: 1,
          orderMaxQty: null,
          stock: 10,
          stockReserve: 0,
        },
      ]),
    }));

    const leanBytes = Buffer.byteLength(JSON.stringify(manySingle), 'utf8');
    const fatBytes = Buffer.byteLength(JSON.stringify(withVariants), 'utf8');
    expect(leanBytes).toBeLessThan(fatBytes);
    expect(fatBytes - leanBytes).toBeGreaterThan(1200);
  });
});
