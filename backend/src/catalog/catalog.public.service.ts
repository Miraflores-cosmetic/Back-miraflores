import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DiscountsPublicService } from '../discounts/discounts-public.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  PUBLIC_HIDDEN_CATEGORY_SLUGS,
  PUBLIC_PRODUCTS_DEFAULT_LIMIT,
  PUBLIC_PRODUCTS_IN_MEMORY_MAX,
  PUBLIC_PRODUCTS_MAX_LIMIT,
} from './catalog.constants';
import {
  catalogSellablePrices,
  pickCatalogCardVariant,
} from './catalog-price.util';
import {
  applyCampaignToCards,
  applyCampaignToDetailVariants,
} from './catalog-campaign-price.util';
import {
  giftPurchaseSkuForDenom,
  parseGiftDenomCartVariantId,
} from '../gift-certificates/gift-certificate-purchase.util';

type ProductCardSource = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  categoryId: string;
  images: Array<{ url: string; mediaType?: string }>;
  variants: Array<{
    id: string;
    name: string;
    price: number;
    compareAt: number | null;
    orderMinQty: number;
    orderMaxQty: number | null;
    stock: number;
    stockReserve: number;
    shades: Array<{ id: string; name: string; imageUrl: string | null }>;
  }>;
};

const productCardSelect = {
  id: true,
  slug: true,
  name: true,
  shortDescription: true,
  categoryId: true,
  images: {
    take: 8,
    orderBy: { sortOrder: 'asc' as const },
    select: { url: true, mediaType: true },
  },
  variants: {
    where: { active: true },
    orderBy: [{ price: 'asc' as const }, { createdAt: 'asc' as const }],
    select: {
      id: true,
      name: true,
      price: true,
      compareAt: true,
      orderMinQty: true,
      orderMaxQty: true,
      stock: true,
      stockReserve: true,
      shades: {
        orderBy: { sortOrder: 'asc' as const },
        take: 1,
        select: { id: true, name: true, imageUrl: true },
      },
    },
  },
};

type ProductCard = ReturnType<typeof toProductCard>;

function toProductCard(p: ProductCardSource) {
  const variants = p.variants ?? [];
  const prices = catalogSellablePrices(variants);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const v = pickCatalogCardVariant(variants);
  const price = v?.price ?? minPrice;
  const compareAt = v?.compareAt ?? null;
  const discountPercent =
    compareAt != null && compareAt > price
      ? Math.round(((compareAt - price) / compareAt) * 100)
      : null;
  const available = v ? Math.max(0, v.stock - v.stockReserve) : 0;
  const minQty = Math.max(1, v?.orderMinQty ?? 1);
  let maxQty =
    v == null
      ? 0
      : v.orderMaxQty != null
        ? Math.min(v.orderMaxQty, available)
        : available;
  // Нельзя купить, если min > доступного максимума
  if (maxQty > 0 && minQty > maxQty) maxQty = 0;
  const shade = v?.shades?.[0] ?? null;
  const imageUrls = p.images.map((img) => img.url).filter(Boolean);
  const cover = p.images[0];
  return {
    id: p.id,
    categoryId: p.categoryId,
    variantId: v?.id ?? null,
    variantName: v?.name ?? null,
    shadeId: shade?.id ?? null,
    shadeName: shade?.name ?? null,
    slug: p.slug,
    name: p.name,
    shortDescription: p.shortDescription,
    price,
    oldPrice: compareAt != null && compareAt > price ? compareAt : null,
    discountPercent,
    priceFrom: maxPrice > minPrice,
    available,
    minQty,
    maxQty,
    imageUrl: cover?.url || shade?.imageUrl || null,
    imageUrls,
    mediaType: cover?.mediaType === 'video' ? ('video' as const) : ('image' as const),
  };
}

function stripCategoryId<T extends { categoryId: string }>(card: T) {
  const { categoryId: _cid, ...rest } = card;
  return rest;
}

@Injectable()
export class CatalogPublicService {
  private readonly logger = new Logger(CatalogPublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discountsPublic: DiscountsPublicService,
  ) {}

