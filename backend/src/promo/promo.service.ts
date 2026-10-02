import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DiscountScope, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommerceContextService } from '../user-groups/commerce-context.service';
import { CatalogPublicService } from '../catalog/catalog.public.service';
import { dedupeIdsPreserveOrder } from '../catalog/catalog-admin.helpers';
import { ADMIN_LIST_MAX_LIMIT } from '../catalog/catalog.constants';
import type { CreatePromoCodeDto, PromoType, UpdatePromoCodeDto } from './dto/promo.dto';
import { PROMO_TYPES } from './dto/promo.dto';
import { promoConsumingRedemptionWhere } from './promo-redemption.util';

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function normalizeEmail(raw?: string | null): string | null {
  const t = raw?.trim().toLowerCase();
  return t || null;
}

function parseOptionalDate(raw: string | null | undefined): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || (typeof raw === 'string' && !raw.trim())) return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Некорректная дата');
  return d;
}

function parseOptionalInt(raw: number | null | undefined): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) throw new BadRequestException('Ожидается целое ≥ 1');
  return n;
}

function assertReward(type: PromoType, value: number) {
  if (!Number.isInteger(value) || value < 1) {
    throw new BadRequestException('Значение скидки: целое число ≥ 1');
  }
  if (type === 'PERCENT' && value > 100) {
    throw new BadRequestException('PERCENT: максимум 100');
  }
}

export function parsePromoType(raw: string): PromoType {
  if ((PROMO_TYPES as readonly string[]).includes(raw)) return raw as PromoType;
  throw new BadRequestException('Некорректный тип промокода');
}

/** PERCENT / FIXED only — unknown types reject (не fallback на FIXED). */
export function computePromoDiscount(type: string, value: number, subtotal: number): number {
  const base = Math.max(0, Math.floor(subtotal));
  if (base <= 0) return 0;
  const t = parsePromoType(type);
  if (t === 'PERCENT') {
    return Math.min(base, Math.floor((base * value) / 100));
  }
  return Math.min(base, value);
}

export type PromoIdentity = {
  email?: string | null;
  userId?: string | null;
  guestId?: string | null;
};

export type PromoScopeLine = {
  productId: string;
  categoryId: string;
  /** Сумма строки (price × qty), ₽ */
  amount: number;
};

export type PromoApplyResult = {
  promoCodeId: string;
  code: string;
  type: string;
  value: number;
  discountAmount: number;
  subtotal: number;
  /** База скидки (eligible по scope) */
  eligibleSubtotal: number;
  total: number;
  maxUses: number | null;
  oneShot: boolean;
  minOrderAmount: number | null;
  usedCount: number;
  scope: DiscountScope | null;
};

const promoScopeInclude = {
  categories: {
    include: {
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
          parentId: true,
          parent: { select: { id: true, name: true } },
        },
      },
    },
  },
  products: {
    include: {
      product: { select: { id: true, name: true, slug: true } },
    },
  },
} satisfies Prisma.PromoCodeInclude;

type PromoRowWithScope = Prisma.PromoCodeGetPayload<{ include: typeof promoScopeInclude }>;

export function eligiblePromoSubtotal(
  scope: DiscountScope | null | undefined,
  categoryIds: string[],
  productIds: string[],
  cartSubtotal: number,
  lines?: PromoScopeLine[] | null,
): number {
  if (!scope) return Math.max(0, Math.floor(cartSubtotal));
  if (!lines?.length) {
    throw new BadRequestException(
      'Для этого промокода нужна корзина с товарами из области действия',
    );
  }
  const catSet = new Set(categoryIds);
  const prodSet = new Set(productIds);
  let sum = 0;
  for (const line of lines) {
    const inScope =
      scope === DiscountScope.PRODUCTS
        ? prodSet.has(line.productId)
        : catSet.has(line.categoryId);
    if (inScope) sum += Math.max(0, Math.floor(line.amount));
  }
  if (sum <= 0) {
    throw new BadRequestException('Промокод не применим к товарам в корзине');
  }
  return sum;
}

