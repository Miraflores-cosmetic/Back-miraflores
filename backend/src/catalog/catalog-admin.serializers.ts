import { Prisma } from '@prisma/client';
import { catalogSellablePrices } from './catalog-price.util';

export const variantInclude = {
  galleryLinks: {
    orderBy: { sortOrder: 'asc' as const },
    include: { productImage: { select: { id: true, url: true, mediaType: true } } },
  },
  shades: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.ProductVariantInclude;

export const productInclude = {
  category: {
    select: {
      id: true,
      name: true,
      slug: true,
      parentId: true,
      parent: { select: { id: true, name: true, slug: true } },
    },
  },
  variants: {
    orderBy: { createdAt: 'asc' as const },
    include: variantInclude,
  },
  images: { orderBy: { sortOrder: 'asc' as const } },
  catalogTags: { select: { tagId: true } },
  collectionItems: { select: { collectionId: true } },
  productSetItems: { select: { productSetId: true } },
} satisfies Prisma.ProductInclude;

/** Лёгкий include для admin list — без HTML, галерей вариантов и shades. */
export const productListInclude = {
  category: {
    select: {
      id: true,
      name: true,
      slug: true,
      parentId: true,
      parent: { select: { id: true, name: true, slug: true } },
    },
  },
  variants: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      sku: true,
      price: true,
      stock: true,
      stockReserve: true,
      active: true,
    },
  },
  images: {
    orderBy: { sortOrder: 'asc' as const },
    take: 1,
    select: { url: true, mediaType: true },
  },
} satisfies Prisma.ProductInclude;

export const collectionInclude = {
  items: {
    orderBy: { sortOrder: 'asc' as const },
    include: { product: { select: { id: true, name: true, slug: true } } },
  },
} satisfies Prisma.CollectionInclude;

export const productSetInclude = {
  items: {
    orderBy: { sortOrder: 'asc' as const },
    include: { product: { select: { id: true, name: true, slug: true } } },
  },
} satisfies Prisma.ProductSetInclude;

export function serializeVariant(
  v: Prisma.ProductVariantGetPayload<{ include: typeof variantInclude }>,
) {
  const gallery = v.galleryLinks.map((link) => ({
    id: link.productImage.id,
    url: link.productImage.url,
    mediaType: link.productImage.mediaType === 'video' ? 'video' : 'image',
    sortOrder: link.sortOrder,
  }));
  return {
    id: v.id,
    productId: v.productId,
    name: v.name,
    slug: v.slug,
    nationalCatalogName: v.nationalCatalogName,
    volumeMl: v.volumeMl,
    sku: v.sku,
    onecId: v.onecId,
    price: v.price,
    compareAt: v.compareAt,
    orderMinQty: v.orderMinQty,
    orderMaxQty: v.orderMaxQty,
    weightGrams: v.weightGrams,
    lengthMm: v.lengthMm,
    widthMm: v.widthMm,
    heightMm: v.heightMm,
    packageVolume: v.packageVolume,
    stock: v.stock,
    stockReserve: v.stockReserve,
    active: v.active,
    productImageIds: gallery.map((g) => g.id),
    gallery,
    shades: (v.shades ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      imageUrl: s.imageUrl,
      sortOrder: s.sortOrder,
    })),
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

