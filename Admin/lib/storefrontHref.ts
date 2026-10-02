import type { AdminCategory } from '@/lib/adminCatalogTypes';
import { HOME_PROMO_PAGE_OPTIONS } from '@/lib/homePromoPageOptions';

export type StorefrontLinkKind = 'page' | 'category' | 'product' | 'article' | 'custom';

export function categoryStorefrontHref(
  c: Pick<AdminCategory, 'slug'> & { parent?: { slug: string } | null },
): string {
  if (c.parent?.slug) {
    return `/catalog/${c.parent.slug}/${c.slug}`;
  }
  return `/catalog/${c.slug}`;
}

export function productStorefrontHref(slug: string): string {
  return `/product/${slug.trim()}`;
}

export function articleStorefrontHref(slug: string): string {
  return `/articles/${slug.trim()}`;
}

/** Угадать тип ссылки по уже сохранённому пути. */
export function inferStorefrontLinkKind(href: string): StorefrontLinkKind {
  const path = href.trim() || '/';
  if (HOME_PROMO_PAGE_OPTIONS.some((o) => o.href === path)) return 'page';
  if (path.startsWith('/product/') && path.length > '/product/'.length) return 'product';
  if (path.startsWith('/articles/') && path.length > '/articles/'.length) return 'article';
  if (path.startsWith('/catalog/') && path !== '/catalog') return 'category';
  return 'custom';
}
