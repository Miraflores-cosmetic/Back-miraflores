import { beforeEach, describe, expect, it, vi } from 'vitest';

const categoryFindMany = vi.fn();
const productFindMany = vi.fn();
const catalogTagFindMany = vi.fn();
const collectionFindMany = vi.fn();
const blogPostFindMany = vi.fn();
const resolveFromUserId = vi.fn();
const resolveVariantPrices = vi.fn();
const applyVariantVisibilityToProductSources = vi.fn();

vi.mock('../prisma/prisma.service', () => ({
  PrismaService: class {
    category = { findMany: categoryFindMany };
    product = { findMany: productFindMany };
    catalogTag = { findMany: catalogTagFindMany };
    collection = { findMany: collectionFindMany };
    blogPost = { findMany: blogPostFindMany };
  },
}));

vi.mock('../user-groups/commerce-context.service', () => ({
  CommerceContextService: class {
    resolveFromUserId = resolveFromUserId;
  },
}));

vi.mock('../user-groups/group-pricing.service', () => ({
  GroupPricingService: class {
    resolveVariantPrices = resolveVariantPrices;
  },
}));

vi.mock('../user-groups/catalog-visibility.service', () => ({
  CatalogVisibilityService: class {
    applyVariantVisibilityToProductSources =
      applyVariantVisibilityToProductSources;
  },
}));

import {
  normalizeSearchText,
  scoreTitleMatch,
  searchForms,
  SearchPublicService,
} from './search.public.service';
import { PrismaService } from '../prisma/prisma.service';
import { CommerceContextService } from '../user-groups/commerce-context.service';
import { GroupPricingService } from '../user-groups/group-pricing.service';
import { CatalogVisibilityService } from '../user-groups/catalog-visibility.service';

function makeService() {
  return new SearchPublicService(
    new PrismaService() as never,
    new CommerceContextService() as never,
    new GroupPricingService() as never,
    new CatalogVisibilityService() as never,
  );
}

describe('search helpers', () => {
  it('normalizeSearchText: lower + ё→е', () => {
    expect(normalizeSearchText('  Ёлка  ')).toBe('елка');
  });

  it('searchForms: добавляет вариант без ё', () => {
    expect(searchForms('чёрный')).toEqual(['чёрный', 'черный']);
    expect(searchForms('крем')).toEqual(['крем']);
  });

  it('scoreTitleMatch: exact > prefix > contains > composition-only', () => {
    expect(scoreTitleMatch('Крем', 'крем')).toBe(100);
    expect(scoreTitleMatch('Крем для лица', 'крем')).toBe(80);
    expect(scoreTitleMatch('Ночной крем', 'крем')).toBe(40);
    expect(scoreTitleMatch('Тональный', 'sku-xyz')).toBe(10);
    expect(scoreTitleMatch('Ретинол сыворотка', 'ретинол')).toBeGreaterThan(
      scoreTitleMatch('Крем с ниацинамидом', 'ретинол'),
    );
  });
});

