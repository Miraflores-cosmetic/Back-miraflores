import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { DashboardAdminService } from './dashboard-admin.service';

function makePrisma() {
  return {
    order: {
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    user: { count: vi.fn() },
    orderItem: { groupBy: vi.fn() },
    productVariant: { findMany: vi.fn() },
    faqItem: { findMany: vi.fn() },
    cmsPage: { findMany: vi.fn() },
    blogPost: { findMany: vi.fn() },
    heroSlide: { count: vi.fn() },
    homePromoBanner: { count: vi.fn() },
    $queryRawUnsafe: vi.fn(),
  };
}

describe('DashboardAdminService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: DashboardAdminService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new DashboardAdminService(prisma as never);
  });

  it('getOverview считает KPI и топ по sku+title (в т.ч. без variant)', async () => {
    prisma.order.aggregate.mockResolvedValue({
      _count: { _all: 2 },
      _sum: { total: 3000, refundedAmount: 500 },
    });
    prisma.user.count.mockResolvedValue(1);
    prisma.orderItem.groupBy.mockResolvedValue([
      { sku: 'sku-1', title: 'Крем 50 мл', _sum: { qty: 5, lineTotal: 2500 } },
      { sku: 'gone', title: 'Удалённый товар', _sum: { qty: 2, lineTotal: 500 } },
    ]);
    prisma.productVariant.findMany.mockResolvedValue([
      {
        id: 'v1',
        name: '50 мл',
        sku: 'sku-1',
        product: {
          id: 'p1',
          name: 'Крем',
          slug: 'krem',
          images: [{ url: 'https://x/a.jpg' }],
        },
      },
    ]);

    const res = await svc.getOverview({ period: 'today' });

    expect(res.ordersCount).toBe(2);
    expect(res.revenue).toBe(2500);
    expect(res.averageCheck).toBe(1250);
    expect(res.newClientsCount).toBe(1);
    expect(prisma.order.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: expect.arrayContaining([OrderStatus.PAID]) },
        }),
      }),
    );
    expect(prisma.orderItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['sku', 'title'],
        where: expect.objectContaining({ order: expect.any(Object) }),
      }),
    );
    expect(res.topProducts).toEqual([
      expect.objectContaining({
        productId: 'p1',
        productName: 'Крем',
        sku: 'sku-1',
        qty: 5,
        revenue: 2500,
        imageUrl: 'https://x/a.jpg',
      }),
      expect.objectContaining({
        productId: null,
        productName: 'Удалённый товар',
        sku: 'gone',
        qty: 2,
        revenue: 500,
      }),
    ]);
  });

  it('getOverview → BadRequest на кривой custom', async () => {
    await expect(
      svc.getOverview({ period: 'custom', from: 'bad', to: '2026-07-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getFunnelLite считает доли и cancelRate', async () => {
    prisma.order.groupBy.mockResolvedValue([
      { status: OrderStatus.PAID, _count: { _all: 8 }, _sum: { total: 8000, refundedAmount: 0 } },
      { status: OrderStatus.CANCELLED, _count: { _all: 2 }, _sum: { total: 500, refundedAmount: 0 } },
    ]);

    const res = await svc.getFunnelLite({ period: 'month' });

    expect(res.totalOrders).toBe(10);
    expect(res.cancelled).toBe(2);
    expect(res.cancelRate).toBe(20);
    expect(res.paidOrFulfillment).toBe(8);
    expect(res.statuses.find((s) => s.status === OrderStatus.PAID)?.count).toBe(8);
  });

  it('getTopProducts сортирует по revenue', async () => {
    prisma.orderItem.groupBy.mockResolvedValue([
      { sku: 'a', title: 'A', _sum: { qty: 1, lineTotal: 9000 } },
    ]);
    prisma.productVariant.findMany.mockResolvedValue([]);

    await svc.getTopProducts({ period: 'today', sortBy: 'revenue', limit: 5 });

    expect(prisma.orderItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { _sum: { lineTotal: 'desc' } },
        take: 5,
      }),
    );
  });

  it('getContentGaps находит пустой FAQ и hero без active', async () => {
    prisma.faqItem.findMany.mockResolvedValue([
      { id: '1', question: 'Q', answer: '', active: true, sortOrder: 0 },
      { id: '2', question: 'Q2', answer: 'Ok', active: false, sortOrder: 1 },
    ]);
    prisma.cmsPage.findMany.mockResolvedValue([
      {
        id: 'p1',
        slug: 'privacy',
        title: 'Privacy',
        bodyHtml: '<p>длинный достаточный текст страницы политики</p>',
        isPublished: true,
      },
    ]);
    prisma.blogPost.findMany.mockResolvedValue([]);
    prisma.heroSlide.count
      .mockResolvedValueOnce(0) // active
      .mockResolvedValueOnce(3); // total
    prisma.homePromoBanner.count
      .mockResolvedValueOnce(0) // active
      .mockResolvedValueOnce(2); // total

    const res = await svc.getContentGaps();

    expect(res.summary.faqGaps).toBe(2);
    expect(res.highlights[0].reason).toBe('empty_answer');
    expect(res.hero?.reason).toBe('none_active');
    expect(res.summary.homePromoIssue).toBe(true);
    expect(res.homePromo?.reason).toBe('none_active');
    expect(res.homePromo?.activeBanners).toBe(0);
    expect(res.homePromo?.totalBanners).toBe(2);
    expect(res.adminLinks.homePromo).toBe('/admin/settings/promo');
    expect(res).not.toHaveProperty('faq');
  });

  it('getContentGaps: home-promo no_banners когда вообще нет карточек', async () => {
    prisma.faqItem.findMany.mockResolvedValue([]);
    prisma.cmsPage.findMany.mockResolvedValue([]);
    prisma.blogPost.findMany.mockResolvedValue([]);
    prisma.heroSlide.count.mockResolvedValue(1);
    prisma.homePromoBanner.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const res = await svc.getContentGaps({ scopes: ['home-promo'] });

    expect(res.homePromo?.reason).toBe('no_banners');
    expect(res.summary.homePromoIssue).toBe(true);
    expect(res.highlights.some((h) => h.area === 'home-promo')).toBe(true);
  });

  it('getContentGaps режет scopes (только blog)', async () => {
    prisma.blogPost.findMany.mockResolvedValue([
      {
        id: 'b1',
        slug: 'post',
        title: 'Post',
        body: '<p>коротко</p>',
        excerpt: '',
        isPublished: true,
      },
    ]);

    const res = await svc.getContentGaps({ scopes: ['blog'] });

    expect(prisma.faqItem.findMany).not.toHaveBeenCalled();
    expect(res.scopes).toEqual(['blog']);
    expect(res.summary.faqGaps).toBeNull();
    expect(res.summary.blogGaps).toBe(1);
    expect(res.highlights[0].area).toBe('blog');
  });

  it('getSalesTimeseries summary без series; full — с series', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      {
        day: new Date('2026-08-01T00:00:00.000Z'),
        orders: 2n,
        gross: 1000n,
        refunded: 0n,
      },
    ]);

    const summary = await svc.getSalesTimeseries({
      period: 'custom',
      from: '2026-08-01',
      to: '2026-08-03',
    });

    expect(summary).not.toHaveProperty('series');
    expect(summary.detail).toBe('summary');
    expect(summary.days).toBe(3);
    expect(summary.sparklineRevenue).toEqual([1000, 0, 0]);
    expect(summary.ordersCount).toBe(2);
    expect(summary.topDeltas.length).toBeGreaterThan(0);

    const full = await svc.getSalesTimeseries({
      period: 'custom',
      from: '2026-08-01',
      to: '2026-08-03',
      detail: 'full',
    });

    expect(full.series).toHaveLength(3);
    expect(full.series![0]).toEqual({
      date: '2026-08-01',
      ordersCount: 2,
      revenue: 1000,
    });
  });
});
