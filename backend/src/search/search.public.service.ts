import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  htmlToSearchText,
  isHtmlNoiseQuery,
} from '../common/html-to-search-text.util';
import { catalogSellablePrices } from '../catalog/catalog-price.util';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogVisibilityService } from '../user-groups/catalog-visibility.service';
import { CommerceContextService } from '../user-groups/commerce-context.service';
import { GroupPricingService } from '../user-groups/group-pricing.service';

function formatRub(value: number): string {
  return `${Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} р.`;
}

/** Нормализация для ранжирования: lower + ё→е. */
export function normalizeSearchText(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, 'е');
}

/** Варианты строки для ILIKE (оригинал + без ё). */
export function searchForms(q: string): string[] {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const deyo = trimmed.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
  return deyo === trimmed ? [trimmed] : [trimmed, deyo];
}

/**
 * Лёгкий score без FTS/морфологии/опечаток:
 * exact > prefix > token-all > contains.
 */
export function scoreTitleMatch(title: string, q: string): number {
  const t = normalizeSearchText(title);
  const nq = normalizeSearchText(q);
  if (!nq || !t) return 0;
  if (t === nq) return 100;
  if (t.startsWith(nq)) return 80;
  const tokens = nq.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((tok) => t.includes(tok))) return 55;
  if (t.includes(nq)) return 40;
  return 10;
}

function containsInsensitive(form: string): Prisma.StringFilter {
  return { contains: form, mode: 'insensitive' };
}

function nameMatchesAnyForm(
  forms: string[],
): Array<{ name: Prisma.StringFilter }> {
  return forms.map((f) => ({ name: containsInsensitive(f) }));
}

export type SearchHit = {
  id: string;
  title: string;
  href: string;
  subtitle?: string | null;
  imageUrl?: string | null;
};

export type SearchGroup = {
  key: 'category' | 'product' | 'tag' | 'collection' | 'blog';
  label: string;
  items: SearchHit[];
};

/** Primary (title/sku/…) window — enough before content fillers. */
const PRODUCT_PRIMARY_TAKE = 40;
/** Content-only fillers (composition/description/actionEffect plain). */
const PRODUCT_CONTENT_TAKE = 40;
const PRODUCT_LIMIT = 48;
const CATEGORY_TAKE = 16;
const CATEGORY_LIMIT = 8;
const TAG_TAKE = 12;
const TAG_LIMIT = 6;
const COLLECTION_TAKE = 12;
const COLLECTION_LIMIT = 6;
const BLOG_PRIMARY_TAKE = 16;
const BLOG_BODY_TAKE = 16;
const BLOG_LIMIT = 8;

type ProductSearchRow = {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  images: Array<{ url: string }>;
  variants: Array<{ id: string; price: number }>;
};

type BlogSearchRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  coverUrl: string | null;
  category: { name: string } | null;
};

const productSelect = {
  id: true,
  name: true,
  slug: true,
  categoryId: true,
  images: {
    take: 1,
    orderBy: { sortOrder: 'asc' as const },
    select: { url: true },
  },
  variants: {
    where: { active: true },
    select: { id: true, price: true },
    orderBy: { price: 'asc' as const },
    take: 20,
  },
} satisfies Prisma.ProductSelect;

const blogSelect = {
  id: true,
  title: true,
  slug: true,
  excerpt: true,
  coverUrl: true,
  category: { select: { name: true } },
} satisfies Prisma.BlogPostSelect;

