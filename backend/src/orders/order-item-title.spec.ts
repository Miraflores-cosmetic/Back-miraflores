import { describe, expect, it } from 'vitest';
import { orderItemTitle } from './order-item-title';

describe('orderItemTitle', () => {
  it('берёт нац. каталог вместо витринного имени', () => {
    expect(
      orderItemTitle({
        nationalCatalogName: 'Крем для лица 50 мл',
        name: 'Крем',
        variantName: '50 мл',
        shadeName: null,
      }),
    ).toBe('Крем для лица 50 мл');
  });

  it('добавляет оттенок к нац. названию', () => {
    expect(
      orderItemTitle({
        nationalCatalogName: 'Помада',
        name: 'Lip',
        variantName: '3г',
        shadeName: 'Nude',
      }),
    ).toBe('Помада · Nude');
  });

  it('fallback: name · variant · shade', () => {
    expect(
      orderItemTitle({
        nationalCatalogName: null,
        name: 'Крем',
        variantName: '50 мл',
        shadeName: null,
      }),
    ).toBe('Крем · 50 мл');
  });
});
