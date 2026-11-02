import type { Metadata } from 'next';
import {
  fetchPublicCatalogTags,
  fetchPublicCategories,
  fetchPublicCollection,
  fetchPublicProductsPage,
  fetchPublicSearch,
  PUBLIC_CATALOG_PAGE_SIZE,
  type PublicCategoryNode,
  type PublicProductCard,
} from '@/lib/publicCatalog';
import type { CatalogNotice } from './CatalogClient';

export type CatalogSearch = {
  tag?: string;
  collection?: string;
  sale?: string;
  priceMin?: string;
  priceMax?: string;
  page?: string;
  q?: string;
  /** legacy — только для редиректа со старых URL */
  cat?: string;
  sub?: string;
};

export function siteOrigin(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    '';
  return fromEnv.replace(/\/+$/, '') || 'http://localhost:3000';
}

export function catalogPath(cat: string, sub = ''): string {
  if (!cat) return '/catalog';
  const base = `/catalog/${encodeURIComponent(cat)}`;
  return sub ? `${base}/${encodeURIComponent(sub)}` : base;
}

function findSubcategoryInRoot(
  root: PublicCategoryNode,
  slug: string,
): PublicCategoryNode | null {
  const chain = findSubcategoryChainInRoot(root, slug);
  return chain[chain.length - 1] ?? null;
}

export function findSubcategoryChainInRoot(
  root: PublicCategoryNode,
  slug: string,
): PublicCategoryNode[] {
  for (const child of root.children ?? []) {
    if (child.slug === slug) return [child];
    for (const grand of child.children ?? []) {
      if (grand.slug === slug) return [child, grand];
    }
  }
  return [];
}

function findCategoryInTree(
  categories: PublicCategoryNode[],
  slug: string,
): { root: PublicCategoryNode; leaf: PublicCategoryNode } | null {
  for (const root of categories) {
    if (root.slug === slug) return { root, leaf: root };
    for (const child of root.children ?? []) {
      if (child.slug === slug) return { root, leaf: child };
      for (const grand of child.children ?? []) {
        if (grand.slug === slug) return { root, leaf: grand };
      }
    }
  }
  return null;
}

function resolveNotice(opts: {
  cat: string;
  sub: string;
  tag: string;
  collection: string;
  categories: PublicCategoryNode[];
  tags: Awaited<ReturnType<typeof fetchPublicCatalogTags>>;
  collectionOk: boolean;
  productsOk: boolean;
}): CatalogNotice | null {
  if (!opts.productsOk) return 'api';
  if (opts.collection && !opts.collectionOk) return 'unknown_collection';
  if (opts.tag && !opts.tags.some((t) => t.slug === opts.tag)) return 'unknown_tag';
  if (opts.cat) {
    const root = opts.categories.find((c) => c.slug === opts.cat);
    if (!root) return 'unknown_cat';
    if (opts.sub && !findSubcategoryInRoot(root, opts.sub)) {
      return 'unknown_sub';
    }
  } else if (opts.sub) {
    return 'unknown_sub';
  }
  return null;
}

export async function buildCatalogMetadata(opts: {
  cat: string;
  sub: string;
  searchParams: CatalogSearch;
}): Promise<Metadata> {
  const cat = opts.cat.trim();
  const sub = opts.sub.trim();
  const tag = opts.searchParams.tag?.trim() || '';
  const collection = opts.searchParams.collection?.trim() || '';
  const q = opts.searchParams.q?.trim() || '';

  if (q) {
    const label = `Поиск: ${q}`;
    return {
      title: `${label} — Jcos`,
      description: `Результаты поиска «${q}» в каталоге Jcos`,
      robots: { index: false, follow: true },
    };
  }

  const [categories, tags, collectionRow] = await Promise.all([
    cat || sub ? fetchPublicCategories() : Promise.resolve([]),
    tag ? fetchPublicCatalogTags() : Promise.resolve([]),
    collection ? fetchPublicCollection(collection) : Promise.resolve(null),
  ]);

  let label = 'Каталог';
  if (collectionRow) {
    label = collectionRow.name;
  } else if (tag) {
    const known = tags.find((t) => t.slug === tag);
    if (known) label = known.name;
  } else if (cat) {
    const root = categories.find((c) => c.slug === cat);
    if (root && sub) {
      label = findSubcategoryInRoot(root, sub)?.name ?? root.name;
    } else if (root) {
      label = root.name;
    }
  }

  const title = label === 'Каталог' ? 'Каталог — Jcos' : `${label} — Jcos`;
  const path = catalogPath(cat, sub);
  // SEO-лендинги: collection/tag в canonical; sale/price/page — нет (фильтры).
  const seoQs = new URLSearchParams();
  if (collection) seoQs.set('collection', collection);
  if (tag) seoQs.set('tag', tag);
  const seoPath = seoQs.toString() ? `${path}?${seoQs}` : path;
  const url = `${siteOrigin()}${seoPath}`;

  return {
    title,
    description: `Купить ${label.toLowerCase()} в Jcos`,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      title: label,
      description: `Купить ${label.toLowerCase()} в Jcos`,
      images: collectionRow?.coverImageUrl
        ? [{ url: collectionRow.coverImageUrl, alt: collectionRow.name }]
        : undefined,
    },
  };
}