  async getProductBySlug(slug: string) {
    const row = await this.prisma.product.findFirst({
      where: { slug, active: true, excludeFromCatalog: false },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
            parent: {
              select: {
                id: true,
                name: true,
                slug: true,
                parent: { select: { id: true, name: true, slug: true } },
              },
            },
          },
        },
        images: { orderBy: { sortOrder: 'asc' } },
        catalogTags: {
          select: {
            tag: { select: { id: true, name: true, slug: true, sortOrder: true } },
          },
        },
        variants: {
          where: { active: true },
          orderBy: { createdAt: 'asc' },
          include: {
            galleryLinks: {
              orderBy: { sortOrder: 'asc' },
              include: { productImage: { select: { id: true, url: true, mediaType: true } } },
            },
          },
        },
      },
    });
    if (!row) return null;

    const productImages = row.images.map((img) => ({
      id: img.id,
      url: img.url,
      mediaType: (img.mediaType === 'video' ? 'video' : 'image') as 'image' | 'video',
      sortOrder: img.sortOrder,
    }));

    const rawVariants = row.variants.map((v) => {
      const variantImages = v.galleryLinks.map((link) => ({
        id: link.productImage.id,
        url: link.productImage.url,
        mediaType: (link.productImage.mediaType === 'video' ? 'video' : 'image') as
          | 'image'
          | 'video',
        sortOrder: link.sortOrder,
      }));
      const available = Math.max(0, v.stock - v.stockReserve);
      return {
        id: v.id,
        name: v.name,
        slug: v.slug,
        volumeMl: v.volumeMl,
        sku: v.sku,
        price: v.price,
        compareAt: v.compareAt,
        orderMinQty: v.orderMinQty,
        orderMaxQty: v.orderMaxQty,
        stock: v.stock,
        stockReserve: v.stockReserve,
        available,
        images: variantImages.length > 0 ? variantImages : productImages,
      };
    });

    const campaigns = await this.discountsPublic.loadRunningCampaigns();
    const variants = applyCampaignToDetailVariants(
      rawVariants,
      row.id,
      row.categoryId,
      campaigns,
    );

    const prices = catalogSellablePrices(variants);

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      shortDescription: row.shortDescription,
      pageShortDescriptionHtml: row.pageShortDescriptionHtml,
      descriptionHtml: row.descriptionHtml,
      actionEffectHtml: row.actionEffectHtml,
      applicationHtml: row.applicationHtml,
      compositionHtml: row.compositionHtml,
      importantNoteHtml: row.importantNoteHtml,
      mirafloresNoteHtml: row.mirafloresNoteHtml,
      storageHtml: row.storageHtml,
      productType: row.productType,
      purpose: row.purpose,
      shelfLife: row.shelfLife,
      extraHtml: row.extraHtml,
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
      ogImageUrl: row.ogImageUrl,
      canonicalPath: row.canonicalPath,
      seoNoIndex: row.seoNoIndex,
      category: row.category,
      catalogTags: row.catalogTags.map((ct) => ({
        id: ct.tag.id,
        name: ct.tag.name,
        slug: ct.tag.slug,
        sortOrder: ct.tag.sortOrder,
      })),
      images: productImages,
      variants,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
    };
  }

  async getSetSiblings(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, active: true, excludeFromCatalog: false },
      select: { id: true },
    });
    if (!product) return { items: [] as const };

    const memberships = await this.prisma.productSetItem.findMany({
      where: { productId: product.id, productSet: { active: true } },
      select: { productSetId: true },
    });
    const setIds = [...new Set(memberships.map((m) => m.productSetId))];
    if (!setIds.length) return { items: [] as const };

    const rows = await this.prisma.productSetItem.findMany({
      where: {
        productSetId: { in: setIds },
        productId: { not: product.id },
        product: { active: true, excludeFromCatalog: false },
      },
      orderBy: { sortOrder: 'asc' },
      include: {
        product: { select: productCardSelect },
      },
    });

    const seen = new Set<string>();
    const raw: ProductCard[] = [];
    for (const row of rows) {
      const p = row.product;
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      raw.push(toProductCard(p));
    }
    const campaigns = await this.discountsPublic.loadRunningCampaigns();
    return {
      items: applyCampaignToCards(raw, campaigns).map(stripCategoryId),
    };
  }

  async listProducts(opts?: {
    page?: number;
    limit?: number;
    categorySlug?: string;
    tagSlug?: string;
    collectionSlug?: string;
    sort?: string;
    priceMin?: number;
    priceMax?: number;
    saleOnly?: boolean;
    /** Batch by slug (order preserved). Ignores other filters when set. */
    slugs?: string[];
  }) {
    const page = Math.max(1, opts?.page ?? 1);
    const limit = Math.min(
      PUBLIC_PRODUCTS_MAX_LIMIT,
      Math.max(1, opts?.limit ?? PUBLIC_PRODUCTS_DEFAULT_LIMIT),
    );

    if (opts?.slugs?.length) {
      const seen = new Set<string>();
      const slugs: string[] = [];
      for (const raw of opts.slugs) {
        const s = raw.trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        slugs.push(s);
        if (slugs.length >= PUBLIC_PRODUCTS_MAX_LIMIT) break;
      }
      const campaigns = await this.discountsPublic.loadRunningCampaigns();
      const rows = await this.prisma.product.findMany({
        where: {
          active: true,
          excludeFromCatalog: false,
          slug: { in: slugs },
        },
        select: productCardSelect,
      });
      const bySlug = new Map(rows.map((r) => [r.slug, r]));
      const ordered = slugs.flatMap((s) => {
        const p = bySlug.get(s);
        return p ? [p] : [];
      });
      const items = applyCampaignToCards(ordered.map(toProductCard), campaigns).map(
        stripCategoryId,
      );
      return { items, total: items.length, page: 1, limit: slugs.length };
    }

    const where: Prisma.ProductWhereInput = {
      active: true,
      excludeFromCatalog: false,
    };

    if (opts?.categorySlug) {
      const cat = await this.prisma.category.findUnique({
        where: { slug: opts.categorySlug },
        select: { id: true },
      });
      if (!cat) {
        return { items: [], total: 0, page, limit };
      }
      const childIds = (
        await this.prisma.category.findMany({
          where: { parentId: cat.id },
          select: { id: true },
        })
      ).map((c) => c.id);
      const ids = [cat.id, ...childIds];
      const grandIds =
        childIds.length > 0
          ? (
              await this.prisma.category.findMany({
                where: { parentId: { in: childIds } },
                select: { id: true },
              })
            ).map((c) => c.id)
          : [];
      where.categoryId = { in: [...new Set([...ids, ...grandIds])] };
    }

    if (opts?.tagSlug) {
      where.catalogTags = { some: { tag: { slug: opts.tagSlug } } };
    }

    let collectionId: string | null = null;
    if (opts?.collectionSlug) {
      const col = await this.prisma.collection.findFirst({
        where: { slug: opts.collectionSlug, active: true },
        select: { id: true },
      });
      if (!col) {
        return { items: [], total: 0, page, limit };
      }
      collectionId = col.id;
      where.collectionItems = { some: { collectionId: col.id } };
    }

    // Цена фильтруется по цене карточки (min + кампания) в памяти — не по «любому» variant
    const sort = opts?.sort ?? 'newest';
    /** Порядок из админки (CollectionItem.sortOrder), пока не выбран явный sort. */
    const useCollectionSort =
      collectionId != null &&
      sort !== 'name' &&
      sort !== 'price_asc' &&
      sort !== 'price_desc' &&
      sort !== 'popular';

    let orderBy: Prisma.ProductOrderByWithRelationInput = { createdAt: 'desc' };
    if (sort === 'name') orderBy = { name: 'asc' };

    const needsInMemory =
      opts?.saleOnly === true ||
      opts?.priceMin != null ||
      opts?.priceMax != null ||
      sort === 'price_asc' ||
      sort === 'price_desc' ||
      sort === 'popular';

    const campaigns = await this.discountsPublic.loadRunningCampaigns();

    if (useCollectionSort && !needsInMemory) {
      const productWhere: Prisma.ProductWhereInput = { ...where };
      delete productWhere.collectionItems;
      const itemWhere: Prisma.CollectionItemWhereInput = {
        collectionId: collectionId!,
        product: productWhere,
      };
      const [total, itemRows] = await this.prisma.$transaction([
        this.prisma.collectionItem.count({ where: itemWhere }),
        this.prisma.collectionItem.findMany({
          where: itemWhere,
          orderBy: { sortOrder: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { product: { select: productCardSelect } },
        }),
      ]);
      const rows = itemRows.map((it) => it.product).filter(Boolean);
      const items = applyCampaignToCards(rows.map(toProductCard), campaigns).map(
        stripCategoryId,
      );
      return { items, total, page, limit };
    }

    if (!needsInMemory) {
      const [total, rows] = await this.prisma.$transaction([
        this.prisma.product.count({ where }),
        this.prisma.product.findMany({
          where,
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
          select: productCardSelect,
        }),
      ]);
      const items = applyCampaignToCards(rows.map(toProductCard), campaigns).map(
        stripCategoryId,
      );
      return { items, total, page, limit };
    }

    // sale / price-sort: полный пул → кампании → фильтр → пагинация (точный total)
    if (opts?.saleOnly) {
      const campaignProductIds = [
        ...new Set(campaigns.flatMap((c) => c.productIds)),
      ];
      const campaignCategoryIds = [
        ...new Set(campaigns.flatMap((c) => c.categoryIds)),
      ];
      where.OR = [
        {
          variants: {
            some: {
              active: true,
              compareAt: { not: null, gt: 0 },
            },
          },
        },
        ...(campaignProductIds.length
          ? [{ id: { in: campaignProductIds } }]
          : []),
        ...(campaignCategoryIds.length
          ? [{ categoryId: { in: campaignCategoryIds } }]
          : []),
      ];
    }

    let allRows: ProductCardSource[];
    const poolTake = PUBLIC_PRODUCTS_IN_MEMORY_MAX + 1;

    if (useCollectionSort && collectionId) {
      const productWhere: Prisma.ProductWhereInput = { ...where };
      delete productWhere.collectionItems;
      const itemRows = await this.prisma.collectionItem.findMany({
        where: { collectionId, product: productWhere },
        orderBy: { sortOrder: 'asc' },
        take: poolTake,
        include: { product: { select: productCardSelect } },
      });
      allRows = itemRows.map((it) => it.product).filter(Boolean);
    } else {
      allRows = await this.prisma.product.findMany({
        where,
        orderBy: sort === 'name' ? { name: 'asc' } : { createdAt: 'desc' },
        take: poolTake,
        select: productCardSelect,
      });
    }

    const poolTruncated = allRows.length > PUBLIC_PRODUCTS_IN_MEMORY_MAX;
    if (poolTruncated) {
      allRows = allRows.slice(0, PUBLIC_PRODUCTS_IN_MEMORY_MAX);
      this.logger.warn(
        `TODO(scale) listProducts in-memory pool truncated at ${PUBLIC_PRODUCTS_IN_MEMORY_MAX} ` +
          `(sale=${Boolean(opts?.saleOnly)} priceMin=${opts?.priceMin ?? '-'} ` +
          `priceMax=${opts?.priceMax ?? '-'} sort=${sort}). ` +
          `Denorm cardPrice/onSale + SQL pagination.`,
      );
    }

    let cards = applyCampaignToCards(allRows.map(toProductCard), campaigns);

    if (opts?.saleOnly) {
      cards = cards.filter((p) => p.oldPrice != null && p.oldPrice > p.price);
    }
    if (opts?.priceMin != null) {
      cards = cards.filter((p) => p.price >= opts.priceMin!);
    }
    if (opts?.priceMax != null) {
      cards = cards.filter((p) => p.price <= opts.priceMax!);
    }
    if (sort === 'price_asc') cards.sort((a, b) => a.price - b.price);
    else if (sort === 'price_desc') cards.sort((a, b) => b.price - a.price);
    else if (sort === 'popular') {
      cards.sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0));
    }

    const total = cards.length;
    const pageItems = cards
      .slice((page - 1) * limit, page * limit)
      .map(stripCategoryId);
    return { items: pageItems, total, page, limit, truncated: poolTruncated };
  }

  /**
   * По умолчанию — метаданные (чипы каталога).
   * `includeProducts: true` — полные карточки (витрина Admin home).
   */
  async listCollections(opts?: { includeProducts?: boolean }) {
    const includeProducts = opts?.includeProducts === true;

    if (!includeProducts) {
      const rows = await this.prisma.collection.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          slug: true,
          name: true,
          shortDescription: true,
          coverImageUrl: true,
          featuredLayout: true,
          productPreviewUrl: true,
        },
      });
      return {
        items: rows.map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          shortDescription: c.shortDescription,
          coverImageUrl: c.coverImageUrl,
          featuredLayout: c.featuredLayout,
          productPreviewUrl: c.productPreviewUrl?.trim() || null,
          products: [] as Array<Omit<ProductCard, 'categoryId'>>,
        })),
      };
    }

    const rows = await this.prisma.collection.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        items: {
          where: { product: { active: true, excludeFromCatalog: false } },
          orderBy: { sortOrder: 'asc' },
          include: {
            product: { select: productCardSelect },
          },
        },
      },
    });
    const campaigns = await this.discountsPublic.loadRunningCampaigns();
    return {
      items: rows.map((c) => {
        const products = applyCampaignToCards(
          c.items
            .map((it) => it.product)
            .filter((p) => Boolean(p))
            .map(toProductCard),
          campaigns,
        ).map(stripCategoryId);
        const productPreviewUrl =
          c.productPreviewUrl?.trim() ||
          products.find((p) => p.imageUrl)?.imageUrl ||
          null;
        return {
          id: c.id,
          slug: c.slug,
          name: c.name,
          shortDescription: c.shortDescription,
          coverImageUrl: c.coverImageUrl,
          featuredLayout: c.featuredLayout,
          productPreviewUrl,
          products,
        };
      }),
    };
  }

  async listCategories() {
    const rows = await this.prisma.category.findMany({
      where: { slug: { notIn: [...PUBLIC_HIDDEN_CATEGORY_SLUGS] } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
        coverImageUrl: true,
        products: {
          where: { active: true, excludeFromCatalog: false },
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            images: {
              take: 1,
              orderBy: { sortOrder: 'asc' },
              select: { url: true },
            },
          },
        },
      },
    });

    const roots = rows.filter((r) => !r.parentId);
    const byParent = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!r.parentId) continue;
      const arr = byParent.get(r.parentId) ?? [];
      arr.push(r);
      byParent.set(r.parentId, arr);
    }

    /** Bubbles: admin cover → own product image → first descendant product image. */
    const preview = (r: (typeof rows)[number]): string | null => {
      const cover = r.coverImageUrl?.trim();
      if (cover) return cover;
      const own = r.products[0]?.images[0]?.url;
      if (own) return own;
      for (const child of byParent.get(r.id) ?? []) {
        const fromChild = preview(child);
        if (fromChild) return fromChild;
      }
      return null;
    };

    return {
      items: (roots.length ? roots : rows).map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        parentId: c.parentId,
        imageUrl: preview(c),
        children: (byParent.get(c.id) ?? []).map((ch) => ({
          id: ch.id,
          name: ch.name,
          slug: ch.slug,
          parentId: ch.parentId,
          imageUrl: preview(ch),
          children: (byParent.get(ch.id) ?? []).map((gr) => ({
            id: gr.id,
            name: gr.name,
            slug: gr.slug,
            parentId: gr.parentId,
            imageUrl: preview(gr),
          })),
        })),
      })),
    };
  }

  async listCatalogTags() {
    const rows = await this.prisma.catalogTag.findMany({
      where: {
        products: {
          some: {
            product: { active: true },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        coverImageUrl: true,
        sortOrder: true,
        steps: {
          orderBy: { sortOrder: 'asc' },
          take: 1,
          select: { title: true, description: true },
        },
      },
    });
    return {
      items: rows.map((r) => {
        const step = r.steps[0];
        return {
          id: r.id,
          name: r.name,
          slug: r.slug,
          coverImageUrl: r.coverImageUrl,
          sortOrder: r.sortOrder,
          /** Заголовок из «Информационные блоки» контекстного тега */
          title: step?.title ?? null,
          /** Описание из «Информационные блоки» */
          description: step?.description ?? null,
        };
      }),
    };
  }

  /**
   * Обновляет guest-корзину: живые цена/min/max + каталожные скидки,
   * дропает удалённые/неактивные варианты.
   */
  async syncCartLines(
    lines: Array<{ variantId: string; shadeId?: string | null; qty: number }>,
  ) {
    const merged = new Map<string, number>();
    for (const line of lines) {
      if (!line?.variantId || !Number.isFinite(line.qty) || line.qty <= 0) continue;
      const id = line.variantId.trim();
      merged.set(id, (merged.get(id) ?? 0) + Math.floor(line.qty));
    }
    const cleaned = [...merged.entries()]
      .map(([variantId, qty]) => ({ variantId, qty }))
      .slice(0, 100);
    if (!cleaned.length) {
      return {
        items: [] as const,
        removedKeys: [] as string[],
        removedLines: [] as Array<{
          key: string;
          reason: 'oos' | 'missing';
          name?: string;
        }>,
        listSubtotal: 0,
        subtotal: 0,
        campaignDiscountTotal: 0,
      };
    }

    type RawItem = {
      key: string;
      productId: string;
      categoryId: string;
      variantId: string;
      shadeId: string | null;
      shadeName: string | null;
      slug: string;
      name: string;
      variantName: string;
      sku: string;
      imageUrl: string | null;
      /** Selling price — вход в движок кампаний. */
      listPrice: number;
      /** Marketing compareAt, если выше selling. */
      compareAt: number | null;
      minQty: number;
      maxQty: number;
      qty: number;
      /** Номинал сертификата — без кампаний и без FK variant. */
      isGiftDenom?: boolean;
    };
    const rawItems: RawItem[] = [];
    const removedKeys: string[] = [];
    const removedLines: Array<{
      key: string;
      reason: 'oos' | 'missing';
      name?: string;
    }> = [];

    const giftLines: Array<{ variantId: string; denomId: string; qty: number }> =
      [];
    const catalogLines: Array<{ variantId: string; qty: number }> = [];
    for (const line of cleaned) {
      const denomId = parseGiftDenomCartVariantId(line.variantId);
      if (denomId) {
        giftLines.push({
          variantId: line.variantId,
          denomId,
          qty: line.qty,
        });
      } else {
        catalogLines.push(line);
      }
    }

    if (giftLines.length) {
      const denomIds = [...new Set(giftLines.map((l) => l.denomId))];
      const denoms = await this.prisma.giftCertificateDenomination.findMany({
        where: { id: { in: denomIds }, active: true },
        select: {
          id: true,
          name: true,
          faceValue: true,
          validityDays: true,
          images: {
            take: 1,
            orderBy: { sortOrder: 'asc' },
            select: { url: true },
          },
        },
      });
      const denomById = new Map(denoms.map((d) => [d.id, d]));
      for (const line of giftLines) {
        const denom = denomById.get(line.denomId);
        if (!denom) {
          removedKeys.push(line.variantId);
          removedLines.push({ key: line.variantId, reason: 'missing' });
          continue;
        }
        const minQty = 1;
        const maxQty = 10;
        const qty = Math.min(maxQty, Math.max(minQty, Math.floor(line.qty)));
        const validityLabel =
          denom.validityDays != null ? `${denom.validityDays} дн.` : 'без срока';
        rawItems.push({
          key: line.variantId,
          productId: denom.id,
          categoryId: '',
          variantId: line.variantId,
          shadeId: null,
          shadeName: null,
          slug: 'gift-certificates',
          name: `Подарочный сертификат «${denom.name}»`,
          variantName: validityLabel,
          sku: giftPurchaseSkuForDenom(denom.id),
          imageUrl: denom.images[0]?.url ?? null,
          listPrice: denom.faceValue,
          compareAt: null,
          minQty,
          maxQty,
          qty,
          isGiftDenom: true,
        });
      }
    }

    const ids = [...new Set(catalogLines.map((l) => l.variantId))];
    const variants = ids.length
      ? await this.prisma.productVariant.findMany({
          where: {
            id: { in: ids },
            active: true,
            product: { active: true, excludeFromCatalog: false },
          },
          select: {
            id: true,
            name: true,
            sku: true,
            price: true,
            compareAt: true,
            orderMinQty: true,
            orderMaxQty: true,
            stock: true,
            stockReserve: true,
            product: {
              select: {
                id: true,
                categoryId: true,
                slug: true,
                name: true,
                images: {
                  take: 1,
                  orderBy: { sortOrder: 'asc' },
                  select: { url: true },
                },
              },
            },
            galleryLinks: {
              take: 1,
              orderBy: { sortOrder: 'asc' },
              select: { productImage: { select: { url: true } } },
            },
          },
        })
      : [];
    const byId = new Map(variants.map((v) => [v.id, v]));

    for (const line of catalogLines) {
      const key = line.variantId;
      const v = byId.get(line.variantId);
      if (!v) {
        removedKeys.push(key);
        removedLines.push({ key, reason: 'missing' });
        continue;
      }

      const available = Math.max(0, v.stock - v.stockReserve);
      const minQty = Math.max(1, v.orderMinQty ?? 1);
      let maxQty =
        v.orderMaxQty != null ? Math.min(v.orderMaxQty, available) : available;
      if (maxQty > 0 && minQty > maxQty) maxQty = 0;
      if (maxQty <= 0) {
        removedKeys.push(key);
        removedLines.push({
          key,
          reason: 'oos',
          name: v.product.name,
        });
        continue;
      }

      const qty = Math.min(maxQty, Math.max(minQty, Math.floor(line.qty)));
      const imageUrl =
        v.galleryLinks[0]?.productImage?.url ||
        v.product.images[0]?.url ||
        null;

      // Движок кампаний считает от selling price; compareAt — только для display list.
      const sellingPrice = v.price;

      rawItems.push({
        key,
        productId: v.product.id,
        categoryId: v.product.categoryId,
        variantId: v.id,
        shadeId: null,
        shadeName: null,
        slug: v.product.slug,
        name: v.product.name,
        variantName: v.name,
        sku: v.sku,
        imageUrl,
        listPrice: sellingPrice,
        compareAt:
          v.compareAt != null && v.compareAt > sellingPrice ? v.compareAt : null,
        minQty,
        maxQty,
        qty,
      });
    }

    const catalogRaw = rawItems.filter((r) => !r.isGiftDenom);
    const giftRaw = rawItems.filter((r) => r.isGiftDenom);

    const priced = catalogRaw.length
      ? await this.discountsPublic.priceLines(
          catalogRaw.map((r) => ({
            key: r.key,
            productId: r.productId,
            categoryId: r.categoryId,
            qty: r.qty,
            listPrice: r.listPrice,
          })),
        )
      : {
          lines: [] as Array<{
            key: string;
            price: number;
            lineDiscount: number;
            discountId: string | null;
            discountName: string | null;
          }>,
          listSubtotal: 0,
          subtotal: 0,
          campaignDiscountTotal: 0,
        };
    const byKey = new Map(priced.lines.map((l) => [l.key, l]));

    const catalogItems = catalogRaw.map((r) => {
      const p = byKey.get(r.key);
      const salePrice = p?.price ?? r.listPrice;
      // Зачёркивание как на карточках: marketing compareAt ∪ pre-campaign price.
      const displayList = Math.max(r.compareAt ?? r.listPrice, r.listPrice);
      return {
        productId: r.productId,
        variantId: r.variantId,
        shadeId: r.shadeId,
        shadeName: r.shadeName,
        slug: r.slug,
        name: r.name,
        variantName: r.variantName,
        sku: r.sku,
        imageUrl: r.imageUrl,
        listPrice: displayList > salePrice ? displayList : salePrice,
        price: salePrice,
        lineDiscount: p?.lineDiscount ?? 0,
        discountId: p?.discountId ?? null,
        discountName: p?.discountName ?? null,
        minQty: r.minQty,
        maxQty: r.maxQty,
        qty: r.qty,
      };
    });

    const giftItems = giftRaw.map((r) => ({
      productId: r.productId,
      variantId: r.variantId,
      shadeId: r.shadeId,
      shadeName: r.shadeName,
      slug: r.slug,
      name: r.name,
      variantName: r.variantName,
      sku: r.sku,
      imageUrl: r.imageUrl,
      listPrice: r.listPrice,
      price: r.listPrice,
      lineDiscount: 0,
      discountId: null as string | null,
      discountName: null as string | null,
      minQty: r.minQty,
      maxQty: r.maxQty,
      qty: r.qty,
      isGiftDenom: true as const,
    }));

    const giftSubtotal = giftItems.reduce((s, i) => s + i.price * i.qty, 0);
    const items = [...catalogItems, ...giftItems];

    return {
      items,
      removedKeys,
      removedLines,
      listSubtotal: priced.listSubtotal + giftSubtotal,
      subtotal: priced.subtotal + giftSubtotal,
      campaignDiscountTotal: priced.campaignDiscountTotal,
    };
  }

  /**
   * HTML с title/canonical/OG для шаринг-ботов (Telegram/VK), без JS.
   * Nginx: User-Agent share-bot → этот URL.
   */
  async renderOpenGraphHtml(opts: {
    path: string;
    collection: string;
    tag: string;
    q: string;
  }): Promise<string> {
    const seo = await this.prisma.siteSettings.findUnique({
      where: { id: 'default' },
      select: {
        siteUrl: true,
        titleSuffix: true,
        defaultMetaDescription: true,
        defaultOgImageUrl: true,
      },
    });
    const origin = (seo?.siteUrl || '').replace(/\/+$/, '') || 'https://miraflores-shop.com';
    const suffix = seo?.titleSuffix?.trim() || 'Miraflores';

    const rawPath = opts.path.split('?')[0] || '/catalog';
    const parts = rawPath.split('/').filter(Boolean);
    const cat = parts[0] === 'catalog' ? (parts[1] ?? '') : '';
    const sub = parts[0] === 'catalog' ? (parts[2] ?? '') : '';

    let label = 'Каталог';
    let image = seo?.defaultOgImageUrl?.trim() || '';
    let noIndex = Boolean(opts.q);

    if (opts.q) {
      label = `Поиск: ${opts.q}`;
    } else if (opts.collection) {
      const col = await this.prisma.collection.findFirst({
        where: { slug: opts.collection, active: true },
        select: { name: true, coverImageUrl: true, productPreviewUrl: true },
      });
      if (col) {
        label = col.name;
        image = col.coverImageUrl || col.productPreviewUrl || image;
      }
    } else if (opts.tag) {
      const tag = await this.prisma.catalogTag.findFirst({
        where: { slug: opts.tag },
        select: { name: true, coverImageUrl: true },
      });
      if (tag) {
        label = tag.name;
        image = tag.coverImageUrl || image;
      }
    } else if (cat) {
      const rows = await this.prisma.category.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          parentId: true,
          coverImageUrl: true,
        },
      });
      const root = rows.find((r) => r.slug === cat && !r.parentId);
      if (root) {
        label = root.name;
        image = root.coverImageUrl || image;
        if (sub) {
          const children = rows.filter((r) => r.parentId === root.id);
          const l2 = children.find((r) => r.slug === sub);
          const l3 = children
            .flatMap((ch) => rows.filter((r) => r.parentId === ch.id && r.slug === sub))
            .at(0);
          const leaf = l2 ?? l3;
          if (leaf) {
            label = leaf.name;
            image = leaf.coverImageUrl || image;
          }
        }
      }
    }

    const title = `${label} — ${suffix}`;
    const desc =
      (opts.q
        ? `Результаты поиска «${opts.q}» в каталоге ${suffix}`
        : `Купить ${label.toLowerCase()} в ${suffix}`) ||
      seo?.defaultMetaDescription ||
      title;

    const seoQs = new URLSearchParams();
    if (opts.collection) seoQs.set('collection', opts.collection);
    if (opts.tag) seoQs.set('tag', opts.tag);
    let canonPath = '/catalog';
    if (cat) {
      canonPath += `/${encodeURIComponent(cat)}`;
      if (sub) canonPath += `/${encodeURIComponent(sub)}`;
    }
    const canonical = `${origin}${canonPath}${seoQs.toString() ? `?${seoQs}` : ''}`;
    const absImage =
      image && image.startsWith('/')
        ? `${origin}${image}`
        : image;

    const e = escapeHtml;
    return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<title>${e(title)}</title>
<meta name="description" content="${e(desc)}"/>
${noIndex ? '<meta name="robots" content="noindex,follow"/>' : ''}
<link rel="canonical" href="${e(canonical)}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${e(title)}"/>
<meta property="og:description" content="${e(desc)}"/>
<meta property="og:url" content="${e(canonical)}"/>
${absImage ? `<meta property="og:image" content="${e(absImage)}"/>` : ''}
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${e(title)}"/>
<meta name="twitter:description" content="${e(desc)}"/>
</head>
<body>
<h1>${e(label)}</h1>
<p><a href="${e(canonical)}">Открыть каталог</a></p>
</body>
</html>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
