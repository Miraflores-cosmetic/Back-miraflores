import { describe, expect, it } from 'vitest';
import {
  isVolumeOptionOutOfStock,
  volumeOptionFromCardVariant,
} from './index';

describe('volume-picker contract', () => {
  it('detects OOS by quantityAvailable', () => {
    expect(
      isVolumeOptionOutOfStock({
        id: 'a',
        label: '50',
        price: 1,
        quantityAvailable: 0,
        trackInventory: true,
      }),
    ).toBe(true);
    expect(
      isVolumeOptionOutOfStock({
        id: 'a',
        label: '50',
        price: 1,
        quantityAvailable: 2,
        trackInventory: true,
      }),
    ).toBe(false);
  });

  it('detects OOS by maxQty < minQty', () => {
    expect(
      isVolumeOptionOutOfStock({
        id: 'a',
        label: '50',
        price: 1,
        minQty: 2,
        maxQty: 1,
        quantityAvailable: 10,
        trackInventory: true,
      }),
    ).toBe(true);
  });

  it('maps admin card variant to contract', () => {
    const opt = volumeOptionFromCardVariant({
      id: 'v1',
      name: '100 мл',
      price: 1800,
      oldPrice: 2000,
      available: 3,
      minQty: 1,
      maxQty: 3,
    });
    expect(opt).toEqual({
      id: 'v1',
      label: '100 мл',
      price: 1800,
      oldPrice: 2000,
      quantityAvailable: 3,
      trackInventory: true,
      minQty: 1,
      maxQty: 3,
    });
  });
});