describe('SearchPublicService.search', () => {
  let service: SearchPublicService;

  beforeEach(() => {
    categoryFindMany.mockReset();
    productFindMany.mockReset();
    catalogTagFindMany.mockReset();
    collectionFindMany.mockReset();
    blogPostFindMany.mockReset();
    resolveFromUserId.mockReset();
    resolveVariantPrices.mockReset();
    applyVariantVisibilityToProductSources.mockReset();

    categoryFindMany.mockResolvedValue([]);
    productFindMany.mockResolvedValue([]);
    catalogTagFindMany.mockResolvedValue([]);
    collectionFindMany.mockResolvedValue([]);
    blogPostFindMany.mockResolvedValue([]);
    resolveFromUserId.mockResolvedValue({
      kind: 'guest',
      groupId: 'g',
      allowCatalogDiscounts: true,
      priceRounding: 'NONE',
    });
    applyVariantVisibilityToProductSources.mockImplementation(
      async (_ctx: unknown, sources: unknown) => sources,
    );
    resolveVariantPrices.mockResolvedValue(new Map());

    service = makeService();
  });

  it('q < 2 → пустые groups без запросов', async () => {
    const res = await service.search('а');
    expect(res.groups).toEqual([]);
    expect(productFindMany).not.toHaveBeenCalled();
  });

  it('фаза 1: name/sku; фаза 2: compositionSearchText (content)', async () => {
    await service.search('nude');
    expect(productFindMany).toHaveBeenCalledTimes(2);
    const primaryBlob = JSON.stringify(productFindMany.mock.calls[0]![0].where);
    const contentBlob = JSON.stringify(productFindMany.mock.calls[1]![0].where);
    expect(primaryBlob).toContain('shortDescription');
    expect(primaryBlob).toContain('sku');
    expect(primaryBlob).not.toContain('compositionSearchText');
    expect(contentBlob).toContain('compositionSearchText');
  });

  it('html-noise q: не ходит в composition/body', async () => {
    await service.search('div');
    expect(productFindMany).toHaveBeenCalledTimes(1);
    expect(blogPostFindMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(productFindMany.mock.calls[0]![0].where)).not.toContain(
      'compositionSearchText',
    );
  });

  it('статьи: title/excerpt → bodySearchText', async () => {
    await service.search('ретинол');
    expect(blogPostFindMany).toHaveBeenCalledTimes(2);
    const primaryBlob = JSON.stringify(blogPostFindMany.mock.calls[0]![0].where);
    const bodyBlob = JSON.stringify(blogPostFindMany.mock.calls[1]![0].where);
    expect(primaryBlob).toContain('title');
    expect(primaryBlob).not.toContain('bodySearchText');
    expect(bodyBlob).toContain('bodySearchText');
  });

  it('blog subtitle strips HTML excerpt', async () => {
    productFindMany.mockResolvedValue([]);
    blogPostFindMany
      .mockResolvedValueOnce([
        {
          id: 'p1',
          title: 'Про ретинол',
          slug: 'retinol',
          excerpt: '<p>Сыворотка <strong>с ретинолом</strong></p>',
          coverUrl: null,
          category: null,
        },
      ])
      .mockResolvedValueOnce([]);
    const res = await service.search('ретинол');
    const blog = res.groups.find((g) => g.key === 'blog');
    expect(blog?.items[0]?.subtitle).toBe('Сыворотка с ретинолом');
  });

  it('title-хит rank > composition-only; composition всё же в выдаче', async () => {
    const compositionOnly = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      name: `Ааа крем ${i}`,
      slug: `comp-${i}`,
      categoryId: 'cat',
      images: [],
      variants: [{ id: `v-c${i}`, price: 100 }],
    }));
    productFindMany
      .mockResolvedValueOnce([
        {
          id: 'title',
          name: 'Ретинол сыворотка',
          slug: 'retinol',
          categoryId: 'cat',
          images: [],
          variants: [{ id: 'v-t', price: 2000 }],
        },
      ])
      .mockResolvedValueOnce(compositionOnly);

    const res = await service.search('ретинол');
    const products = res.groups.find((g) => g.key === 'product');
    expect(products?.items[0]?.id).toBe('title');
    expect(
      scoreTitleMatch(products!.items[0]!.title, 'ретинол'),
    ).toBeGreaterThan(
      scoreTitleMatch(products!.items.find((i) => i.id === 'c0')!.title, 'ретинол'),
    );
    expect(products?.items.some((i) => i.id === 'c0')).toBe(true);
  });

  it('buyer group price → subtitle', async () => {
    productFindMany
      .mockResolvedValueOnce([
        {
          id: '1',
          name: 'Крем',
          slug: 'k',
          categoryId: 'cat',
          images: [],
          variants: [{ id: 'v1', price: 1000 }],
        },
      ])
      .mockResolvedValueOnce([]);
    resolveVariantPrices.mockResolvedValue(
      new Map([['v1', { basePrice: 1000, groupPrice: 800 }]]),
    );
    const res = await service.search('крем', { userId: 'user-1' });
    expect(resolveFromUserId).toHaveBeenCalledWith('user-1');
    expect(res.groups[0]?.items[0]?.subtitle).toBe('800 р.');
  });

  it('ранжирует товары: prefix выше contains', async () => {
    productFindMany
      .mockResolvedValueOnce([
        {
          id: '2',
          name: 'Ночной крем',
          slug: 'night',
          categoryId: 'cat',
          images: [],
          variants: [{ id: 'v2', price: 1000 }],
        },
        {
          id: '1',
          name: 'Крем дневной',
          slug: 'day',
          categoryId: 'cat',
          images: [],
          variants: [{ id: 'v1', price: 900 }],
        },
      ])
      .mockResolvedValueOnce([]);
    const res = await service.search('крем');
    const products = res.groups.find((g) => g.key === 'product');
    expect(products?.items.map((i) => i.id)).toEqual(['1', '2']);
    expect(products?.items[0]?.subtitle).toBe('900 р.');
  });

  it('subtitle «от …» при разбросе цен', async () => {
    productFindMany
      .mockResolvedValueOnce([
        {
          id: '1',
          name: 'Крем',
          slug: 'k',
          categoryId: 'cat',
          images: [],
          variants: [
            { id: 'va', price: 500, name: '50 мл', isSample: false },
            { id: 'vb', price: 900, name: '100 мл', isSample: false },
          ],
        },
      ])
      .mockResolvedValueOnce([]);
    const res = await service.search('крем');
    expect(res.groups[0]?.items[0]?.subtitle).toBe('от 500 р.');
  });

  it('subtitle min-price без пробника (isSample / имя)', async () => {
    productFindMany
      .mockResolvedValueOnce([
        {
          id: '1',
          name: 'Сыворотка',
          slug: 'serum',
          categoryId: 'cat',
          images: [],
          variants: [
            { id: 'vs', price: 150, name: 'Крем 5 мл', isSample: true },
            { id: 'vf', price: 3200, name: '50 мл', isSample: false },
          ],
        },
      ])
      .mockResolvedValueOnce([]);
    const res = await service.search('сыворотка');
    expect(res.groups[0]?.items[0]?.subtitle).toBe('3 200 р.');
  });
});