function mergeUniqueById<T extends { id: string }>(
  primary: T[],
  secondary: T[],
): T[] {
  const seen = new Set(primary.map((r) => r.id));
  const out = [...primary];
  for (const row of secondary) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

@Injectable()
export class SearchPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceContext: CommerceContextService,
    private readonly groupPricing: GroupPricingService,
    private readonly catalogVisibility: CatalogVisibilityService,
  ) {}

  async search(
    qRaw: string,
    opts?: { userId?: string | null },
  ): Promise<{ q: string; groups: SearchGroup[] }> {
    const q = qRaw.trim().slice(0, 80);
    const forms = searchForms(q);
    if (q.length < 2 || forms.length === 0) {
      return { q, groups: [] };
    }

    const skipRichText = isHtmlNoiseQuery(q);

    const hasActiveProducts: Prisma.CategoryWhereInput = {
      OR: [
        { products: { some: { active: true } } },
        {
          children: {
            some: { products: { some: { active: true } } },
          },
        },
      ],
    };

    const productPrimaryOr: Prisma.ProductWhereInput[] = [];
    const productContentOr: Prisma.ProductWhereInput[] = [];
    for (const f of forms) {
      const c = containsInsensitive(f);
      productPrimaryOr.push(
        { name: c },
        { slug: c },
        { shortDescription: c },
        {
          variants: {
            some: {
              OR: [
                { sku: c },
                { nationalCatalogName: c },
                { name: c },
                { shades: { some: { name: c } } },
              ],
            },
          },
        },
      );
      if (!skipRichText) {
        productContentOr.push({ compositionSearchText: c });
      }
    }

    const blogPrimaryOr: Prisma.BlogPostWhereInput[] = [];
    const blogBodyOr: Prisma.BlogPostWhereInput[] = [];
    for (const f of forms) {
      const c = containsInsensitive(f);
      blogPrimaryOr.push({ title: c }, { excerpt: c });
      if (!skipRichText) {
        blogBodyOr.push({ bodySearchText: c });
      }
    }

    const publishedBlog: Prisma.BlogPostWhereInput = {
      isPublished: true,
      OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
    };

    const [
      categories,
      primaryProducts,
      tags,
      collections,
      primaryPosts,
    ] = await Promise.all([
      this.prisma.category.findMany({
        where: {
          AND: [{ OR: nameMatchesAnyForm(forms) }, hasActiveProducts],
        },
        take: CATEGORY_TAKE,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          parentId: true,
          parent: { select: { slug: true, name: true } },
        },
      }),
      this.prisma.product.findMany({
        where: {
          active: true,
          excludeFromCatalog: false,
          OR: productPrimaryOr,
        },
        take: PRODUCT_PRIMARY_TAKE,
        orderBy: { name: 'asc' },
        select: productSelect,
      }),
      this.prisma.catalogTag.findMany({
        where: {
          AND: [
            { OR: nameMatchesAnyForm(forms) },
            {
              products: {
                some: { product: { active: true } },
              },
            },
          ],
        },
        take: TAG_TAKE,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          coverImageUrl: true,
        },
      }),
      this.prisma.collection.findMany({
        where: {
          active: true,
          OR: forms.flatMap((f) => {
            const c = containsInsensitive(f);
            return [{ name: c }, { slug: c }];
          }),
        },
        take: COLLECTION_TAKE,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          shortDescription: true,
          coverImageUrl: true,
        },
      }),
      this.prisma.blogPost.findMany({
        where: {
          ...publishedBlog,
          AND: [{ OR: blogPrimaryOr }],
        },
        take: BLOG_PRIMARY_TAKE,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        select: blogSelect,
      }),
    ]);

    const primaryProductIds = primaryProducts.map((p) => p.id);
    const primaryPostIds = primaryPosts.map((p) => p.id);

    const [contentProducts, bodyPosts] = await Promise.all([
      productContentOr.length
        ? this.prisma.product.findMany({
            where: {
              active: true,
              excludeFromCatalog: false,
              OR: productContentOr,
              ...(primaryProductIds.length
                ? { id: { notIn: primaryProductIds } }
                : {}),
            },
            take: PRODUCT_CONTENT_TAKE,
            orderBy: { name: 'asc' },
            select: productSelect,
          })
        : Promise.resolve([] as ProductSearchRow[]),
      blogBodyOr.length
        ? this.prisma.blogPost.findMany({
            where: {
              ...publishedBlog,
              AND: [{ OR: blogBodyOr }],
              ...(primaryPostIds.length
                ? { id: { notIn: primaryPostIds } }
                : {}),
            },
            take: BLOG_BODY_TAKE,
            orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
            select: blogSelect,
          })
        : Promise.resolve([] as BlogSearchRow[]),
    ]);

    let products = mergeUniqueById<ProductSearchRow>(
      primaryProducts,
      contentProducts,
    );
    products = await this.applyBuyerCommerce(products, opts?.userId);
    const posts = mergeUniqueById<BlogSearchRow>(primaryPosts, bodyPosts);

    const groups: SearchGroup[] = [];

    const rankedCategories = [...categories]
      .sort((a, b) => scoreTitleMatch(b.name, q) - scoreTitleMatch(a.name, q))
      .slice(0, CATEGORY_LIMIT);
    if (rankedCategories.length) {
      groups.push({
        key: 'category',
        label: 'Каталог',
        items: rankedCategories.map((c) => {
          const href = c.parent
            ? `/catalog/${encodeURIComponent(c.parent.slug)}/${encodeURIComponent(c.slug)}`
            : `/catalog/${encodeURIComponent(c.slug)}`;
          return {
            id: c.id,
            title: c.name,
            href,
            subtitle: c.parent?.name ?? null,
          };
        }),
      });
    }

    const rankedProducts = [...products]
      .sort((a, b) => scoreTitleMatch(b.name, q) - scoreTitleMatch(a.name, q))
      .slice(0, PRODUCT_LIMIT);
    if (rankedProducts.length) {
      groups.push({
        key: 'product',
        label: 'Товар',
        items: rankedProducts.map((p) => {
          const prices = catalogSellablePrices(p.variants);
          const min = prices.length ? Math.min(...prices) : null;
          const max = prices.length ? Math.max(...prices) : null;
          let subtitle: string | null = null;
          if (min != null) {
            const formatted = formatRub(min);
            subtitle = max != null && max > min ? `от ${formatted}` : formatted;
          }
          return {
            id: p.id,
            title: p.name,
            href: `/product/${encodeURIComponent(p.slug)}`,
            subtitle,
            imageUrl: p.images[0]?.url ?? null,
          };
        }),
      });
    }

    const rankedTags = [...tags]
      .sort((a, b) => scoreTitleMatch(b.name, q) - scoreTitleMatch(a.name, q))
      .slice(0, TAG_LIMIT);
    if (rankedTags.length) {
      groups.push({
        key: 'tag',
        label: 'Зона',
        items: rankedTags.map((t) => ({
          id: t.id,
          title: t.name,
          href: `/catalog?tag=${encodeURIComponent(t.slug)}`,
          imageUrl: t.coverImageUrl,
        })),
      });
    }

    const rankedCollections = [...collections]
      .sort((a, b) => scoreTitleMatch(b.name, q) - scoreTitleMatch(a.name, q))
      .slice(0, COLLECTION_LIMIT);
    if (rankedCollections.length) {
      groups.push({
        key: 'collection',
        label: 'Коллекция',
        items: rankedCollections.map((c) => ({
          id: c.id,
          title: c.name,
          href: `/catalog?collection=${encodeURIComponent(c.slug)}`,
          subtitle: c.shortDescription,
          imageUrl: c.coverImageUrl,
        })),
      });
    }

    const rankedPosts = [...posts]
      .sort((a, b) => scoreTitleMatch(b.title, q) - scoreTitleMatch(a.title, q))
      .slice(0, BLOG_LIMIT);
    if (rankedPosts.length) {
      groups.push({
        key: 'blog',
        label: 'Блог',
        items: rankedPosts.map((p) => ({
          id: p.id,
          title: p.title,
          href: `/articles/${encodeURIComponent(p.slug)}`,
          subtitle:
            p.category?.name ?? htmlToSearchText(p.excerpt) ?? null,
          imageUrl: p.coverUrl,
        })),
      });
    }

    return { q, groups };
  }

  /** Visibility + group price for search hit subtitles. */
  private async applyBuyerCommerce(
    products: ProductSearchRow[],
    userId?: string | null,
  ): Promise<ProductSearchRow[]> {
    if (!products.length) return products;
    const ctx = await this.commerceContext.resolveFromUserId(userId);
    const visible =
      await this.catalogVisibility.applyVariantVisibilityToProductSources(
        ctx,
        products,
      );
    if (!visible.length) return [];
    const inputs = visible.flatMap((p) =>
      p.variants.map((v) => ({
        variantId: v.id,
        categoryId: p.categoryId,
        basePrice: v.price,
      })),
    );
    const prices = await this.groupPricing.resolveVariantPrices(ctx, inputs);
    return visible.map((p) => ({
      ...p,
      variants: p.variants.map((v) => {
        const resolved = prices.get(v.id);
        return resolved ? { ...v, price: resolved.groupPrice } : v;
      }),
    }));
  }
}
