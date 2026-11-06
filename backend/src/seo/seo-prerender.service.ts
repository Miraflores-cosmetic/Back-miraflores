import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogPublicService } from '../catalog/catalog.public.service';
import { resolvePublicSiteUrl } from './site-public-url.util';

export type BotHtmlResult = { status: number; body: string };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(html: string | null | undefined, maxLen: number): string {
  if (!html?.trim()) return '';
  const t = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > maxLen ? `${t.slice(0, maxLen - 1)}…` : t;
}

type SiteSeoFields = {
  titleSuffix: string;
  defaultMetaDescription: string | null;
  defaultOgImageUrl: string | null;
  homeMetaTitle: string | null;
  homeMetaDescription: string | null;
  homeOgImageUrl: string | null;
};

function buildShell(opts: {
  title: string;
  description: string;
  canonical: string;
  image?: string | null;
  noIndex?: boolean;
  h1: string;
  lead?: string;
}): string {
  const e = escapeHtml;
  const ogImage =
    opts.image && opts.image.startsWith('/')
      ? `${new URL(opts.canonical).origin}${opts.image}`
      : opts.image;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<title>${e(opts.title)}</title>
<meta name="description" content="${e(opts.description)}"/>
${opts.noIndex ? '<meta name="robots" content="noindex,follow"/>' : ''}
<link rel="canonical" href="${e(opts.canonical)}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${e(opts.title)}"/>
<meta property="og:description" content="${e(opts.description)}"/>
<meta property="og:url" content="${e(opts.canonical)}"/>
${ogImage ? `<meta property="og:image" content="${e(ogImage)}"/>` : ''}
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${e(opts.title)}"/>
<meta name="twitter:description" content="${e(opts.description)}"/>
</head>
<body>
<h1>${e(opts.h1)}</h1>
${opts.lead ? `<p>${e(opts.lead)}</p>` : ''}
<p><a href="${e(opts.canonical)}">Открыть страницу</a></p>
</body>
</html>`;
}

@Injectable()
export class SeoPrerenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly catalogPublic: CatalogPublicService,
  ) {}

  private origin(): string {
    return resolvePublicSiteUrl(this.config);
  }

  private async siteSeo(): Promise<SiteSeoFields> {
    const row = await this.prisma.siteSettings.findUnique({
      where: { id: 'default' },
    });
    if (!row) {
      return {
        titleSuffix: 'Miraflores',
        defaultMetaDescription: null,
        defaultOgImageUrl: null,
        homeMetaTitle: null,
        homeMetaDescription: null,
        homeOgImageUrl: null,
      };
    }
    return {
      titleSuffix: row.titleSuffix?.trim() || 'Miraflores',
      defaultMetaDescription: row.defaultMetaDescription,
      defaultOgImageUrl: row.defaultOgImageUrl,
      homeMetaTitle: row.homeMetaTitle,
      homeMetaDescription: row.homeMetaDescription,
      homeOgImageUrl: row.homeOgImageUrl,
    };
  }

  /**
   * `uri` как в nginx `$request_uri`: путь + query, напр. /product/x или /catalog?collection=z
   */
  async renderBotHtml(uri: string): Promise<BotHtmlResult> {
    const raw = uri?.trim() || '/';
    let pathname = '/';
    let collection = '';
    let tag = '';
    let q = '';
    let pathWithQuery = '/';
    try {
      const base = 'https://placeholder.local';
      const u = new URL(raw.startsWith('/') ? `${base}${raw}` : raw);
      pathname = u.pathname || '/';
      pathWithQuery = `${pathname}${u.search}`;
      collection = u.searchParams.get('collection')?.trim() || '';
      tag = u.searchParams.get('tag')?.trim() || '';
      q = u.searchParams.get('q')?.trim() || '';
    } catch {
      pathname = '/';
      pathWithQuery = '/';
    }

    if (pathname === '/' || pathname === '') {
      const body = await this.renderHome();
      return { status: 200, body };
    }

    if (pathname.startsWith('/catalog')) {
      try {
        const body = await this.catalogPublic.renderOpenGraphHtml({
          path: pathname,
          collection,
          tag,
          q,
        });
        return { status: 200, body };
      } catch (e) {
        if (e instanceof NotFoundException) {
          return {
            status: 404,
            body: await this.catalogPublic.renderBotNotFoundPage(pathWithQuery),
          };
        }
        throw e;
      }
    }

    if (pathname.startsWith('/product/')) {
      const slug = decodeURIComponent(
        pathname.slice('/product/'.length).split('/')[0] ?? '',
      ).trim();
      if (!slug) {
        return {
          status: 404,
          body: await this.catalogPublic.renderBotNotFoundPage(pathWithQuery),
        };
      }
      return this.renderProduct(slug, pathWithQuery);
    }

    if (pathname.startsWith('/articles/')) {
      const slug = decodeURIComponent(
        pathname.slice('/articles/'.length).split('/')[0] ?? '',
      ).trim();
      if (!slug) {
        return {
          status: 404,
          body: await this.catalogPublic.renderBotNotFoundPage(pathWithQuery),
        };
      }
      return this.renderArticle(slug, pathWithQuery);
    }

    return {
      status: 404,
      body: await this.catalogPublic.renderBotNotFoundPage(pathWithQuery),
    };
  }

  private async renderHome(): Promise<string> {
    const seo = await this.siteSeo();
    const o = this.origin();
    const homeTitle = seo.homeMetaTitle?.trim();
    const title = homeTitle || seo.titleSuffix;
    const h1 = homeTitle || seo.titleSuffix;
    const desc =
      seo.homeMetaDescription?.trim() ||
      seo.defaultMetaDescription?.trim() ||
      h1;
    const image = seo.homeOgImageUrl?.trim() || seo.defaultOgImageUrl?.trim();
    return buildShell({
      title,
      description: desc,
      canonical: `${o}/`,
      image,
      h1,
    });
  }

  private async renderProduct(
    slug: string,
    requestPathWithQuery: string,
  ): Promise<BotHtmlResult> {
    const row = await this.prisma.product.findFirst({
      where: { slug, active: true, excludeFromCatalog: false },
      select: {
        name: true,
        shortDescription: true,
        pageShortDescriptionHtml: true,
        metaTitle: true,
        metaDescription: true,
        ogImageUrl: true,
        canonicalPath: true,
        seoNoIndex: true,
        images: {
          orderBy: { sortOrder: 'asc' },
          take: 1,
          select: { url: true },
        },
      },
    });
    if (!row) {
      return {
        status: 404,
        body: await this.catalogPublic.renderBotNotFoundPage(requestPathWithQuery),
      };
    }

    const o = this.origin();
    const path =
      row.canonicalPath?.trim() || `/product/${encodeURIComponent(slug)}`;
    const canonical = path.startsWith('http')
      ? path
      : `${o}${path.startsWith('/') ? path : `/${path}`}`;

    const seo = await this.siteSeo();
    const titleBase = row.metaTitle?.trim() || row.name;
    const title = `${titleBase} — ${seo.titleSuffix}`;

    const desc =
      row.metaDescription?.trim() ||
      stripHtml(row.pageShortDescriptionHtml, 320) ||
      stripHtml(row.shortDescription, 320) ||
      titleBase;

    const img =
      row.ogImageUrl?.trim() || row.images[0]?.url || seo.defaultOgImageUrl;

    return {
      status: 200,
      body: buildShell({
        title,
        description: desc,
        canonical,
        image: img,
        h1: row.name,
        lead: row.shortDescription?.trim() || undefined,
        noIndex: row.seoNoIndex === true,
      }),
    };
  }

  private async renderArticle(
    slug: string,
    requestPathWithQuery: string,
  ): Promise<BotHtmlResult> {
    const s = slug.trim();
    const now = new Date();
    const row = await this.prisma.blogPost.findFirst({
      where: {
        slug: s,
        isPublished: true,
        OR: [{ publishedAt: null }, { publishedAt: { lte: now } }],
      },
      select: {
        title: true,
        excerpt: true,
        metaTitle: true,
        metaDescription: true,
        ogImageUrl: true,
        canonicalPath: true,
        seoNoIndex: true,
        coverUrl: true,
      },
    });
    if (!row) {
      return {
        status: 404,
        body: await this.catalogPublic.renderBotNotFoundPage(requestPathWithQuery),
      };
    }

    const o = this.origin();
    const path =
      row.canonicalPath?.trim() || `/articles/${encodeURIComponent(s)}`;
    const canonical = path.startsWith('http')
      ? path
      : `${o}${path.startsWith('/') ? path : `/${path}`}`;

    const seo = await this.siteSeo();
    const titleBase = row.metaTitle?.trim() || row.title;
    const title = `${titleBase} — ${seo.titleSuffix}`;

    const desc =
      row.metaDescription?.trim() ||
      stripHtml(row.excerpt, 320) ||
      titleBase;

    const img =
      row.ogImageUrl?.trim() || row.coverUrl || seo.defaultOgImageUrl;

    return {
      status: 200,
      body: buildShell({
        title,
        description: desc,
        canonical,
        image: img,
        h1: row.title,
        lead: stripHtml(row.excerpt, 200) || undefined,
        noIndex: row.seoNoIndex === true,
      }),
    };
  }
}
