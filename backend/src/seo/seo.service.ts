import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { uniqueCategoryCatalogPaths } from './category-catalog-path.util';
import { resolvePublicSiteUrl } from './site-public-url.util';

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lastmodDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class SeoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private baseUrl(): string {
    return resolvePublicSiteUrl(this.config);
  }

  private abs(path: string): string {
    const base = this.baseUrl();
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base}${p}`;
  }

  getRobotsTxt(): string {
    const sitemap = this.abs('/sitemap.xml');
    return [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /api/',
      '',
      `Sitemap: ${sitemap}`,
      '',
    ].join('\n');
  }

  async getSitemapXml(): Promise<string> {
    const [categories, products, collections, posts] = await Promise.all([
      this.prisma.category.findMany({
        select: { id: true, slug: true, parentId: true, updatedAt: true },
      }),
      this.prisma.product.findMany({
        where: {
          active: true,
          excludeFromCatalog: false,
          seoNoIndex: false,
        },
        select: { slug: true, updatedAt: true },
      }),
      this.prisma.collection.findMany({
        where: { active: true },
        select: { slug: true, updatedAt: true },
      }),
      this.prisma.blogPost.findMany({
        where: { isPublished: true, seoNoIndex: false },
        select: { slug: true, updatedAt: true, publishedAt: true },
      }),
    ]);

    const urls: Array<{ loc: string; lastmod: Date }> = [];

    urls.push({ loc: this.abs('/'), lastmod: new Date() });

    const catPaths = uniqueCategoryCatalogPaths(categories);
    for (const [path, lastmod] of catPaths) {
      urls.push({ loc: this.abs(path), lastmod });
    }

    for (const p of products) {
      urls.push({
        loc: this.abs(`/product/${encodeURIComponent(p.slug)}`),
        lastmod: p.updatedAt,
      });
    }

    for (const col of collections) {
      urls.push({
        loc: this.abs(`/catalog?collection=${encodeURIComponent(col.slug)}`),
        lastmod: col.updatedAt,
      });
    }

    for (const post of posts) {
      const mod = post.publishedAt ?? post.updatedAt;
      urls.push({
        loc: this.abs(`/articles/${encodeURIComponent(post.slug)}`),
        lastmod: mod,
      });
    }

    urls.sort((a, b) => a.loc.localeCompare(b.loc));

    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ];
    for (const u of urls) {
      lines.push('  <url>');
      lines.push(`    <loc>${xmlEscape(u.loc)}</loc>`);
      lines.push(`    <lastmod>${lastmodDay(u.lastmod)}</lastmod>`);
      lines.push('  </url>');
    }
    lines.push('</urlset>');
    return lines.join('\n');
  }
}
