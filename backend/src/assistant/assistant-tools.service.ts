import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CatalogProductsAdminService } from '../catalog/catalog-products.admin.service';
import { DashboardAdminService } from '../dashboard/dashboard-admin.service';
import { DiscountsAdminService } from '../discounts/discounts-admin.service';
import { OrdersAdminService } from '../orders/orders-admin.service';
import { PromoAdminService } from '../promo/promo.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserGroupsAdminService } from '../user-groups/user-groups-admin.service';
import { staffCanUseAssistantTool, contentGapScopesForStaff } from './assistant-tool-acl';
import type { GptToolDef } from './gptunnel.client';

export type AssistantToolAcl = {
  sections: readonly string[];
  isSuperAdmin: boolean;
};

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function maskEmail(email: string | null | undefined): string | null {
  if (!email?.trim()) return null;
  const [user, domain] = email.trim().split('@');
  if (!domain) return '***';
  const u = user.length <= 2 ? `${user[0] ?? '*'}*` : `${user.slice(0, 2)}***`;
  return `${u}@${domain}`;
}

function maskPhone(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

function periodArgs(args: Record<string, unknown>): {
  period: string;
  from?: string;
  to?: string;
} {
  const period =
    typeof args.period === 'string' && args.period.trim()
      ? args.period.trim()
      : 'today';
  const from = typeof args.from === 'string' ? args.from : undefined;
  const to = typeof args.to === 'string' ? args.to : undefined;
  return { period, from, to };
}

const PERIOD_ENUM = [
  'today',
  'yesterday',
  'last_7',
  'week',
  'month',
  'custom',
] as const;

const USER_GROUP_INCLUDE = [
  'category_prices',
  'variant_prices',
  'visibility',
  'members',
] as const;

type UserGroupInclude = (typeof USER_GROUP_INCLUDE)[number];

function userGroupKind(row: {
  isDefaultGuest: boolean;
  isDefaultRegistered: boolean;
}): 'guest' | 'retail' | 'custom' {
  if (row.isDefaultGuest) return 'guest';
  if (row.isDefaultRegistered) return 'retail';
  return 'custom';
}

function categoryPriceLabel(type: string, value: number): string {
  switch (type) {
    case 'PERCENT_OFF':
      return `−${value}%`;
    case 'FIXED_OFF':
      return `−${value} ₽`;
    case 'FIXED_PRICE':
      return `${value} ₽`;
    default:
      return `${type}: ${value}`;
  }
}

const PERIOD_PROPS = {
  period: {
    type: 'string',
    enum: [...PERIOD_ENUM],
    description:
      'today | yesterday | last_7 | week (пн–сегодня) | month | custom. По умолчанию today',
  },
  from: { type: 'string', description: 'YYYY-MM-DD для custom' },
  to: { type: 'string', description: 'YYYY-MM-DD для custom' },
} as const;

@Injectable()
export class AssistantToolsService {
  constructor(
    private readonly dashboard: DashboardAdminService,
    private readonly orders: OrdersAdminService,
    private readonly catalog: CatalogProductsAdminService,
    private readonly userGroups: UserGroupsAdminService,
    private readonly discounts: DiscountsAdminService,
    private readonly promo: PromoAdminService,
    private readonly prisma: PrismaService,
  ) {}

  /** OpenAI-compatible tool schemas (read-only). Filtered by staff sections when acl given. */
  listToolDefs(acl?: AssistantToolAcl): GptToolDef[] {
    const defs: GptToolDef[] = [
      {
        type: 'function',
        function: {
          name: 'get_dashboard_overview',
          description:
            'KPI дашборда: заказы, выручка, средний чек, новые клиенты, топ товаров. Период: today | yesterday | last_7 | week | month | custom (from/to YYYY-MM-DD, Москва). Для сравнения двух периодов используй compare_periods.',
          parameters: {
            type: 'object',
            properties: { ...PERIOD_PROPS },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_orders',
          description:
            'Список заказов админки (чтение). Фильтры: q (номер/email/телефон/имя), status, page, limit (до 50). Персональные данные маскируются.',
          parameters: {
            type: 'object',
            properties: {
              q: { type: 'string', description: 'Поиск по номеру / контактам' },
              status: {
                type: 'string',
                description: 'Статус заказа, если известен (как в админке)',
              },
              page: { type: 'integer', description: 'Страница, с 1' },
              limit: { type: 'integer', description: 'Размер страницы, 1–50' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_products',
          description:
            'Поиск товаров каталога: имя / SKU. visibility: all | catalog | hidden. Возвращает stockTotal, цену, ссылку в админку.',
          parameters: {
            type: 'object',
            properties: {
              q: { type: 'string', description: 'Строка поиска' },
              visibility: {
                type: 'string',
                enum: ['all', 'catalog', 'hidden'],
                description: 'По умолчанию all',
              },
              page: { type: 'integer' },
              limit: { type: 'integer', description: '1–50' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_oos_variants',
          description:
            'Варианты с нулевым или отрицательным доступным стоком (stock − reserve ≤ 0), только active товар/вариант. Для вопросов про out-of-stock / нет в наличии.',
          parameters: {
            type: 'object',
            properties: {
              limit: {
                type: 'integer',
                description: 'Сколько позиций вернуть, 1–100, по умолчанию 30',
              },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'sales_timeseries',
          description:
            'Динамика продаж по дням (Москва). По умолчанию detail=summary: итоги + sparkline + best/worst + top deltas (без полного series). detail=full — все точки. Период до 90 дней.',
          parameters: {
            type: 'object',
            properties: {
              ...PERIOD_PROPS,
              detail: {
                type: 'string',
                enum: ['summary', 'full'],
                description: 'По умолчанию summary',
              },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'compare_periods',
          description:
            'Сравнить два периода одним вызовом: KPI a vs b и delta (a−b, %). Для «сравни сегодня с месяцем» — periodA=today, periodB=month. Не вызывай два overview подряд.',
          parameters: {
            type: 'object',
            properties: {
              periodA: {
                type: 'string',
                enum: [...PERIOD_ENUM],
                description: 'По умолчанию today',
              },
              fromA: { type: 'string' },
              toA: { type: 'string' },
              periodB: {
                type: 'string',
                enum: [...PERIOD_ENUM],
                description: 'По умолчанию month',
              },
              fromB: { type: 'string' },
              toB: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'top_products',
          description:
            'Топ товаров/SKU за период: sortBy qty (шт.) или revenue (выручка строки). limit до 30.',
          parameters: {
            type: 'object',
            properties: {
              ...PERIOD_PROPS,
              sortBy: {
                type: 'string',
                enum: ['qty', 'revenue'],
                description: 'По умолчанию qty',
              },
              limit: { type: 'integer', description: '1–30, по умолчанию 10' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'funnel_lite',
          description:
            'Воронка заказов по статусам за период (все статусы): NEW, AWAITING_PAYMENT, PAID, PACKING, SHIPPED, DELIVERED, CANCELLED, REFUNDED. Доли, cancelRate, paidRate.',
          parameters: {
            type: 'object',
            properties: { ...PERIOD_PROPS },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'content_gaps',
          description:
            'Пробелы контента (summary + до 8 highlights). Области режутся по ACL staff: settings→FAQ/страницы/hero, blog→посты. Без полных массивов.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_user_groups',
          description:
            'Список групп пользователей (цены, видимость, промо): тип guest/retail/custom, флаги allowCatalogDiscounts/allowPromoCodes, счётчики правил. Для «какая группа у розницы» — q=retail или смотри kind=retail.',
          parameters: {
            type: 'object',
            properties: {
              q: { type: 'string', description: 'Поиск по name/slug' },
              active: {
                type: 'boolean',
                description: 'true — только активные, false — выключенные',
              },
              page: { type: 'integer', description: 'Страница, с 1' },
              limit: { type: 'integer', description: '1–50, по умолчанию 20' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_discounts',
          description:
            'Кампании Discount (каталожные акции): scope, статус RUNNING/SCHEDULED/…, даты, число правил. live=true — только идущие сейчас.',
          parameters: {
            type: 'object',
            properties: {
              q: { type: 'string', description: 'Поиск по названию' },
              live: {
                type: 'boolean',
                description: 'true — только активные кампании в текущий момент',
              },
              active: {
                type: 'boolean',
                description: 'Флаг active (если live не задан)',
              },
              page: { type: 'integer' },
              limit: { type: 'integer', description: '1–50' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_discount',
          description: 'Детали кампании Discount по discountId: scope, категории/товары, правила награды.',
          parameters: {
            type: 'object',
            properties: {
              discountId: { type: 'string', description: 'UUID кампании' },
            },
            required: ['discountId'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_promo_codes',
          description:
            'Промокоды checkout: тип PERCENT/FIXED, active, usedCount. Поиск по коду (q).',
          parameters: {
            type: 'object',
            properties: {
              q: { type: 'string', description: 'Поиск по коду' },
              active: { type: 'boolean' },
              page: { type: 'integer' },
              limit: { type: 'integer', description: '1–50' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_promo_code',
          description:
            'Детали промокода по promoCodeId или code. includeRedemptions=true — последние применения (email маскируется).',
          parameters: {
            type: 'object',
            properties: {
              promoCodeId: { type: 'string' },
              code: { type: 'string', description: 'Код промо, напр. SALE10' },
              includeRedemptions: { type: 'boolean' },
              redemptionsLimit: { type: 'integer', description: '1–20, по умолчанию 10' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_catalog_visibility',
          description:
            'Правила видимости каталога (global): mode, targetType PRODUCT/CATEGORY/VARIANT, groupId. Для одной группы — также get_user_group include=[visibility].',
          parameters: {
            type: 'object',
            properties: {
              mode: {
                type: 'string',
                enum: [
                  'HIDE_FROM_GUESTS',
                  'HIDE_FROM_REGISTERED',
                  'HIDE_FROM_GROUP',
                  'SHOW_ONLY_REGISTERED',
                  'SHOW_ONLY_GROUP',
                ],
              },
              targetType: {
                type: 'string',
                enum: ['PRODUCT', 'CATEGORY', 'VARIANT'],
              },
              groupId: { type: 'string' },
              page: { type: 'integer' },
              limit: { type: 'integer', description: '1–50' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_user_group',
          description:
            'Детали одной группы по groupId или slug. include: category_prices | variant_prices | visibility | members (можно несколько). Без include — только профиль и счётчики.',
          parameters: {
            type: 'object',
            properties: {
              groupId: { type: 'string', description: 'UUID группы' },
              slug: {
                type: 'string',
                description: 'slug группы, напр. retail-registered или guests',
              },
              include: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: [...USER_GROUP_INCLUDE],
                },
                description: 'Доп. блоки; variant_prices/members — paginated',
              },
              variantPricesQ: {
                type: 'string',
                description: 'Поиск SKU/товара (только с include variant_prices)',
              },
              variantPricesLimit: {
                type: 'integer',
                description: 'SKU-цен, 1–30, по умолчанию 15',
              },
              membersLimit: {
                type: 'integer',
                description: 'Участников, 1–30, по умолчанию 15',
              },
            },
            additionalProperties: false,
          },
        },
      },
    ];
    if (!acl) return defs;
    return defs.filter((d) =>
      staffCanUseAssistantTool(d.function.name, acl.sections, acl.isSuperAdmin),
    );
  }

  async execute(
    name: string,
    argsJson: string,
    acl?: AssistantToolAcl,
  ): Promise<unknown> {
    if (
      acl &&
      !staffCanUseAssistantTool(name, acl.sections, acl.isSuperAdmin)
    ) {
      return { error: 'Нет доступа к этому инструменту' };
    }

    let args: Record<string, unknown> = {};
    try {
      args = argsJson?.trim() ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
    } catch {
      return { error: 'Некорректный JSON аргументов tool' };
    }

    try {
      return await this.executeKnown(name, args, acl);
    } catch (e) {
      if (e instanceof BadRequestException) {
        const res = e.getResponse();
        const msg =
          typeof res === 'string'
            ? res
            : Array.isArray((res as { message?: unknown }).message)
              ? ((res as { message: string[] }).message).join('; ')
              : String(
                  (res as { message?: unknown }).message ??
                    (e instanceof Error ? e.message : 'Некорректный запрос'),
                );
        return { error: msg };
      }
      throw e;
    }
  }

  private async executeKnown(
    name: string,
    args: Record<string, unknown>,
    acl?: AssistantToolAcl,
  ): Promise<unknown> {
    if (name === 'get_dashboard_overview') {
      const overview = await this.dashboard.getOverview(periodArgs(args));
      return {
        ...overview,
        adminLinks: {
          dashboard: '/admin',
          orders: '/admin/orders',
        },
      };
    }

    if (name === 'list_orders') {
      const page = clampInt(args.page, 1, 1, 100);
      const limit = clampInt(args.limit, 20, 1, 50);
      const q = typeof args.q === 'string' ? args.q : undefined;
      const status = typeof args.status === 'string' ? args.status : undefined;
      const result = await this.orders.list({ q, status, page, limit });
      return {
        total: result.total,
        page: result.page,
        limit: result.limit,
        adminLink: '/admin/orders',
        items: result.items.map((o) => ({
          id: o.id,
          number: o.number,
          status: o.status,
          total: o.total,
          refundedAmount: o.refundedAmount,
          createdAt: o.createdAt,
          email: maskEmail(o.email),
          phone: maskPhone(o.phone),
          customerName: o.customerName
            ? `${o.customerName.trim().slice(0, 1)}***`
            : null,
          adminLink: `/admin/orders/${o.id}`,
        })),
      };
    }

    if (name === 'search_products') {
      const page = clampInt(args.page, 1, 1, 100);
      const limit = clampInt(args.limit, 20, 1, 50);
      const q = typeof args.q === 'string' ? args.q : undefined;
      const visibilityRaw =
        typeof args.visibility === 'string' ? args.visibility.trim() : 'all';
      const visibility =
        visibilityRaw === 'catalog' || visibilityRaw === 'hidden'
          ? visibilityRaw
          : 'all';
      const result = await this.catalog.listProducts({
        q,
        page,
        limit,
        visibility,
      });
      return {
        total: result.total,
        page: result.page,
        limit: result.limit,
        adminLink: '/admin/catalog/products',
        items: result.items.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          active: p.active,
          primarySku: p.primarySku,
          minPrice: p.minPrice,
          stockTotal: p.stockTotal,
          category: p.category?.name ?? null,
          adminLink: `/admin/catalog/products/${p.id}`,
        })),
      };
    }

    if (name === 'list_oos_variants') {
      const limit = clampInt(args.limit, 30, 1, 100);
      const rows = await this.prisma.$queryRaw<
        Array<{
          id: string;
          sku: string;
          name: string;
          stock: number;
          stockReserve: number;
          productId: string;
          productName: string;
          productSlug: string;
        }>
      >`
        SELECT
          v.id,
          v.sku,
          v.name,
          v.stock,
          v."stockReserve",
          p.id AS "productId",
          p.name AS "productName",
          p.slug AS "productSlug"
        FROM "ProductVariant" v
        INNER JOIN "Product" p ON p.id = v."productId"
        WHERE v.active = true
          AND p.active = true
          AND (v.stock - v."stockReserve") <= 0
        ORDER BY v."updatedAt" DESC
        LIMIT ${limit}
      `;
      const countRows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "ProductVariant" v
        INNER JOIN "Product" p ON p.id = v."productId"
        WHERE v.active = true
          AND p.active = true
          AND (v.stock - v."stockReserve") <= 0
      `;
      const total = Number(countRows[0]?.count ?? 0);
      return {
        total,
        limit,
        adminLink: '/admin/catalog/products',
        items: rows.map((r) => ({
          variantId: r.id,
          sku: r.sku,
          variantName: r.name,
          stock: r.stock,
          stockReserve: r.stockReserve,
          available: Math.max(0, r.stock - r.stockReserve),
          productId: r.productId,
          productName: r.productName,
          productSlug: r.productSlug,
          adminLink: `/admin/catalog/products/${r.productId}`,
        })),
      };
    }

    if (name === 'sales_timeseries') {
      const detail =
        typeof args.detail === 'string' && args.detail === 'full'
          ? 'full'
          : 'summary';
      return this.dashboard.getSalesTimeseries({
        ...periodArgs(args),
        detail,
      });
    }

    if (name === 'compare_periods') {
      const periodA =
        typeof args.periodA === 'string' && args.periodA.trim()
          ? args.periodA.trim()
          : 'today';
      const periodB =
        typeof args.periodB === 'string' && args.periodB.trim()
          ? args.periodB.trim()
          : 'month';
      return this.dashboard.comparePeriods({
        periodA,
        fromA: typeof args.fromA === 'string' ? args.fromA : undefined,
        toA: typeof args.toA === 'string' ? args.toA : undefined,
        periodB,
        fromB: typeof args.fromB === 'string' ? args.fromB : undefined,
        toB: typeof args.toB === 'string' ? args.toB : undefined,
      });
    }

    if (name === 'top_products') {
      const sortBy =
        typeof args.sortBy === 'string' && args.sortBy === 'revenue'
          ? 'revenue'
          : 'qty';
      const limit = clampInt(args.limit, 10, 1, 30);
      return this.dashboard.getTopProducts({
        ...periodArgs(args),
        sortBy,
        limit,
      });
    }

    if (name === 'funnel_lite') {
      return this.dashboard.getFunnelLite(periodArgs(args));
    }

    if (name === 'content_gaps') {
      const scopes = acl
        ? contentGapScopesForStaff(acl.sections, acl.isSuperAdmin)
        : undefined;
      if (scopes && scopes.length === 0) {
        return { error: 'Нет доступа к разделам контента' };
      }
      return this.dashboard.getContentGaps({ scopes });
    }

    if (name === 'list_user_groups') {
      const page = clampInt(args.page, 1, 1, 100);
      const limit = clampInt(args.limit, 20, 1, 50);
      const q = typeof args.q === 'string' ? args.q : undefined;
      const active =
        typeof args.active === 'boolean' ? args.active : undefined;
      const result = await this.userGroups.list({ q, active, page, limit });
      return {
        total: result.total,
        page: result.page,
        limit: result.limit,
        adminLink: '/admin/settings/user-groups',
        items: result.items.map((g) => ({
          id: g.id,
          name: g.name,
          slug: g.slug,
          kind: userGroupKind(g),
          active: g.active,
          assignable: g.assignable,
          allowCatalogDiscounts: g.allowCatalogDiscounts,
          allowPromoCodes: g.allowPromoCodes,
          priceRounding: g.priceRounding,
          counts: g.counts,
          adminLink: `/admin/settings/user-groups/${g.id}`,
        })),
      };
    }

    if (name === 'get_user_group') {
      return this.getUserGroupForAssistant(args);
    }

    if (name === 'list_discounts') {
      const page = clampInt(args.page, 1, 1, 100);
      const limit = clampInt(args.limit, 20, 1, 50);
      const q = typeof args.q === 'string' ? args.q : undefined;
      const live = typeof args.live === 'boolean' ? args.live : undefined;
      const active = typeof args.active === 'boolean' ? args.active : undefined;
      const result = await this.discounts.list({ q, live, active, page, limit });
      return {
        total: result.total,
        page: result.page,
        limit: result.limit,
        adminLink: '/admin/discounts',
        items: result.items.map((d) => ({
          id: d.id,
          name: d.name,
          scope: d.scope,
          status: d.status,
          active: d.active,
          startsAt: d.startsAt,
          endsAt: d.endsAt,
          ruleCount: d.ruleCount,
          adminLink: `/admin/discounts/${d.id}`,
        })),
      };
    }

    if (name === 'get_discount') {
      const discountId =
        typeof args.discountId === 'string' ? args.discountId.trim() : '';
      if (!discountId) return { error: 'Укажите discountId' };
      try {
        const d = await this.discounts.get(discountId);
        return {
          discount: {
            id: d.id,
            name: d.name,
            description: d.description,
            scope: d.scope,
            status: d.status,
            active: d.active,
            startsAt: d.startsAt,
            endsAt: d.endsAt,
            categories: d.categories,
            products: d.products.map((p) => ({
              ...p,
              adminLink: `/admin/catalog/products/${p.id}`,
            })),
            rules: d.rules.map((r) => ({
              id: r.id,
              name: r.name,
              rewardType: r.rewardType,
              rewardValue: r.rewardValue,
              description: r.description,
            })),
          },
          adminLink: `/admin/discounts/${d.id}`,
        };
      } catch (e) {
        if (e instanceof NotFoundException) return { error: 'Кампания не найдена' };
        throw e;
      }
    }

    if (name === 'list_promo_codes') {
      const page = clampInt(args.page, 1, 1, 100);
      const limit = clampInt(args.limit, 20, 1, 50);
      const q = typeof args.q === 'string' ? args.q : undefined;
      const active = typeof args.active === 'boolean' ? args.active : undefined;
      const result = await this.promo.list({ q, active, page, limit });
      return {
        total: result.total,
        page: result.page,
        limit: result.limit,
        adminLink: '/admin/promo',
        items: result.items.map((p) => ({
          id: p.id,
          code: p.code,
          type: p.type,
          value: p.value,
          active: p.active,
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          maxUses: p.maxUses,
          oneShot: p.oneShot,
          minOrderAmount: p.minOrderAmount,
          usedCount: p.usedCount,
          adminLink: `/admin/promo/${p.id}`,
        })),
      };
    }

    if (name === 'get_promo_code') {
      return this.getPromoCodeForAssistant(args);
    }

    if (name === 'list_catalog_visibility') {
      const page = clampInt(args.page, 1, 1, 100);
      const limit = clampInt(args.limit, 20, 1, 50);
      const mode = typeof args.mode === 'string' ? args.mode : undefined;
      const targetType =
        typeof args.targetType === 'string' ? args.targetType : undefined;
      const groupId = typeof args.groupId === 'string' ? args.groupId.trim() : undefined;
      const result = await this.userGroups.listAllVisibilityDetailed({
        mode: mode as never,
        targetType,
        groupId,
        page,
        limit,
      });
      return {
        total: result.total,
        page: result.page,
        limit: result.limit,
        adminLink: '/admin/settings/user-groups',
        items: result.items.map((r) => ({
          id: r.id,
          mode: r.mode,
          targetType: r.targetType,
          targetId: r.targetId,
          targetLabel: r.targetLabel,
          groupId: r.groupId,
          groupName: r.groupName,
          groupSlug: r.groupSlug,
          groupAdminLink: r.groupId
            ? `/admin/settings/user-groups/${r.groupId}?tab=visibility`
            : null,
        })),
      };
    }

    return { error: `Неизвестный tool: ${name}` };
  }

  private async resolvePromoCodeId(args: Record<string, unknown>): Promise<string | null> {
    const promoCodeId =
      typeof args.promoCodeId === 'string' ? args.promoCodeId.trim() : '';
    if (promoCodeId) return promoCodeId;
    const codeRaw = typeof args.code === 'string' ? args.code.trim() : '';
    if (!codeRaw) return null;
    const row = await this.prisma.promoCode.findFirst({
      where: { code: { equals: codeRaw, mode: 'insensitive' } },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  private async getPromoCodeForAssistant(args: Record<string, unknown>): Promise<unknown> {
    const promoCodeId = await this.resolvePromoCodeId(args);
    if (!promoCodeId) {
      return { error: 'Укажите promoCodeId или code' };
    }
    const includeRedemptions = args.includeRedemptions === true;
    const redemptionsLimit = clampInt(args.redemptionsLimit, 10, 1, 20);

    try {
      const row = await this.promo.get(promoCodeId, {
        redemptionsPage: 1,
        redemptionsLimit: includeRedemptions ? redemptionsLimit : 0,
      });
      return {
        promo: {
          id: row.id,
          code: row.code,
          type: row.type,
          value: row.value,
          active: row.active,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          maxUses: row.maxUses,
          oneShot: row.oneShot,
          minOrderAmount: row.minOrderAmount,
          usedCount: row.usedCount,
          redemptions: includeRedemptions
            ? row.redemptions.map((r) => ({
                id: r.id,
                orderId: r.orderId,
                orderNumber: r.order?.number ?? null,
                discountAmount: r.discountAmount,
                email: maskEmail(r.email),
                createdAt: r.createdAt,
              }))
            : undefined,
          redemptionsTotal: includeRedemptions ? row.redemptionsTotal : undefined,
        },
        adminLink: `/admin/promo/${row.id}`,
      };
    } catch (e) {
      if (e instanceof NotFoundException) return { error: 'Промокод не найден' };
      throw e;
    }
  }

  private parseUserGroupInclude(raw: unknown): UserGroupInclude[] {
    if (!Array.isArray(raw)) return [];
    const set = new Set<UserGroupInclude>();
    for (const v of raw) {
      if (typeof v === 'string' && (USER_GROUP_INCLUDE as readonly string[]).includes(v)) {
        set.add(v as UserGroupInclude);
      }
    }
    return [...set];
  }

  private async resolveUserGroupId(args: Record<string, unknown>): Promise<string | null> {
    const groupId = typeof args.groupId === 'string' ? args.groupId.trim() : '';
    if (groupId) return groupId;
    const slug = typeof args.slug === 'string' ? args.slug.trim().toLowerCase() : '';
    if (!slug) return null;
    const row = await this.prisma.userGroup.findFirst({
      where: { slug },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  private async getUserGroupForAssistant(args: Record<string, unknown>): Promise<unknown> {
    const groupId = await this.resolveUserGroupId(args);
    if (!groupId) {
      return { error: 'Укажите groupId или slug группы' };
    }

    let group;
    try {
      group = await this.userGroups.one(groupId);
    } catch (e) {
      if (e instanceof NotFoundException) {
        return { error: 'Группа не найдена' };
      }
      throw e;
    }

    const include = this.parseUserGroupInclude(args.include);
    const out: Record<string, unknown> = {
      group: {
        id: group.id,
        name: group.name,
        slug: group.slug,
        kind: userGroupKind(group),
        active: group.active,
        assignable: group.assignable,
        allowCatalogDiscounts: group.allowCatalogDiscounts,
        allowPromoCodes: group.allowPromoCodes,
        priceRounding: group.priceRounding,
        counts: group.counts,
        membersLabel:
          group.isDefaultGuest
            ? 'Авто · все гости'
            : group.isDefaultRegistered
              ? 'Авто · все зарег. без группы'
              : `${group.counts.users} участников`,
      },
      adminLinks: {
        group: `/admin/settings/user-groups/${group.id}`,
        prices: `/admin/settings/user-groups/${group.id}?tab=prices`,
        visibility: `/admin/settings/user-groups/${group.id}?tab=visibility`,
        members: group.assignable
          ? `/admin/settings/user-groups/${group.id}?tab=members`
          : null,
      },
    };

    if (include.includes('category_prices')) {
      const cat = await this.userGroups.listCategoryPrices(groupId);
      out.categoryPrices = {
        total: cat.items.length,
        items: cat.items.map((r) => ({
          categoryId: r.categoryId,
          categoryName: r.categoryName,
          categorySlug: r.categorySlug,
          type: r.type,
          value: r.value,
          label: categoryPriceLabel(r.type, r.value),
        })),
      };
    }

    if (include.includes('variant_prices')) {
      const q =
        typeof args.variantPricesQ === 'string' ? args.variantPricesQ : undefined;
      const limit = clampInt(args.variantPricesLimit, 15, 1, 30);
      const sku = await this.userGroups.listVariantPrices(groupId, {
        q,
        page: 1,
        limit,
      });
      out.variantPrices = {
        total: sku.total,
        page: sku.page,
        limit: sku.limit,
        items: sku.items.map((r) => ({
          variantId: r.variantId,
          sku: r.sku,
          variantName: r.variantName,
          productId: r.productId,
          productName: r.productName,
          basePrice: r.basePrice,
          groupPrice: r.price,
          adminLink: `/admin/catalog/products/${r.productId}`,
        })),
      };
    }

    if (include.includes('visibility')) {
      const vis = await this.userGroups.listGroupVisibility(groupId);
      out.visibilityRules = {
        total: vis.items.length,
        items: vis.items.map((r) => ({
          id: r.id,
          mode: r.mode,
          targetType: r.targetType,
          targetId: r.targetId,
          targetLabel: r.targetLabel,
        })),
      };
    }

    if (include.includes('members')) {
      if (!group.assignable) {
        out.members = {
          assignable: false,
          note: 'Системная группа — участники назначаются автоматически',
          total: group.counts.users,
        };
      } else {
        const limit = clampInt(args.membersLimit, 15, 1, 30);
        const members = await this.userGroups.listMembers(groupId, {
          page: 1,
          limit,
        });
        out.members = {
          assignable: true,
          total: members.total,
          page: members.page,
          limit: members.limit,
          items: members.items.map((u) => ({
            id: u.id,
            email: maskEmail(u.email),
            displayName: u.displayName
              ? `${u.displayName.trim().slice(0, 1)}***`
              : null,
            createdAt: u.createdAt,
          })),
        };
      }
    }

    return out;
  }
}
