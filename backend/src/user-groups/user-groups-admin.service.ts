import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CatalogVisibilityMode,
  GroupCategoryPriceType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommerceContextService } from './commerce-context.service';
import { CatalogVisibilityService } from './catalog-visibility.service';
import type {
  CreateCatalogVisibilityDto,
  UpdateCatalogVisibilityDto,
} from './dto/catalog-visibility-admin.dto';
import type {
  CreateUserGroupDto,
  ReplaceGroupCategoryPricesDto,
  ReplaceGroupVariantPricesDto,
  UpdateUserGroupDto,
  UpsertGroupCategoryPriceDto,
  UpsertGroupVariantPriceDto,
} from './dto/user-groups-admin.dto';

const LIST_DEFAULT = 20;
const LIST_MAX = 100;

function assertGroupModeNeedsGroupId(mode: CatalogVisibilityMode, groupId?: string | null) {
  const needs =
    mode === CatalogVisibilityMode.HIDE_FROM_GROUP ||
    mode === CatalogVisibilityMode.SHOW_ONLY_GROUP;
  if (needs && !groupId?.trim()) {
    throw new BadRequestException('Для этого режима нужен groupId');
  }
  if (!needs && groupId?.trim()) {
    throw new BadRequestException('groupId только для HIDE_FROM_GROUP / SHOW_ONLY_GROUP');
  }
}

function assertCategoryPriceValue(type: GroupCategoryPriceType, value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new BadRequestException('value: целое ≥ 0');
  }
  if (type === GroupCategoryPriceType.PERCENT_OFF && (value < 1 || value > 100)) {
    throw new BadRequestException('PERCENT_OFF: 1–100');
  }
}

