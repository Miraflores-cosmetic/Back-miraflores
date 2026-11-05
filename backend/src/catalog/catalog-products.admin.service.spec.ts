import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CatalogCategoriesAdminService } from './catalog-categories.admin.service';
import { CatalogProductsAdminService } from './catalog-products.admin.service';

function makePrisma() {
  return {
    category: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    product: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    productVariant: {
      count: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    productImage: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
      findUnique: vi.fn(),
    },
    productVariantImage: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    productCatalogTag: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    catalogTag: {
      count: vi.fn(),
    },
    collection: {
      count: vi.fn(),
    },
    collectionItem: {
      createMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    productSet: {
      count: vi.fn(),
    },
    productSetItem: {
      createMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    productVariantShade: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    orderItem: { count: vi.fn() },
    $transaction: vi.fn(),
  };
}

describe('CatalogProductsAdminService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: CatalogProductsAdminService;
  const storage = {
    saveImage: vi.fn(),
    deleteByPublicUrl: vi.fn(),
  };

  beforeEach(() => {
    prisma = makePrisma();
    const categories = new CatalogCategoriesAdminService(prisma as never);
    svc = new CatalogProductsAdminService(prisma as never, storage as never, categories);
  });

  it('createProduct требует категорию; variants опциональны', async () => {
    prisma.category.findUnique.mockResolvedValue(null);
    await expect(
      svc.createProduct({
        name: 'Крем',
        categoryId: 'missing',
        variants: [{ name: '50 мл', volumeMl: 50, price: 100 }],
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('addVariant пишет volumeMl и SKU с мл', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 'p1',
      slug: 'krem',
    });
    prisma.productVariant.findFirst.mockResolvedValue(null);
    prisma.productVariant.findUnique.mockResolvedValue(null);

    const created = {
      id: 'v1',
      productId: 'p1',
      name: '50 мл',
      slug: '50-ml',
      nationalCatalogName: null,
      volumeMl: 50,
      sku: 'krem-50ml',
      price: 990,
      compareAt: null,
      orderMinQty: 1,
      orderMaxQty: null,
      weightGrams: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      packageVolume: null,
      stock: 0,
      stockReserve: 0,
      active: true,
      galleryLinks: [],
      shades: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        productVariant: {
          findFirst: prisma.productVariant.findFirst,
          findUnique: prisma.productVariant.findUnique,
          create: vi.fn().mockResolvedValue(created),
        },
        productImage: { findMany: vi.fn() },
        productVariantImage: {
          deleteMany: vi.fn(),
          createMany: vi.fn(),
        },
      };
      return fn(tx);
    });

    const row = await svc.addVariant('p1', {
      name: '50 мл',
      volumeMl: 50,
      price: 990,
    });

    expect(row.volumeMl).toBe(50);
    expect(row.sku).toBe('krem-50ml');
  });

  it('deleteProduct блокирует при OrderItem', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 'p1',
      variants: [{ id: 'v1' }],
      images: [],
    });
    prisma.orderItem.count.mockResolvedValue(1);

    await expect(svc.deleteProduct('p1')).rejects.toThrow(ConflictException);
    expect(prisma.product.delete).not.toHaveBeenCalled();
  });

  it('deleteVariant удаляет вариант без заказов', async () => {
    prisma.productVariant.findUnique.mockResolvedValue({
      id: 'v1',
      productId: 'p1',
    });
    prisma.orderItem.count.mockResolvedValue(0);
    prisma.productVariant.delete.mockResolvedValue({});

    await expect(svc.deleteVariant('v1')).resolves.toEqual({ ok: true });
    expect(prisma.productVariant.delete).toHaveBeenCalledWith({ where: { id: 'v1' } });
  });

  it('updateProduct sync коллекций сохраняет sortOrder существующих связей', async () => {
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'p1', slug: 'p', categoryId: 'c1' })
      .mockResolvedValueOnce({
        id: 'p1',
        slug: 'p',
        name: 'P',
        categoryId: 'c1',
        shortDescription: null,
        pageShortDescriptionHtml: null,
        descriptionHtml: null,
        actionEffectHtml: null,
        applicationHtml: null,
        compositionHtml: null,
        importantNoteHtml: null,
        mirafloresNoteHtml: null,
        storageHtml: null,
        productType: null,
        purpose: null,
        shelfLife: null,
        extraHtml: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        category: null,
        variants: [],
        images: [],
        catalogTags: [],
        collectionItems: [{ collectionId: 'col-keep' }],
        productSetItems: [],
      });

    prisma.collection.count.mockResolvedValue(2);
    prisma.collectionItem.findMany.mockResolvedValue([
      { id: 'ci1', collectionId: 'col-keep', productId: 'p1', sortOrder: 3 },
      { id: 'ci2', collectionId: 'col-old', productId: 'p1', sortOrder: 1 },
    ]);
    prisma.collectionItem.aggregate.mockResolvedValue({ _max: { sortOrder: 7 } });

    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));

    await svc.updateProduct('p1', {
      collectionIds: ['col-keep', 'col-new'],
    });

    expect(prisma.collectionItem.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['ci2'] } },
    });
    expect(prisma.collectionItem.create).toHaveBeenCalledWith({
      data: { collectionId: 'col-new', productId: 'p1', sortOrder: 8 },
    });
    // существующая col-keep не пересоздаётся
    expect(prisma.collectionItem.create).toHaveBeenCalledTimes(1);
  });

  it('updateProduct sync наборов сохраняет sortOrder', async () => {
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'p1', slug: 'p', categoryId: 'c1' })
      .mockResolvedValueOnce({
        id: 'p1',
        slug: 'p',
        name: 'P',
        categoryId: 'c1',
        shortDescription: null,
        pageShortDescriptionHtml: null,
        descriptionHtml: null,
        actionEffectHtml: null,
        applicationHtml: null,
        compositionHtml: null,
        importantNoteHtml: null,
        mirafloresNoteHtml: null,
        storageHtml: null,
        productType: null,
        purpose: null,
        shelfLife: null,
        extraHtml: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        category: null,
        variants: [],
        images: [],
        catalogTags: [],
        collectionItems: [],
        productSetItems: [{ productSetId: 'set-keep' }],
      });

    prisma.productSet.count.mockResolvedValue(1);
    prisma.productSetItem.findMany.mockResolvedValue([
      { id: 'si1', productSetId: 'set-keep', productId: 'p1', sortOrder: 2 },
    ]);

    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));

    await svc.updateProduct('p1', {
      productSetIds: ['set-keep'],
    });

    expect(prisma.productSetItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.productSetItem.create).not.toHaveBeenCalled();
  });

  it('updateVariant shades: обновляет, создаёт и удаляет лишние', async () => {
    prisma.productVariant.findUnique.mockResolvedValue({
      id: 'v1',
      productId: 'p1',
      name: '50 мл',
      slug: '50-ml',
      sku: 'sku-1',
      volumeMl: 50,
      orderMinQty: 1,
      orderMaxQty: null,
      nationalCatalogName: null,
      price: 100,
      compareAt: null,
      weightGrams: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      packageVolume: null,
      stock: 0,
      stockReserve: 0,
      active: true,
      product: { id: 'p1', slug: 'krem' },
    });

    prisma.productVariantShade.findMany.mockResolvedValue([
      { id: 's1', name: 'Старое', imageUrl: null, sortOrder: 0 },
      { id: 's-del', name: 'Удалить', imageUrl: '/x.png', sortOrder: 1 },
    ]);

    const finalVariant = {
      id: 'v1',
      productId: 'p1',
      name: '50 мл',
      slug: '50-ml',
      nationalCatalogName: null,
      volumeMl: 50,
      sku: 'sku-1',
      price: 100,
      compareAt: null,
      orderMinQty: 1,
      orderMaxQty: null,
      weightGrams: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      packageVolume: null,
      stock: 0,
      stockReserve: 0,
      active: true,
      galleryLinks: [],
      shades: [
        { id: 's1', name: 'Роза', imageUrl: null, sortOrder: 0 },
        { id: 's-new', name: 'Мята', imageUrl: '/m.png', sortOrder: 1 },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    prisma.productVariant.findUniqueOrThrow.mockResolvedValue(finalVariant);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));

    await svc.updateVariant('v1', {
      shades: [
        { id: 's1', name: 'Роза', imageUrl: null, sortOrder: 0 },
        { name: 'Мята', imageUrl: '/m.png', sortOrder: 1 },
      ],
    });

    expect(prisma.productVariantShade.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['s-del'] } },
    });
    expect(storage.deleteByPublicUrl).toHaveBeenCalledWith('/x.png');
    expect(prisma.productVariantShade.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { name: 'Роза', imageUrl: null, sortOrder: 0 },
    });
    expect(prisma.productVariantShade.create).toHaveBeenCalledWith({
      data: {
        variantId: 'v1',
        name: 'Мята',
        imageUrl: '/m.png',
        sortOrder: 1,
      },
    });
  });

  it('updateVariant не переписывает slug/SKU при смене имени', async () => {
    prisma.productVariant.findUnique.mockResolvedValue({
      id: 'v1',
      productId: 'p1',
      name: '50 мл',
      slug: '50-ml',
      sku: 'keep-sku',
      volumeMl: 50,
      orderMinQty: 1,
      orderMaxQty: null,
      nationalCatalogName: null,
      price: 100,
      compareAt: null,
      weightGrams: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      packageVolume: null,
      stock: 0,
      stockReserve: 0,
      active: true,
      product: { id: 'p1', slug: 'krem' },
    });

    prisma.productVariant.findUniqueOrThrow.mockResolvedValue({
      id: 'v1',
      productId: 'p1',
      name: 'Новое',
      slug: '50-ml',
      nationalCatalogName: null,
      volumeMl: 50,
      sku: 'keep-sku',
      price: 100,
      compareAt: null,
      orderMinQty: 1,
      orderMaxQty: null,
      weightGrams: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      packageVolume: null,
      stock: 0,
      stockReserve: 0,
      active: true,
      galleryLinks: [],
      shades: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));

    await svc.updateVariant('v1', { name: 'Новое' });

    expect(prisma.productVariant.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { name: 'Новое' },
    });
  });

  it('updateVariant: PATCH только name не меняет isSample', async () => {
    prisma.productVariant.findUnique.mockResolvedValue({
      id: 'v1',
      productId: 'p1',
      name: 'Пробник 5 мл',
      slug: 'sample-5',
      sku: 'sku-1',
      volumeMl: 5,
      orderMinQty: 1,
      orderMaxQty: 1,
      nationalCatalogName: null,
      price: 100,
      compareAt: null,
      weightGrams: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      packageVolume: null,
      stock: 0,
      stockReserve: 0,
      active: true,
      isSample: true,
      product: { id: 'p1', slug: 'krem' },
    });

    prisma.productVariant.findUniqueOrThrow.mockResolvedValue({
      id: 'v1',
      productId: 'p1',
      name: 'Крем 5 мл',
      slug: 'sample-5',
      nationalCatalogName: null,
      volumeMl: 5,
      sku: 'sku-1',
      price: 100,
      compareAt: null,
      orderMinQty: 1,
      orderMaxQty: 1,
      weightGrams: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      packageVolume: null,
      stock: 0,
      stockReserve: 0,
      active: true,
      isSample: true,
      galleryLinks: [],
      shades: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));

    await svc.updateVariant('v1', { name: 'Крем 5 мл' });

    const updateArg = prisma.productVariant.update.mock.calls.at(-1)?.[0];
    expect(updateArg?.data).toEqual({ name: 'Крем 5 мл', orderMaxQty: 1 });
    expect(updateArg?.data).not.toHaveProperty('isSample');
  });
});
