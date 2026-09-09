import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AssistantToolsService } from './assistant-tools.service';

describe('AssistantToolsService', () => {
  const dashboard = {
    getOverview: vi.fn(),
    getSalesTimeseries: vi.fn(),
    comparePeriods: vi.fn(),
    getTopProducts: vi.fn(),
    getFunnelLite: vi.fn(),
    getContentGaps: vi.fn(),
  };
  const orders = { list: vi.fn() };
  const catalog = { listProducts: vi.fn() };
  const userGroups = {
    list: vi.fn(),
    one: vi.fn(),
    listCategoryPrices: vi.fn(),
    listVariantPrices: vi.fn(),
    listGroupVisibility: vi.fn(),
    listMembers: vi.fn(),
    listAllVisibilityDetailed: vi.fn(),
  };
  const discounts = { list: vi.fn(), get: vi.fn() };
  const promo = { list: vi.fn(), get: vi.fn() };
  const prisma = {
    $queryRaw: vi.fn(),
    userGroup: { findFirst: vi.fn() },
    promoCode: { findFirst: vi.fn() },
  };
  let svc: AssistantToolsService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new AssistantToolsService(
      dashboard as never,
      orders as never,
      catalog as never,
      userGroups as never,
      discounts as never,
      promo as never,
      prisma as never,
    );
  });

  it('listToolDefs включает commerce tools', () => {
    const names = svc.listToolDefs().map((t) => t.function.name);
    expect(names).toEqual([
      'get_dashboard_overview',
      'list_orders',
      'search_products',
      'list_oos_variants',
      'sales_timeseries',
      'compare_periods',
      'top_products',
      'funnel_lite',
      'content_gaps',
      'list_user_groups',
      'list_discounts',
      'get_discount',
      'list_promo_codes',
      'get_promo_code',
      'list_catalog_visibility',
      'get_user_group',
    ]);
  });

  it('execute неизвестного tool возвращает error', async () => {
    await expect(svc.execute('nope', '{}')).resolves.toEqual({
      error: 'Неизвестный tool: nope',
    });
  });

  it('list_orders маскирует email/телефон', async () => {
    orders.list.mockResolvedValue({
      total: 1,
      page: 1,
      limit: 20,
      items: [
        {
          id: 'o1',
          number: 42,
          status: 'PAID',
          total: 1000,
          refundedAmount: 0,
          createdAt: new Date('2026-01-01'),
          email: 'ivan@example.com',
          phone: '+79001234567',
          customerName: 'Иван',
        },
      ],
    });

    const res = (await svc.execute('list_orders', '{"limit":5}')) as {
      items: Array<{ email: string | null; phone: string | null; customerName: string | null }>;
    };

    expect(orders.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 }),
    );
    expect(res.items[0].email).toBe('iv***@example.com');
    expect(res.items[0].phone).toBe('***4567');
    expect(res.items[0].customerName).toBe('И***');
  });

  it('sales_timeseries / compare_periods / top / funnel / content_gaps делегируют', async () => {
    dashboard.getSalesTimeseries.mockResolvedValue({ detail: 'summary' });
    dashboard.comparePeriods.mockResolvedValue({ delta: {} });
    dashboard.getTopProducts.mockResolvedValue({ items: [] });
    dashboard.getFunnelLite.mockResolvedValue({ totalOrders: 0 });
    dashboard.getContentGaps.mockResolvedValue({ summary: {} });

    await svc.execute('sales_timeseries', '{"period":"month"}');
    await svc.execute(
      'compare_periods',
      '{"periodA":"today","periodB":"month"}',
    );
    await svc.execute('top_products', '{"period":"today","sortBy":"revenue"}');
    await svc.execute('funnel_lite', '{"period":"month"}');
    await svc.execute('content_gaps', '{}', {
      sections: ['blog'],
      isSuperAdmin: false,
    });

    expect(dashboard.getSalesTimeseries).toHaveBeenCalledWith({
      period: 'month',
      from: undefined,
      to: undefined,
      detail: 'summary',
    });
    expect(dashboard.comparePeriods).toHaveBeenCalledWith({
      periodA: 'today',
      fromA: undefined,
      toA: undefined,
      periodB: 'month',
      fromB: undefined,
      toB: undefined,
    });
    expect(dashboard.getTopProducts).toHaveBeenCalledWith(
      expect.objectContaining({ period: 'today', sortBy: 'revenue', limit: 10 }),
    );
    expect(dashboard.getFunnelLite).toHaveBeenCalled();
    expect(dashboard.getContentGaps).toHaveBeenCalledWith({
      scopes: ['blog'],
    });
  });

  it('listToolDefs фильтрует по ACL', () => {
    const names = svc
      .listToolDefs({ sections: ['dashboard', 'catalog'], isSuperAdmin: false })
      .map((t) => t.function.name);
    expect(names).toEqual([
      'get_dashboard_overview',
      'search_products',
      'list_oos_variants',
      'sales_timeseries',
      'compare_periods',
      'top_products',
      'list_catalog_visibility',
    ]);
  });

  it('execute отказывает без ACL на tool', async () => {
    await expect(
      svc.execute('list_orders', '{}', {
        sections: ['dashboard', 'assistant'],
        isSuperAdmin: false,
      }),
    ).resolves.toEqual({ error: 'Нет доступа к этому инструменту' });
    expect(orders.list).not.toHaveBeenCalled();
  });

  it('list_user_groups делегирует UserGroupsAdminService', async () => {
    userGroups.list.mockResolvedValue({
      total: 1,
      page: 1,
      limit: 20,
      items: [
        {
          id: 'g1',
          name: 'Розница',
          slug: 'retail-registered',
          active: true,
          isDefaultGuest: false,
          isDefaultRegistered: true,
          assignable: false,
          allowCatalogDiscounts: true,
          allowPromoCodes: true,
          priceRounding: 'NEAREST',
          counts: { users: 0, variantPrices: 0, categoryPrices: 18, visibilityRules: 0 },
        },
      ],
    });

    const res = (await svc.execute('list_user_groups', '{"q":"retail"}')) as {
      items: Array<{ kind: string; slug: string }>;
    };

    expect(userGroups.list).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'retail', page: 1, limit: 20 }),
    );
    expect(res.items[0].kind).toBe('retail');
    expect(res.items[0].slug).toBe('retail-registered');
  });

  it('get_user_group по slug подгружает include', async () => {
    prisma.userGroup.findFirst.mockResolvedValue({ id: 'g1' });
    userGroups.one.mockResolvedValue({
      id: 'g1',
      name: 'Розница',
      slug: 'retail-registered',
      active: true,
      isDefaultGuest: false,
      isDefaultRegistered: true,
      assignable: false,
      allowCatalogDiscounts: true,
      allowPromoCodes: true,
      priceRounding: 'NEAREST',
      counts: { users: 0, variantPrices: 0, categoryPrices: 1, visibilityRules: 0 },
    });
    userGroups.listCategoryPrices.mockResolvedValue({
      items: [
        {
          categoryId: 'c1',
          categoryName: 'Уход',
          categorySlug: 'uhod',
          type: 'PERCENT_OFF',
          value: 10,
        },
      ],
    });

    const res = (await svc.execute(
      'get_user_group',
      '{"slug":"retail-registered","include":["category_prices"]}',
    )) as { categoryPrices: { items: Array<{ label: string }> } };

    expect(userGroups.one).toHaveBeenCalledWith('g1');
    expect(res.categoryPrices.items[0].label).toBe('−10%');
  });

  it('get_user_group без groupId/slug — error', async () => {
    await expect(svc.execute('get_user_group', '{}')).resolves.toEqual({
      error: 'Укажите groupId или slug группы',
    });
  });

  it('list_discounts live делегирует DiscountsAdminService', async () => {
    discounts.list.mockResolvedValue({
      total: 1,
      page: 1,
      limit: 20,
      items: [
        {
          id: 'd1',
          name: 'Весна',
          scope: 'CATEGORY',
          status: 'RUNNING',
          active: true,
          startsAt: new Date(),
          endsAt: null,
          ruleCount: 1,
        },
      ],
    });

    const res = (await svc.execute('list_discounts', '{"live":true}')) as {
      items: Array<{ status: string }>;
    };
    expect(discounts.list).toHaveBeenCalledWith(
      expect.objectContaining({ live: true }),
    );
    expect(res.items[0].status).toBe('RUNNING');
  });

  it('get_promo_code по code', async () => {
    prisma.promoCode.findFirst.mockResolvedValue({ id: 'p1' });
    promo.get.mockResolvedValue({
      id: 'p1',
      code: 'SALE10',
      type: 'PERCENT',
      value: 10,
      active: true,
      startsAt: null,
      endsAt: null,
      maxUses: null,
      oneShot: false,
      minOrderAmount: null,
      usedCount: 3,
      redemptions: [],
      redemptionsTotal: 0,
    });

    const res = (await svc.execute('get_promo_code', '{"code":"sale10"}')) as {
      promo: { code: string };
    };
    expect(promo.get).toHaveBeenCalledWith('p1', expect.any(Object));
    expect(res.promo.code).toBe('SALE10');
  });

  it('list_catalog_visibility делегирует listAllVisibilityDetailed', async () => {
    userGroups.listAllVisibilityDetailed.mockResolvedValue({
      total: 1,
      page: 1,
      limit: 20,
      items: [
        {
          id: 'v1',
          mode: 'SHOW_ONLY_GROUP',
          targetType: 'PRODUCT',
          targetId: 'prod1',
          targetLabel: 'Крем',
          groupId: 'g1',
          groupName: 'Дилеры',
          groupSlug: 'dealers',
        },
      ],
    });

    const res = (await svc.execute(
      'list_catalog_visibility',
      '{"groupId":"g1"}',
    )) as { items: Array<{ targetLabel: string }> };
    expect(userGroups.listAllVisibilityDetailed).toHaveBeenCalled();
    expect(res.items[0].targetLabel).toBe('Крем');
  });
});
