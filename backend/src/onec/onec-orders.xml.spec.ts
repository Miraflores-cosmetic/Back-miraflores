import { describe, expect, it } from 'vitest';
import { orderItemsForOnecExport } from './onec-orders.xml';

describe('orderItemsForOnecExport', () => {
  it('skips gratitude gifts and lines without onecId', () => {
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
    expect(out).toHaveLength(1);
    expect(out[0]?.sku).toBe('4610505200353');
  });
});
