import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DASHBOARD_REVENUE_STATUSES,
  moscowDateString,
  moscowDayEndExclusive,
  moscowDayStart,
  orderSalesWhere,
  resolveDashboardPeriod,
  type DashboardPeriodRange,
} from './dashboard-period.util';

const TOP_LIMIT = 10;
const TOP_MAX = 30;
const TIMESERIES_MAX_DAYS = 90;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function eachYmdInclusive(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  let cur = fromDate;
  for (let i = 0; i < TIMESERIES_MAX_DAYS + 2; i++) {
    out.push(cur);
    if (cur === toDate) break;
    const start = moscowDayStart(cur);
    if (!start) break;
    const next = moscowDayEndExclusive(cur);
    if (!next) break;
    cur = moscowDateString(next);
    if (out.length > TIMESERIES_MAX_DAYS) break;
  }
  return out;
}

@Injectable()
export class DashboardAdminService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveRange(opts: {
    period?: string;
    from?: string;
    to?: string;
  }): DashboardPeriodRange {
    try {
      return resolveDashboardPeriod(opts);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Некорректный период');
    }
  }

  private periodPayload(range: DashboardPeriodRange) {
    return {
      kind: range.kind,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      fromDate: range.fromDate,
      toDate: range.toDate,
    };
  }

  async getOverview(opts: { period?: string; from?: string; to?: string }) {
    const range = this.resolveRange(opts);
    const where = orderSalesWhere(range.from, range.to);

    const [agg, newClientsCount, topRaw] = await Promise.all([
      this.prisma.order.aggregate({
        where,
        _count: { _all: true },
        _sum: { total: true, refundedAmount: true },
      }),
      this.prisma.user.count({
        where: {
          role: UserRole.USER,
          createdAt: { gte: range.from, lt: range.to },
        },
      }),
      this.prisma.orderItem.groupBy({
        by: ['sku', 'title'],
        where: { order: where },
        _sum: { qty: true, lineTotal: true },
        orderBy: { _sum: { qty: 'desc' } },
        take: TOP_LIMIT,
      }),
    ]);

    const ordersCount = agg._count._all;
    const gross = agg._sum.total ?? 0;
    const refunded = agg._sum.refundedAmount ?? 0;
    const revenue = Math.max(0, gross - refunded);
    const averageCheck = ordersCount > 0 ? Math.round(revenue / ordersCount) : 0;

    const topProducts = await this.hydrateTopProducts(topRaw);

    return {
      period: this.periodPayload(range),
      ordersCount,
      revenue,
      averageCheck,
      newClientsCount,
      topProducts,
    };
  }

  /** Выручка и заказы по дням. По умолчанию summary (без полного series). */
  async getSalesTimeseries(opts: {
    period?: string;
    from?: string;
    to?: string;
    detail?: 'summary' | 'full';
  }) {
    const range = this.resolveRange(opts);
    const days = eachYmdInclusive(range.fromDate, range.toDate);
    if (days.length > TIMESERIES_MAX_DAYS) {
      throw new BadRequestException(
        `Период слишком длинный для ряда (макс. ${TIMESERIES_MAX_DAYS} дней)`,
      );
    }

    const statusList = DASHBOARD_REVENUE_STATUSES.map((s) => `'${s}'`).join(', ');
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ day: Date; orders: bigint; gross: bigint; refunded: bigint }>
    >(
      `
      SELECT
        (timezone('Europe/Moscow', o."createdAt"))::date AS day,
        COUNT(*)::bigint AS orders,
        COALESCE(SUM(o.total), 0)::bigint AS gross,
        COALESCE(SUM(o."refundedAmount"), 0)::bigint AS refunded
      FROM "Order" o
      WHERE o."createdAt" >= $1
        AND o."createdAt" < $2
        AND o.status::text IN (${statusList})
      GROUP BY 1
      ORDER BY 1
      `,
      range.from,
      range.to,
    );

    const byDay = new Map<string, { orders: number; revenue: number }>();
    for (const r of rows) {
      const ymd =
        r.day instanceof Date
          ? r.day.toISOString().slice(0, 10)
          : String(r.day).slice(0, 10);
      const revenue = Math.max(0, Number(r.gross) - Number(r.refunded));
      byDay.set(ymd, { orders: Number(r.orders), revenue });
    }

    const series = days.map((date) => {
      const hit = byDay.get(date);
      return {
        date,
        ordersCount: hit?.orders ?? 0,
        revenue: hit?.revenue ?? 0,
      };
    });

    const ordersCount = series.reduce((s, d) => s + d.ordersCount, 0);
    const revenue = series.reduce((s, d) => s + d.revenue, 0);

    let bestDay = series[0] ?? null;
    let worstDay = series[0] ?? null;
    for (const d of series) {
      if (!bestDay || d.revenue > bestDay.revenue) bestDay = d;
      if (!worstDay || d.revenue < worstDay.revenue) worstDay = d;
    }

    const deltas = series.slice(1).map((d, i) => {
      const prev = series[i]!;
      return {
        date: d.date,
        revenueDeltaVsPrev: d.revenue - prev.revenue,
        ordersDeltaVsPrev: d.ordersCount - prev.ordersCount,
      };
    });
    const topDeltas = [...deltas]
      .sort(
        (a, b) =>
          Math.abs(b.revenueDeltaVsPrev) - Math.abs(a.revenueDeltaVsPrev),
      )
      .slice(0, 5);

    const detail = opts.detail === 'full' ? 'full' : 'summary';
    const base = {
      period: this.periodPayload(range),
      detail,
      days: series.length,
      ordersCount,
      revenue,
      averageCheck: ordersCount > 0 ? Math.round(revenue / ordersCount) : 0,
      sparklineRevenue: series.map((d) => d.revenue),
      sparklineOrders: series.map((d) => d.ordersCount),
      bestDay,
      worstDay,
      topDeltas,
      adminLink: '/admin',
    };

    if (detail === 'full') {
      return { ...base, series };
    }
    return base;
  }

  /** Сравнение двух периодов с delta (один tool-call). */
  async comparePeriods(opts: {
    periodA?: string;
    fromA?: string;
    toA?: string;
    periodB?: string;
    fromB?: string;
    toB?: string;
  }) {
    const [a, b] = await Promise.all([
      this.getOverview({
        period: opts.periodA ?? 'today',
        from: opts.fromA,
        to: opts.toA,
      }),
      this.getOverview({
        period: opts.periodB ?? 'month',
        from: opts.fromB,
        to: opts.toB,
      }),
    ]);

    const pct = (cur: number, base: number) =>
      base === 0 ? (cur === 0 ? 0 : null) : Math.round(((cur - base) / base) * 1000) / 10;

    const slim = (o: Awaited<ReturnType<DashboardAdminService['getOverview']>>) => ({
      period: o.period,
      ordersCount: o.ordersCount,
      revenue: o.revenue,
      averageCheck: o.averageCheck,
      newClientsCount: o.newClientsCount,
    });

    return {
      a: slim(a),
      b: slim(b),
      delta: {
        ordersCount: a.ordersCount - b.ordersCount,
        ordersCountPct: pct(a.ordersCount, b.ordersCount),
        revenue: a.revenue - b.revenue,
        revenuePct: pct(a.revenue, b.revenue),
        averageCheck: a.averageCheck - b.averageCheck,
        averageCheckPct: pct(a.averageCheck, b.averageCheck),
        newClientsCount: a.newClientsCount - b.newClientsCount,
        newClientsCountPct: pct(a.newClientsCount, b.newClientsCount),
      },
      note: 'delta = a − b (положительное = a больше b)',
      adminLink: '/admin',
    };
  }

  /** Топ товаров за период (по выручке или количеству). */
  async getTopProducts(opts: {
    period?: string;
    from?: string;
    to?: string;
    sortBy?: string;
    limit?: number;
  }) {
    const range = this.resolveRange(opts);
    const where = orderSalesWhere(range.from, range.to);
    const sortBy = opts.sortBy === 'revenue' ? 'revenue' : 'qty';
    const limit = Math.min(
      TOP_MAX,
      Math.max(1, opts.limit ?? TOP_LIMIT),
    );

    const topRaw = await this.prisma.orderItem.groupBy({
      by: ['sku', 'title'],
      where: { order: where },
      _sum: { qty: true, lineTotal: true },
      orderBy:
        sortBy === 'revenue'
          ? { _sum: { lineTotal: 'desc' } }
          : { _sum: { qty: 'desc' } },
      take: limit,
    });

    const topProducts = await this.hydrateTopProducts(topRaw);

    return {
      period: this.periodPayload(range),
      sortBy,
      limit,
      items: topProducts.map((p) => ({
        ...p,
        adminLink: p.productId
          ? `/admin/catalog/products/${p.productId}`
          : '/admin/catalog/products',
      })),
      adminLink: '/admin',
    };
  }

  /** Воронка статусов заказов за период (все статусы, не только paid). */
  async getFunnelLite(opts: { period?: string; from?: string; to?: string }) {
    const range = this.resolveRange(opts);
    const grouped = await this.prisma.order.groupBy({
      by: ['status'],
      where: { createdAt: { gte: range.from, lt: range.to } },
      _count: { _all: true },
      _sum: { total: true, refundedAmount: true },
    });

    const byStatus = Object.fromEntries(
      (Object.values(OrderStatus) as OrderStatus[]).map((s) => [
        s,
        { count: 0, gross: 0, refunded: 0 },
      ]),
    ) as Record<OrderStatus, { count: number; gross: number; refunded: number }>;

    for (const row of grouped) {
      byStatus[row.status] = {
        count: row._count._all,
        gross: row._sum.total ?? 0,
        refunded: row._sum.refundedAmount ?? 0,
      };
    }

    const total = Object.values(byStatus).reduce((s, x) => s + x.count, 0);
    const paidLike = DASHBOARD_REVENUE_STATUSES.reduce(
      (s, st) => s + byStatus[st].count,
      0,
    );
    const cancelled = byStatus.CANCELLED.count;
    const refunded = byStatus.REFUNDED.count;
    const awaiting = byStatus.AWAITING_PAYMENT.count + byStatus.NEW.count;

    const statuses = (Object.values(OrderStatus) as OrderStatus[]).map((status) => {
      const row = byStatus[status];
      return {
        status,
        count: row.count,
        share: total > 0 ? Math.round((row.count / total) * 1000) / 10 : 0,
        gross: row.gross,
        refundedAmount: row.refunded,
      };
    });

    return {
      period: this.periodPayload(range),
      totalOrders: total,
      paidOrFulfillment: paidLike,
      cancelled,
      refunded,
      createdNotPaid: awaiting,
      cancelRate: total > 0 ? Math.round((cancelled / total) * 1000) / 10 : 0,
      paidRate: total > 0 ? Math.round((paidLike / total) * 1000) / 10 : 0,
      statuses,
      adminLink: '/admin/orders',
    };
  }

  /** Пробелы контента: summary + top highlights (без полных массивов). */
  async getContentGaps(opts?: {
    scopes?: Array<'faq' | 'pages' | 'blog' | 'hero' | 'home-promo'>;
    highlightLimit?: number;
  }) {
    const scopes = new Set(
      opts?.scopes?.length
        ? opts.scopes
        : (['faq', 'pages', 'blog', 'hero', 'home-promo'] as const),
    );
    const highlightLimit = Math.min(12, Math.max(3, opts?.highlightLimit ?? 8));

    const needFaq = scopes.has('faq');
    const needPages = scopes.has('pages');
    const needBlog = scopes.has('blog');
    const needHero = scopes.has('hero');
    const needHomePromo = scopes.has('home-promo');

    const [
      faqs,
      pages,
      posts,
      heroesActive,
      heroesTotal,
      homePromoActive,
      homePromoTotal,
    ] = await Promise.all([
      needFaq
        ? this.prisma.faqItem.findMany({
            select: {
              id: true,
              question: true,
              answer: true,
              active: true,
              sortOrder: true,
            },
            orderBy: { sortOrder: 'asc' },
          })
        : Promise.resolve([]),
      needPages
        ? this.prisma.cmsPage.findMany({
            select: {
              id: true,
              slug: true,
              title: true,
              bodyHtml: true,
              isPublished: true,
            },
            orderBy: { slug: 'asc' },
          })
        : Promise.resolve([]),
      needBlog
        ? this.prisma.blogPost.findMany({
            select: {
              id: true,
              slug: true,
              title: true,
              body: true,
              excerpt: true,
              isPublished: true,
            },
            orderBy: { updatedAt: 'desc' },
            take: 200,
          })
        : Promise.resolve([]),
      needHero
        ? this.prisma.heroSlide.count({ where: { active: true } })
        : Promise.resolve(0),
      needHero ? this.prisma.heroSlide.count() : Promise.resolve(0),
      needHomePromo
        ? this.prisma.homePromoBanner.count({ where: { active: true } })
        : Promise.resolve(0),
      needHomePromo ? this.prisma.homePromoBanner.count() : Promise.resolve(0),
    ]);

    type Highlight = {
      area: 'faq' | 'pages' | 'blog' | 'hero' | 'home-promo';
      title: string;
      reason: string;
      adminLink: string;
    };
    const highlights: Highlight[] = [];

    const faqGaps = faqs.filter((f) => !f.active || !f.answer.trim());
    for (const f of faqGaps) {
      highlights.push({
        area: 'faq',
        title: f.question,
        reason: !f.active ? 'inactive' : 'empty_answer',
        adminLink: '/admin/faq',
      });
    }

    const pageGaps = pages.filter(
      (p) => !p.isPublished || stripHtml(p.bodyHtml).length < 20,
    );
    for (const p of pageGaps) {
      highlights.push({
        area: 'pages',
        title: p.title || p.slug,
        reason: !p.isPublished ? 'unpublished' : 'thin_or_empty_body',
        adminLink: '/admin/pages',
      });
    }

    const postGaps = posts.filter(
      (p) =>
        !p.isPublished ||
        stripHtml(p.body).length < 40 ||
        !(p.excerpt ?? '').trim(),
    );
    for (const p of postGaps) {
      highlights.push({
        area: 'blog',
        title: p.title || p.slug,
        reason: !p.isPublished
          ? 'unpublished'
          : stripHtml(p.body).length < 40
            ? 'thin_or_empty_body'
            : 'missing_excerpt',
        adminLink: '/admin/blog',
      });
    }

    const heroGap =
      needHero && heroesActive === 0
        ? {
            activeSlides: 0,
            totalSlides: heroesTotal,
            reason: heroesTotal === 0 ? 'no_slides' : 'none_active',
            adminLink: '/admin/hero',
          }
        : null;
    if (heroGap) {
      highlights.push({
        area: 'hero',
        title: 'Hero на главной',
        reason: heroGap.reason,
        adminLink: '/admin/hero',
      });
    }

    const homePromoGap =
      needHomePromo && homePromoActive === 0
        ? {
            activeBanners: 0,
            totalBanners: homePromoTotal,
            reason: homePromoTotal === 0 ? 'no_banners' : 'none_active',
            adminLink: '/admin/settings/promo',
          }
        : null;
    if (homePromoGap) {
      highlights.push({
        area: 'home-promo',
        title: 'Промо на главной',
        reason: homePromoGap.reason,
        adminLink: '/admin/settings/promo',
      });
    }

    return {
      scopes: [...scopes],
      summary: {
        faqGaps: needFaq ? faqGaps.length : null,
        pageGaps: needPages ? pageGaps.length : null,
        blogGaps: needBlog ? postGaps.length : null,
        heroIssue: needHero ? Boolean(heroGap) : null,
        homePromoIssue: needHomePromo ? Boolean(homePromoGap) : null,
        totalHighlights: highlights.length,
      },
      highlights: highlights.slice(0, highlightLimit),
      hero: heroGap,
      homePromo: homePromoGap,
      adminLinks: {
        ...(needFaq ? { faq: '/admin/faq' } : {}),
        ...(needPages ? { pages: '/admin/pages' } : {}),
        ...(needBlog ? { blog: '/admin/blog' } : {}),
        ...(needHero ? { hero: '/admin/hero' } : {}),
        ...(needHomePromo ? { homePromo: '/admin/settings/promo' } : {}),
      },
    };
  }

  private async hydrateTopProducts(
    topRaw: Array<{
      sku: string;
      title: string;
      _sum: { qty: number | null; lineTotal: number | null };
    }>,
  ) {
    const skus = [...new Set(topRaw.map((r) => r.sku).filter(Boolean))];
    const variants = skus.length
      ? await this.prisma.productVariant.findMany({
          where: { sku: { in: skus } },
          select: {
            id: true,
            name: true,
            sku: true,
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                images: {
                  orderBy: { sortOrder: 'asc' },
                  take: 1,
                  select: { url: true },
                },
              },
            },
          },
        })
      : [];

    const bySku = new Map<string, (typeof variants)[number]>();
    for (const v of variants) {
      if (!bySku.has(v.sku)) bySku.set(v.sku, v);
    }

    return topRaw.map((row) => {
      const v = bySku.get(row.sku);
      const product = v?.product;
      return {
        variantId: v?.id ?? null,
        productId: product?.id ?? null,
        productName: product?.name ?? row.title,
        productSlug: product?.slug ?? null,
        variantName: v?.name ?? null,
        sku: row.sku || null,
        imageUrl: product?.images[0]?.url ?? null,
        qty: row._sum.qty ?? 0,
        revenue: row._sum.lineTotal ?? 0,
      };
    });
  }
}