export function serializeProduct(
  p: Prisma.ProductGetPayload<{ include: typeof productInclude }>,
) {
  const variants = p.variants.map((v) => serializeVariant(v));
  const active = variants.filter((v) => v.active);
  const priceSource = active.length ? active : variants;
  const pricesForMin = catalogSellablePrices(priceSource);
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    shortDescription: p.shortDescription,
    pageShortDescriptionHtml: p.pageShortDescriptionHtml,
    descriptionHtml: p.descriptionHtml,
    actionEffectHtml: p.actionEffectHtml,
    applicationHtml: p.applicationHtml,
    compositionHtml: p.compositionHtml,
    importantNoteHtml: p.importantNoteHtml,
    mirafloresNoteHtml: p.mirafloresNoteHtml,
    storageHtml: p.storageHtml,
    productType: p.productType,
    purpose: p.purpose,
    shelfLife: p.shelfLife,
    productTypeOptionId: p.productTypeOptionId ?? null,
    purposeOptionId: p.purposeOptionId ?? null,
    shelfLifeOptionId: p.shelfLifeOptionId ?? null,
    storageOptionId: p.storageOptionId ?? null,
    extraHtml: p.extraHtml,
    active: p.active,
    excludeFromCatalog: p.excludeFromCatalog,
    metaTitle: p.metaTitle,
    metaDescription: p.metaDescription,
    ogImageUrl: p.ogImageUrl,
    canonicalPath: p.canonicalPath,
    seoNoIndex: p.seoNoIndex,
    categoryId: p.categoryId,
    category: p.category
      ? {
          id: p.category.id,
          name: p.category.name,
          slug: p.category.slug,
          parentId: p.category.parentId,
          parent: p.category.parent,
        }
      : null,
    coverImageUrl: p.images[0]?.url ?? null,
    catalogTagIds: p.catalogTags.map((t) => t.tagId),
    collectionIds: p.collectionItems.map((c) => c.collectionId),
    productSetIds: p.productSetItems.map((s) => s.productSetId),
    variants,
    variantCount: variants.length,
    minPrice: pricesForMin.length ? Math.min(...pricesForMin) : null,
    images: p.images.map((img) => ({
      id: img.id,
      url: img.url,
      mediaType: img.mediaType === 'video' ? 'video' : 'image',
      sortOrder: img.sortOrder,
    })),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function serializeProductListItem(
  p: Prisma.ProductGetPayload<{ include: typeof productListInclude }>,
) {
  const variants = p.variants;
  const active = variants.filter((v) => v.active);
  const priceSource = active.length ? active : variants;
  const stockSource = active.length ? active : variants;
  const cover = p.images[0];
  const primarySku =
    active.find((v) => v.sku)?.sku ?? variants.find((v) => v.sku)?.sku ?? null;

  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    active: p.active,
    excludeFromCatalog: p.excludeFromCatalog,
    categoryId: p.categoryId,
    category: p.category
      ? {
          id: p.category.id,
          name: p.category.name,
          slug: p.category.slug,
          parentId: p.category.parentId,
          parent: p.category.parent,
        }
      : null,
    coverImageUrl: cover?.url ?? null,
    coverMediaType: cover?.mediaType === 'video' ? ('video' as const) : ('image' as const),
    variantCount: variants.length,
    minPrice: (() => {
      const prices = catalogSellablePrices(priceSource);
      return prices.length ? Math.min(...prices) : null;
    })(),
    primarySku,
    stockTotal: stockSource.reduce(
      (sum, v) => sum + Math.max(0, (v.stock ?? 0) - (v.stockReserve ?? 0)),
      0,
    ),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function serializeCollection(
  row: Prisma.CollectionGetPayload<{ include: typeof collectionInclude }>,
) {
  const products = row.items.map((it) => ({
    id: it.product.id,
    name: it.product.name,
    slug: it.product.slug,
    sortOrder: it.sortOrder,
  }));
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    shortDescription: row.shortDescription,
    coverImageUrl: row.coverImageUrl,
    productPreviewUrl: row.productPreviewUrl,
    active: row.active,
    featuredLayout: row.featuredLayout,
    sortOrder: row.sortOrder,
    productIds: products.map((p) => p.id),
    products,
    itemCount: products.length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeProductSet(
  row: Prisma.ProductSetGetPayload<{ include: typeof productSetInclude }>,
) {
  const products = row.items.map((it) => ({
    id: it.product.id,
    name: it.product.name,
    slug: it.product.slug,
    sortOrder: it.sortOrder,
  }));
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    shortDescription: row.shortDescription,
    coverImageUrl: row.coverImageUrl,
    active: row.active,
    sortOrder: row.sortOrder,
    productIds: products.map((p) => p.id),
    products,
    itemCount: products.length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