@Injectable()
export class PromoAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(opts: { q?: string; page?: number; limit?: number; active?: boolean } = {}) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(ADMIN_LIST_MAX_LIMIT, Math.max(1, opts.limit ?? 20));
    const where: Prisma.PromoCodeWhereInput = {};
    const q = opts.q?.trim();
    if (q) {
      where.code = { contains: q, mode: 'insensitive' };
    }
    if (opts.active !== undefined) where.active = opts.active;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.promoCode.count({ where }),
      this.prisma.promoCode.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: {
            select: {
              redemptions: { where: promoConsumingRedemptionWhere },
            },
          },
        },
      }),
    ]);
    return {
      items: rows.map(({ _count, ...r }) => ({
        ...r,
        usedCount: _count.redemptions,
      })),
      total,
      page,
      limit,
    };
  }

  async get(id: string, opts: { redemptionsPage?: number; redemptionsLimit?: number } = {}) {
    const redemptionsPage = Math.max(1, opts.redemptionsPage ?? 1);
    const redemptionsLimit = Math.min(
      ADMIN_LIST_MAX_LIMIT,
      Math.max(1, opts.redemptionsLimit ?? 20),
    );

    const row = await this.prisma.promoCode.findUnique({
      where: { id },
      include: {
        ...promoScopeInclude,
        _count: {
          select: {
            redemptions: { where: promoConsumingRedemptionWhere },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Промокод не найден');

    const redemptionsWhere: Prisma.PromoCodeRedemptionWhereInput = { promoCodeId: id };
    const [redemptionsTotal, redemptions] = await this.prisma.$transaction([
      this.prisma.promoCodeRedemption.count({ where: redemptionsWhere }),
      this.prisma.promoCodeRedemption.findMany({
        where: redemptionsWhere,
        orderBy: { createdAt: 'desc' },
        skip: (redemptionsPage - 1) * redemptionsLimit,
        take: redemptionsLimit,
        select: {
          id: true,
          orderId: true,
          code: true,
          discountAmount: true,
          email: true,
          userId: true,
          guestId: true,
          createdAt: true,
          order: { select: { number: true, total: true, status: true } },
        },
      }),
    ]);

    const { _count, ...rest } = row;
    return {
      ...this.serializeScope(rest),
      usedCount: _count.redemptions,
      redemptions,
      redemptionsTotal,
      redemptionsPage,
      redemptionsLimit,
    };
  }

  async create(dto: CreatePromoCodeDto) {
    const code = normalizeCode(dto.code);
    if (!code) throw new BadRequestException('Укажите код');
    assertReward(dto.type, dto.value);
    const startsAt = parseOptionalDate(dto.startsAt) ?? null;
    const endsAt = parseOptionalDate(dto.endsAt) ?? null;
    if (startsAt && endsAt && endsAt < startsAt) {
      throw new BadRequestException('Дата окончания раньше начала');
    }
    const prepared = await this.prepareScope(dto.scope ?? null, dto.categoryIds, dto.productIds);
    try {
      const row = await this.prisma.promoCode.create({
        data: {
          code,
          type: dto.type,
          value: dto.value,
          active: dto.active ?? true,
          startsAt,
          endsAt,
          maxUses: parseOptionalInt(dto.maxUses) ?? null,
          oneShot: dto.oneShot ?? false,
          minOrderAmount: parseOptionalInt(dto.minOrderAmount) ?? null,
          scope: prepared.scope,
          categories:
            prepared.scope === DiscountScope.CATEGORY
              ? { create: prepared.categoryIds.map((categoryId) => ({ categoryId })) }
              : undefined,
          products:
            prepared.scope === DiscountScope.PRODUCTS
              ? { create: prepared.productIds.map((productId) => ({ productId })) }
              : undefined,
        },
        include: promoScopeInclude,
      });
      return this.serializeScope(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('Такой код уже есть');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdatePromoCodeDto) {
    const existing = await this.prisma.promoCode.findUnique({
      where: { id },
      include: {
        categories: { select: { categoryId: true } },
        products: { select: { productId: true } },
      },
    });
    if (!existing) throw new NotFoundException('Промокод не найден');

    const type = parsePromoType(dto.type ?? existing.type);
    const value = dto.value ?? existing.value;
    assertReward(type, value);

    const nextStarts =
      dto.startsAt !== undefined ? (parseOptionalDate(dto.startsAt) ?? null) : existing.startsAt;
    const nextEnds =
      dto.endsAt !== undefined ? (parseOptionalDate(dto.endsAt) ?? null) : existing.endsAt;
    if (nextStarts && nextEnds && nextEnds < nextStarts) {
      throw new BadRequestException('Дата окончания раньше начала');
    }

    const scopeTouched =
      dto.scope !== undefined || dto.categoryIds !== undefined || dto.productIds !== undefined;
    const nextScope = dto.scope !== undefined ? dto.scope : existing.scope;
    const nextCategoryIds =
      dto.categoryIds !== undefined
        ? dto.categoryIds
        : existing.categories.map((c) => c.categoryId);
    const nextProductIds =
      dto.productIds !== undefined
        ? dto.productIds
        : existing.products.map((p) => p.productId);
    const prepared = scopeTouched
      ? await this.prepareScope(nextScope, nextCategoryIds, nextProductIds)
      : null;

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.promoCode.update({
          where: { id },
          data: {
            ...(dto.code !== undefined ? { code: normalizeCode(dto.code) } : {}),
            ...(dto.type !== undefined ? { type: dto.type } : {}),
            ...(dto.value !== undefined ? { value: dto.value } : {}),
            ...(dto.active !== undefined ? { active: dto.active } : {}),
            ...(dto.startsAt !== undefined
              ? { startsAt: parseOptionalDate(dto.startsAt) ?? null }
              : {}),
            ...(dto.endsAt !== undefined
              ? { endsAt: parseOptionalDate(dto.endsAt) ?? null }
              : {}),
            ...(dto.maxUses !== undefined
              ? { maxUses: parseOptionalInt(dto.maxUses) ?? null }
              : {}),
            ...(dto.oneShot !== undefined ? { oneShot: dto.oneShot } : {}),
            ...(dto.minOrderAmount !== undefined
              ? { minOrderAmount: parseOptionalInt(dto.minOrderAmount) ?? null }
              : {}),
            ...(prepared ? { scope: prepared.scope } : {}),
          },
        });

        if (prepared) {
          await tx.promoCodeCategory.deleteMany({ where: { promoCodeId: id } });
          await tx.promoCodeProduct.deleteMany({ where: { promoCodeId: id } });
          if (prepared.scope === DiscountScope.CATEGORY && prepared.categoryIds.length) {
            await tx.promoCodeCategory.createMany({
              data: prepared.categoryIds.map((categoryId) => ({ promoCodeId: id, categoryId })),
            });
          }
          if (prepared.scope === DiscountScope.PRODUCTS && prepared.productIds.length) {
            await tx.promoCodeProduct.createMany({
              data: prepared.productIds.map((productId) => ({ promoCodeId: id, productId })),
            });
          }
        }

        return tx.promoCode.findUniqueOrThrow({
          where: { id },
          include: promoScopeInclude,
        });
      });
      return this.serializeScope(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('Такой код уже есть');
      }
      throw e;
    }
  }

  async delete(id: string) {
    const existing = await this.prisma.promoCode.findUnique({
      where: { id },
      include: { _count: { select: { redemptions: true } } },
    });
    if (!existing) throw new NotFoundException('Промокод не найден');

    // История применений: при любых redemption — только active=false (без cascade wipe).
    if (existing._count.redemptions > 0) {
      const row = await this.prisma.promoCode.update({
        where: { id },
        data: { active: false },
      });
      return { ok: true, deactivated: true, id: row.id, code: row.code };
    }

    await this.prisma.promoCode.delete({ where: { id } });
    return { ok: true, deactivated: false };
  }

  private serializeScope(row: PromoRowWithScope) {
    return {
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
      scope: row.scope,
      categoryIds: row.categories.map((c) => c.categoryId),
      categories: row.categories.map((c) => ({
        id: c.category.id,
        name: c.category.name,
        slug: c.category.slug,
        parentId: c.category.parentId,
        parentName: c.category.parent?.name ?? null,
      })),
      productIds: row.products.map((p) => p.productId),
      products: row.products.map((p) => ({
        id: p.product.id,
        name: p.product.name,
        slug: p.product.slug,
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async prepareScope(
    scope: DiscountScope | null | undefined,
    categoryIdsRaw?: string[],
    productIdsRaw?: string[],
  ) {
    if (scope == null) {
      return { scope: null as DiscountScope | null, categoryIds: [] as string[], productIds: [] as string[] };
    }
    const categoryIds = dedupeIdsPreserveOrder(categoryIdsRaw ?? []);
    const productIds = dedupeIdsPreserveOrder(productIdsRaw ?? []);
    if (scope === DiscountScope.CATEGORY) {
      if (!categoryIds.length) {
        throw new BadRequestException('Выберите категорию или подкатегорию');
      }
      const n = await this.prisma.category.count({ where: { id: { in: categoryIds } } });
      if (n !== categoryIds.length) {
        throw new BadRequestException('Одна из категорий не найдена');
      }
      return { scope, categoryIds, productIds: [] as string[] };
    }
    if (!productIds.length) {
      throw new BadRequestException('Выберите хотя бы один товар');
    }
    const n = await this.prisma.product.count({ where: { id: { in: productIds } } });
    if (n !== productIds.length) {
      throw new BadRequestException('Один из товаров не найден');
    }
    return { scope, categoryIds: [] as string[], productIds };
  }
}

@Injectable()
export class PromoPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceContext: CommerceContextService,
    private readonly catalogPublic: CatalogPublicService,
  ) {}

  /**
   * Preview для drawer: доверяет client subtotal (UX) если scope=null.
   * При scoped — пересчитывает eligible по synced lines.
   */
  async validate(
    codeRaw: string,
    subtotal: number,
    identity: PromoIdentity = {},
    buyerUserId?: string | null,
    lines?: Array<{ variantId: string; qty: number }>,
  ) {
    const ctx = await this.commerceContext.resolveFromUserId(buyerUserId);
    if (!ctx.allowPromoCodes) {
      throw new BadRequestException('Промокод недоступен для вашей группы');
    }
    const scopeLines = lines?.length
      ? await this.resolveScopeLines(lines, buyerUserId)
      : null;
    return this.applyAgainstSubtotal(codeRaw, subtotal, identity, {
      enforceIdentity: false,
      scopeLines,
    });
  }

  /**
   * Checkout: только после серверного пересчёта корзины.
   * oneShot / maxUses — жёстко.
   */
  async applyForCheckout(
    codeRaw: string,
    serverSubtotal: number,
    identity: PromoIdentity,
    scopeLines?: PromoScopeLine[] | null,
  ) {
    return this.applyAgainstSubtotal(codeRaw, serverSubtotal, identity, {
      enforceIdentity: true,
      scopeLines: scopeLines ?? null,
    });
  }

  private async resolveScopeLines(
    lines: Array<{ variantId: string; qty: number }>,
    buyerUserId?: string | null,
  ): Promise<PromoScopeLine[]> {
    const synced = await this.catalogPublic.syncCartLines(lines, buyerUserId ?? null);
    return synced.items
      .filter((i) => !(i as { isGiftDenom?: boolean }).isGiftDenom)
      .map((i) => ({
        productId: i.productId,
        categoryId: (i as { categoryId?: string }).categoryId ?? '',
        amount: Math.max(0, Math.floor(i.price * i.qty)),
      }))
      .filter((l) => l.productId && l.categoryId);
  }

  private async applyAgainstSubtotal(
    codeRaw: string,
    subtotal: number,
    identity: PromoIdentity,
    opts: { enforceIdentity: boolean; scopeLines?: PromoScopeLine[] | null },
  ): Promise<PromoApplyResult> {
    const code = normalizeCode(codeRaw);
    if (!code) throw new BadRequestException('Введите промокод');

    const row = await this.prisma.promoCode.findUnique({
      where: { code },
      include: {
        categories: { select: { categoryId: true } },
        products: { select: { productId: true } },
      },
    });
    if (!row || !row.active) {
      throw new BadRequestException('Промокод не найден или неактивен');
    }

    const now = new Date();
    if (row.startsAt && row.startsAt > now) {
      throw new BadRequestException('Промокод ещё не действует');
    }
    if (row.endsAt && row.endsAt < now) {
      throw new BadRequestException('Срок действия промокода истёк');
    }

    const sub = Math.max(0, Math.floor(subtotal));

    const usedCount = await this.prisma.promoCodeRedemption.count({
      where: { promoCodeId: row.id, ...promoConsumingRedemptionWhere },
    });
    if (row.maxUses != null && usedCount >= row.maxUses) {
      throw new BadRequestException('Лимит применений промокода исчерпан');
    }

    const email = normalizeEmail(identity.email);
    const userId = identity.userId?.trim() || null;
    const guestId = identity.guestId?.trim() || null;

    if (row.oneShot) {
      if (!email && opts.enforceIdentity) {
        throw new BadRequestException('Для one-shot промокода нужен email');
      }
      if (!email && !opts.enforceIdentity) {
        throw new BadRequestException(
          'Укажите email в форме оформления, чтобы проверить промокод',
        );
      }
      const or: Prisma.PromoCodeRedemptionWhereInput[] = [];
      if (email) or.push({ email });
      if (userId) or.push({ userId });
      if (guestId) or.push({ guestId });
      if (or.length) {
        const prior = await this.prisma.promoCodeRedemption.findFirst({
          where: {
            promoCodeId: row.id,
            ...promoConsumingRedemptionWhere,
            OR: or,
          },
          select: { id: true },
        });
        if (prior) {
          throw new BadRequestException('Этот промокод уже был использован');
        }
      }
    }

    const eligible = eligiblePromoSubtotal(
      row.scope,
      row.categories.map((c) => c.categoryId),
      row.products.map((p) => p.productId),
      sub,
      opts.scopeLines,
    );

    // Порог = база скидки: весь заказ или сумма позиций из области.
    if (row.minOrderAmount != null && eligible < row.minOrderAmount) {
      throw new BadRequestException(
        row.scope
          ? `Минимальная сумма товаров из области промокода — ${row.minOrderAmount} ₽`
          : `Минимальная сумма заказа для промокода — ${row.minOrderAmount} ₽`,
      );
    }

    const discountAmount = computePromoDiscount(row.type, row.value, eligible);
    return {
      promoCodeId: row.id,
      code: row.code,
      type: row.type,
      value: row.value,
      discountAmount,
      subtotal: sub,
      eligibleSubtotal: eligible,
      total: Math.max(0, sub - discountAmount),
      maxUses: row.maxUses,
      oneShot: row.oneShot,
      minOrderAmount: row.minOrderAmount,
      usedCount,
      scope: row.scope,
    };
  }
}