@Injectable()
export class UserGroupsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceContext: CommerceContextService,
    private readonly catalogVisibility: CatalogVisibilityService,
  ) {}

  async list(opts: { q?: string; page?: number; limit?: number; active?: boolean } = {}) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(LIST_MAX, Math.max(1, opts.limit ?? LIST_DEFAULT));
    const where: Prisma.UserGroupWhereInput = {};
    const q = opts.q?.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (opts.active !== undefined) where.active = opts.active;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.userGroup.count({ where }),
      this.prisma.userGroup.findMany({
        where,
        orderBy: [{ isDefaultGuest: 'desc' }, { isDefaultRegistered: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: {
            select: {
              users: true,
              variantPrices: true,
              categoryPrices: true,
              visibilityRules: true,
            },
          },
        },
      }),
    ]);

    return {
      items: rows.map((r) => this.serializeGroup(r)),
      total,
      page,
      limit,
    };
  }

  async one(id: string) {
    const row = await this.prisma.userGroup.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            users: true,
            variantPrices: true,
            categoryPrices: true,
            visibilityRules: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Группа не найдена');
    return this.serializeGroup(row);
  }

  async create(dto: CreateUserGroupDto) {
    const slug = dto.slug.trim().toLowerCase();
    const existing = await this.prisma.userGroup.findUnique({ where: { slug } });
    if (existing) throw new BadRequestException('slug уже занят');

    const row = await this.prisma.userGroup.create({
      data: {
        name: dto.name.trim(),
        slug,
        active: dto.active ?? true,
        allowCatalogDiscounts: dto.allowCatalogDiscounts ?? false,
        allowPromoCodes: dto.allowPromoCodes ?? true,
        priceRounding: dto.priceRounding ?? 'NEAREST',
      },
      include: {
        _count: {
          select: {
            users: true,
            variantPrices: true,
            categoryPrices: true,
            visibilityRules: true,
          },
        },
      },
    });
    return this.serializeGroup(row);
  }

  async update(id: string, dto: UpdateUserGroupDto) {
    const row = await this.prisma.userGroup.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Группа не найдена');

    const isSystem = row.isDefaultGuest || row.isDefaultRegistered;
    if (isSystem) {
      if (dto.active === false) {
        throw new BadRequestException('Системную группу нельзя деактивировать');
      }
      if (
        dto.slug !== undefined &&
        dto.slug.trim().toLowerCase() !== row.slug
      ) {
        throw new BadRequestException('Slug системной группы нельзя менять');
      }
    }

    if (dto.slug && dto.slug.trim().toLowerCase() !== row.slug) {
      const taken = await this.prisma.userGroup.findFirst({
        where: { slug: dto.slug.trim().toLowerCase(), NOT: { id } },
      });
      if (taken) throw new BadRequestException('slug уже занят');
    }

    const updated = await this.prisma.userGroup.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        slug: dto.slug?.trim().toLowerCase(),
        active: dto.active,
        allowCatalogDiscounts: dto.allowCatalogDiscounts,
        allowPromoCodes: dto.allowPromoCodes,
        priceRounding: dto.priceRounding,
      },
      include: {
        _count: {
          select: {
            users: true,
            variantPrices: true,
            categoryPrices: true,
            visibilityRules: true,
          },
        },
      },
    });

    if (row.isDefaultGuest || row.isDefaultRegistered) {
      await this.commerceContext.refreshDefaults();
    }

    return this.serializeGroup(updated);
  }

  async remove(id: string) {
    const row = await this.prisma.userGroup.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!row) throw new NotFoundException('Группа не найдена');
    if (row.isDefaultGuest || row.isDefaultRegistered) {
      throw new BadRequestException('Системную группу нельзя удалить');
    }
    if (row._count.users > 0) {
      throw new BadRequestException('Сначала снимите пользователей с группы');
    }
    await this.prisma.userGroup.delete({ where: { id } });
    this.catalogVisibility.invalidateCache();
    return { ok: true };
  }

  async listMembers(
    groupId: string,
    opts: { q?: string; page?: number; limit?: number } = {},
  ) {
    await this.ensureGroup(groupId);
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(LIST_MAX, Math.max(1, opts.limit ?? LIST_DEFAULT));
    const where: Prisma.UserWhereInput = {
      groupId,
      role: UserRole.USER,
      isActive: true,
    };
    const q = opts.q?.trim();
    if (q) {
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          email: true,
          displayName: true,
          createdAt: true,
        },
      }),
    ]);

    return { items: rows, total, page, limit };
  }

  async assignMember(groupId: string, userId: string) {
    const group = await this.ensureGroup(groupId);
    if (!group.assignable) {
      throw new BadRequestException('В эту группу нельзя назначать пользователей');
    }
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: UserRole.USER, isActive: true },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');

    await this.prisma.user.update({
      where: { id: userId },
      data: { groupId },
    });
    return { ok: true };
  }

  async removeMember(groupId: string, userId: string) {
    await this.ensureGroup(groupId);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, groupId },
    });
    if (!user) throw new NotFoundException('Пользователь не в этой группе');
    await this.prisma.user.update({
      where: { id: userId },
      data: { groupId: null },
    });
    return { ok: true };
  }

  async listVariantPrices(
    groupId: string,
    opts: { q?: string; page?: number; limit?: number } = {},
  ) {
    await this.ensureGroup(groupId);
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(LIST_MAX, Math.max(1, opts.limit ?? LIST_DEFAULT));
    const q = opts.q?.trim();

    const where: Prisma.GroupVariantPriceWhereInput = { groupId };
    if (q) {
      where.variant = {
        OR: [
          { sku: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
          { product: { name: { contains: q, mode: 'insensitive' } } },
        ],
      };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.groupVariantPrice.count({ where }),
      this.prisma.groupVariantPrice.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              name: true,
              price: true,
              product: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      }),
    ]);

    return {
      items: rows.map((r) => ({
        variantId: r.variantId,
        price: r.price,
        basePrice: r.variant.price,
        sku: r.variant.sku,
        variantName: r.variant.name,
        productName: r.variant.product.name,
        productSlug: r.variant.product.slug,
      })),
      total,
      page,
      limit,
    };
  }

  async replaceVariantPrices(groupId: string, dto: ReplaceGroupVariantPricesDto) {
    await this.ensureGroup(groupId);
    if (!Array.isArray(dto.items)) {
      throw new BadRequestException('items обязателен (массив)');
    }
    const items = dto.items;
    const variantIds = [...new Set(items.map((i) => i.variantId))];
    if (variantIds.length) {
      const found = await this.prisma.productVariant.count({
        where: { id: { in: variantIds } },
      });
      if (found !== variantIds.length) {
        throw new BadRequestException('Некоторые variantId не найдены');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.groupVariantPrice.deleteMany({ where: { groupId } });
      if (items.length) {
        await tx.groupVariantPrice.createMany({
          data: items.map((i) => ({
            groupId,
            variantId: i.variantId,
            price: i.price,
          })),
        });
      }
    });

    return this.listVariantPrices(groupId, { page: 1, limit: LIST_DEFAULT });
  }

  async upsertVariantPrice(
    groupId: string,
    variantId: string,
    dto: UpsertGroupVariantPriceDto,
  ) {
    await this.ensureGroup(groupId);
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true },
    });
    if (!variant) throw new NotFoundException('Вариант не найден');

    await this.prisma.groupVariantPrice.upsert({
      where: { groupId_variantId: { groupId, variantId } },
      create: { groupId, variantId, price: dto.price },
      update: { price: dto.price },
    });
    return { ok: true, variantId, price: dto.price };
  }

  async deleteVariantPrice(groupId: string, variantId: string) {
    await this.ensureGroup(groupId);
    await this.prisma.groupVariantPrice.deleteMany({
      where: { groupId, variantId },
    });
    return { ok: true };
  }

  async listCategoryPrices(groupId: string) {
    await this.ensureGroup(groupId);
    const rows = await this.prisma.groupCategoryPrice.findMany({
      where: { groupId },
      orderBy: { updatedAt: 'desc' },
      include: {
        category: { select: { id: true, name: true, slug: true } },
      },
    });
    return {
      items: rows.map((r) => ({
        categoryId: r.categoryId,
        type: r.type,
        value: r.value,
        categoryName: r.category.name,
        categorySlug: r.category.slug,
      })),
    };
  }

  async replaceCategoryPrices(groupId: string, dto: ReplaceGroupCategoryPricesDto) {
    await this.ensureGroup(groupId);
    if (!Array.isArray(dto.items)) {
      throw new BadRequestException('items обязателен (массив)');
    }
    for (const item of dto.items) {
      assertCategoryPriceValue(item.type, item.value);
    }
    const categoryIds = [...new Set(dto.items.map((i) => i.categoryId))];
    if (categoryIds.length) {
      const found = await this.prisma.category.count({ where: { id: { in: categoryIds } } });
      if (found !== categoryIds.length) {
        throw new BadRequestException('Некоторые categoryId не найдены');
      }
      for (const categoryId of categoryIds) {
        await this.assertLeafCategory(categoryId);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.groupCategoryPrice.deleteMany({ where: { groupId } });
      if (dto.items.length) {
        await tx.groupCategoryPrice.createMany({
          data: dto.items.map((i) => ({
            groupId,
            categoryId: i.categoryId,
            type: i.type,
            value: i.value,
          })),
        });
      }
    });

    return this.listCategoryPrices(groupId);
  }

  async upsertCategoryPrice(
    groupId: string,
    categoryId: string,
    dto: UpsertGroupCategoryPriceDto,
  ) {
    await this.ensureGroup(groupId);
    assertCategoryPriceValue(dto.type, dto.value);
    const cat = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!cat) throw new NotFoundException('Категория не найдена');
    await this.assertLeafCategory(categoryId);

    await this.prisma.groupCategoryPrice.upsert({
      where: { groupId_categoryId: { groupId, categoryId } },
      create: {
        groupId,
        categoryId,
        type: dto.type,
        value: dto.value,
      },
      update: { type: dto.type, value: dto.value },
    });
    return { ok: true, categoryId, type: dto.type, value: dto.value };
  }

  async deleteCategoryPrice(groupId: string, categoryId: string) {
    await this.ensureGroup(groupId);
    await this.prisma.groupCategoryPrice.deleteMany({
      where: { groupId, categoryId },
    });
    return { ok: true };
  }

  async listGroupVisibility(groupId: string) {
    await this.ensureGroup(groupId);
    const rows = await this.prisma.catalogGroupVisibility.findMany({
      where: { groupId },
      orderBy: { createdAt: 'desc' },
    });
    const labels = await this.resolveVisibilityTargetLabels(rows);
    return {
      items: rows.map((r) => ({
        ...r,
        targetLabel: labels.get(`${r.targetType}:${r.targetId}`) ?? null,
      })),
    };
  }

  private async resolveVisibilityTargetLabels(
    rows: Array<{ targetType: import('@prisma/client').CatalogVisibilityTarget; targetId: string }>,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!rows.length) return out;

    const productIds = [
      ...new Set(rows.filter((r) => r.targetType === 'PRODUCT').map((r) => r.targetId)),
    ];
    const categoryIds = [
      ...new Set(rows.filter((r) => r.targetType === 'CATEGORY').map((r) => r.targetId)),
    ];
    const variantIds = [
      ...new Set(rows.filter((r) => r.targetType === 'VARIANT').map((r) => r.targetId)),
    ];

    const [products, categories, variants] = await Promise.all([
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true },
          })
        : [],
      categoryIds.length
        ? this.prisma.category.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true, parent: { select: { name: true } } },
          })
        : [],
      variantIds.length
        ? this.prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: {
              id: true,
              sku: true,
              name: true,
              product: { select: { name: true } },
            },
          })
        : [],
    ]);

    for (const p of products) {
      out.set(`PRODUCT:${p.id}`, p.name);
    }
    for (const c of categories) {
      const label = c.parent?.name ? `${c.parent.name} → ${c.name}` : c.name;
      out.set(`CATEGORY:${c.id}`, label);
    }
    for (const v of variants) {
      out.set(`VARIANT:${v.id}`, `${v.product.name} · ${v.name} (${v.sku})`);
    }
    return out;
  }

  async listAllVisibility(opts: {
    mode?: CatalogVisibilityMode;
    targetType?: string;
    groupId?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(LIST_MAX, Math.max(1, opts.limit ?? LIST_DEFAULT));
    const where: Prisma.CatalogGroupVisibilityWhereInput = {};
    if (opts.mode) where.mode = opts.mode;
    if (opts.groupId) where.groupId = opts.groupId;
    if (opts.targetType) {
      where.targetType = opts.targetType as Prisma.EnumCatalogVisibilityTargetFilter;
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.catalogGroupVisibility.count({ where }),
      this.prisma.catalogGroupVisibility.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          group: { select: { id: true, name: true, slug: true } },
        },
      }),
    ]);

    return { items: rows, total, page, limit };
  }

  async createVisibility(dto: CreateCatalogVisibilityDto) {
    assertGroupModeNeedsGroupId(dto.mode, dto.groupId);
    if (dto.groupId) await this.ensureGroup(dto.groupId);
    await this.ensureVisibilityTarget(dto.targetType, dto.targetId);

    const row = await this.prisma.catalogGroupVisibility.create({
      data: {
        mode: dto.mode,
        groupId: dto.groupId?.trim() || null,
        targetType: dto.targetType,
        targetId: dto.targetId.trim(),
      },
      include: { group: { select: { id: true, name: true, slug: true } } },
    });
    this.catalogVisibility.invalidateCache();
    return row;
  }

  async updateVisibility(id: string, dto: UpdateCatalogVisibilityDto) {
    const row = await this.prisma.catalogGroupVisibility.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Правило не найдено');

    const mode = dto.mode ?? row.mode;
    const groupId = dto.groupId !== undefined ? dto.groupId : row.groupId;
    assertGroupModeNeedsGroupId(mode, groupId);
    if (groupId) await this.ensureGroup(groupId);

    const targetType = dto.targetType ?? row.targetType;
    const targetId = dto.targetId?.trim() ?? row.targetId;
    if (dto.targetType || dto.targetId) {
      await this.ensureVisibilityTarget(targetType, targetId);
    }

    const updated = await this.prisma.catalogGroupVisibility.update({
      where: { id },
      data: {
        mode: dto.mode,
        groupId: dto.groupId !== undefined ? (dto.groupId?.trim() || null) : undefined,
        targetType: dto.targetType,
        targetId: dto.targetId?.trim(),
      },
      include: { group: { select: { id: true, name: true, slug: true } } },
    });
    this.catalogVisibility.invalidateCache();
    return updated;
  }

  async deleteVisibility(id: string) {
    const row = await this.prisma.catalogGroupVisibility.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Правило не найдено');
    await this.prisma.catalogGroupVisibility.delete({ where: { id } });
    this.catalogVisibility.invalidateCache();
    return { ok: true };
  }

  async createGroupVisibility(groupId: string, dto: CreateCatalogVisibilityDto) {
    await this.ensureGroup(groupId);
    const needsGroup =
      dto.mode === CatalogVisibilityMode.HIDE_FROM_GROUP ||
      dto.mode === CatalogVisibilityMode.SHOW_ONLY_GROUP;
    const payload: CreateCatalogVisibilityDto = {
      ...dto,
      groupId: needsGroup ? groupId : dto.groupId?.trim() || null,
    };
    return this.createVisibility(payload);
  }

  async updateGroupVisibility(
    groupId: string,
    ruleId: string,
    dto: UpdateCatalogVisibilityDto,
  ) {
    await this.ensureGroupVisibilityRule(groupId, ruleId);
    const mode = dto.mode;
    const payload =
      mode === CatalogVisibilityMode.HIDE_FROM_GROUP ||
      mode === CatalogVisibilityMode.SHOW_ONLY_GROUP
        ? { ...dto, groupId }
        : dto;
    return this.updateVisibility(ruleId, payload);
  }

  async deleteGroupVisibility(groupId: string, ruleId: string) {
    await this.ensureGroupVisibilityRule(groupId, ruleId);
    return this.deleteVisibility(ruleId);
  }

  private async ensureGroupVisibilityRule(groupId: string, ruleId: string) {
    await this.ensureGroup(groupId);
    const row = await this.prisma.catalogGroupVisibility.findUnique({ where: { id: ruleId } });
    if (!row) throw new NotFoundException('Правило не найдено');
    if (row.groupId && row.groupId !== groupId) {
      throw new BadRequestException('Правило принадлежит другой группе');
    }
    return row;
  }

  async updateUserGroup(userId: string, groupId: string | null) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: UserRole.USER, isActive: true },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');

    if (groupId) {
      const group = await this.ensureGroup(groupId);
      if (!group.assignable) {
        throw new BadRequestException('Эту группу нельзя назначить пользователю');
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { groupId },
    });
    return { ok: true, groupId };
  }

  private async ensureGroup(id: string) {
    const row = await this.prisma.userGroup.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Группа не найдена');
    return row;
  }

  /** Category prices only on leaf categories (no children). */
  private async assertLeafCategory(categoryId: string) {
    const child = await this.prisma.category.findFirst({
      where: { parentId: categoryId },
      select: { id: true },
    });
    if (child) {
      throw new BadRequestException(
        'Цена категории только для конечных (leaf) категорий без подкатегорий',
      );
    }
  }

  private async ensureVisibilityTarget(
    targetType: import('@prisma/client').CatalogVisibilityTarget,
    targetId: string,
  ) {
    if (targetType === 'PRODUCT') {
      const p = await this.prisma.product.findUnique({ where: { id: targetId } });
      if (!p) throw new BadRequestException('productId не найден');
      return;
    }
    if (targetType === 'CATEGORY') {
      const c = await this.prisma.category.findUnique({ where: { id: targetId } });
      if (!c) throw new BadRequestException('categoryId не найден');
      return;
    }
    const v = await this.prisma.productVariant.findUnique({ where: { id: targetId } });
    if (!v) throw new BadRequestException('variantId не найден');
  }

  private serializeGroup(
    row: Prisma.UserGroupGetPayload<{
      include: {
        _count: {
          select: {
            users: true;
            variantPrices: true;
            categoryPrices: true;
            visibilityRules: true;
          };
        };
      };
    }>,
  ) {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      active: row.active,
      isDefaultGuest: row.isDefaultGuest,
      isDefaultRegistered: row.isDefaultRegistered,
      assignable: row.assignable,
      allowCatalogDiscounts: row.allowCatalogDiscounts,
      allowPromoCodes: row.allowPromoCodes,
      priceRounding: row.priceRounding,
      counts: row._count,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