async function hydrateSearchPage(
  q: string,
  page: number,
): Promise<{ items: PublicProductCard[]; total: number; page: number; limit: number } | null> {
  const search = await fetchPublicSearch(q);
  if (!search) return null;
  const productGroup = search.groups?.find((g) => g.key === 'product');
  const hits = productGroup?.items ?? [];
  const total = hits.length;
  const limit = PUBLIC_CATALOG_PAGE_SIZE;
  const start = (page - 1) * limit;
  const slice = hits.slice(start, start + limit);
  const slugs = slice
    .map((h) => h.href.replace(/^\/product\//, '').split('?')[0]?.trim() || '')
    .filter(Boolean);
  if (!slugs.length) {
    return { items: [], total, page, limit };
  }
  const cards = await fetchPublicProductsPage({
    slugs,
    limit: slugs.length,
    page: 1,
  });
  if (!cards) return null;
  const bySlug = new Map(cards.items.map((c) => [c.slug, c]));
  const items = slugs
    .map((s) => bySlug.get(s))
    .filter((c): c is PublicProductCard => Boolean(c));
  return { items, total, page, limit };
}

export async function loadCatalogPage(opts: {
  cat: string;
  sub: string;
  searchParams: CatalogSearch;
}) {
  let cat = opts.cat.trim();
  let sub = opts.sub.trim();
  const tag = opts.searchParams.tag?.trim() || '';
  const collection = opts.searchParams.collection?.trim() || '';
  const q = opts.searchParams.q?.trim() || '';
  const sale = opts.searchParams.sale === '1';
  const priceMin = opts.searchParams.priceMin
    ? Number(opts.searchParams.priceMin)
    : undefined;
  const priceMax = opts.searchParams.priceMax
    ? Number(opts.searchParams.priceMax)
    : undefined;
  const page = Math.max(1, Number(opts.searchParams.page) || 1);

  const [categories, tags, collectionRow] = await Promise.all([
    fetchPublicCategories(),
    fetchPublicCatalogTags(),
    collection ? fetchPublicCollection(collection) : Promise.resolve(null),
  ]);

  // /catalog/:slug — может быть L2/L3 или тег
  if (cat && !sub) {
    const root = categories.find((c) => c.slug === cat);
    if (!root) {
      const found = findCategoryInTree(categories, cat);
      if (found) {
        cat = found.root.slug;
        if (found.leaf.slug !== found.root.slug) sub = found.leaf.slug;
      }
    }
  }

  let productsPage: {
    items: PublicProductCard[];
    total: number;
    page: number;
    limit: number;
  } | null;

  if (q) {
    productsPage = await hydrateSearchPage(q, page);
  } else {
    productsPage = await fetchPublicProductsPage({
      page,
      limit: PUBLIC_CATALOG_PAGE_SIZE,
      category: sub || cat || undefined,
      tag: tag || undefined,
      collection: collection || undefined,
      sort: 'newest',
      sale,
      priceMin: Number.isFinite(priceMin) ? priceMin : undefined,
      priceMax: Number.isFinite(priceMax) ? priceMax : undefined,
    });
  }

  const notice = q
    ? productsPage == null
      ? ('api' as const)
      : null
    : resolveNotice({
        cat,
        sub,
        tag,
        collection,
        categories,
        tags,
        collectionOk: !collection || collectionRow != null,
        productsOk: productsPage != null,
      });

  const root = cat ? categories.find((c) => c.slug === cat) ?? null : null;
  const rootKnown = !cat || Boolean(root);
  const subKnown = !sub || Boolean(root && findSubcategoryInRoot(root, sub));
  const tagKnown = !tag || tags.some((t) => t.slug === tag);
  const collectionKnown = !collection || collectionRow != null;
  const filtersKnown = q
    ? true
    : rootKnown && subKnown && tagKnown && collectionKnown;

  const safePage =
    productsPage && filtersKnown && notice !== 'api'
      ? productsPage
      : { items: [], total: 0, page: 1, limit: PUBLIC_CATALOG_PAGE_SIZE };

  let title = 'Каталог';
  if (q) title = `Поиск: ${q}`;
  else if (collectionRow) title = collectionRow.name;
  else if (root && sub) {
    title = findSubcategoryInRoot(root, sub)?.name ?? root.name;
  } else if (root) title = root.name;
  else if (tag) title = tags.find((t) => t.slug === tag)?.name ?? 'Каталог';

  return {
    categories,
    tags,
    notice,
    initial: {
      items: safePage.items,
      total: safePage.total,
      page: safePage.page,
      limit: safePage.limit,
      cat: rootKnown ? cat : '',
      sub: rootKnown && subKnown ? sub : '',
      tag: tagKnown ? tag : '',
      collection: collectionKnown ? collection : '',
      collectionName: collectionRow?.name ?? null,
      sale,
      priceMin: Number.isFinite(priceMin) ? priceMin! : null,
      priceMax: Number.isFinite(priceMax) ? priceMax! : null,
      q,
      title,
    },
  };
}
