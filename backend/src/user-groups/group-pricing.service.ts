import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildCategoryParentMap,
  findNearestCategoryRule,
} from './category-tree.util';
import type { CommerceContext, ResolvedVariantPrice, VariantPriceInput } from './commerce-context.types';
import { applyCategoryPriceRule } from './group-price.util';

@Injectable()
export class GroupPricingService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveVariantPrices(
    ctx: CommerceContext,
    items: VariantPriceInput[],
  ): Promise<Map<string, ResolvedVariantPrice>> {
    const out = new Map<string, ResolvedVariantPrice>();
    if (!items.length) return out;

    const variantIds = [...new Set(items.map((i) => i.variantId))];

    const [variantPrices, categoryPrices, categories] = await this.prisma.$transaction([
      this.prisma.groupVariantPrice.findMany({
        where: { groupId: ctx.groupId, variantId: { in: variantIds } },
        select: { variantId: true, price: true },
      }),
      this.prisma.groupCategoryPrice.findMany({
        where: { groupId: ctx.groupId },
        select: { categoryId: true, type: true, value: true },
      }),
      this.prisma.category.findMany({
        select: { id: true, parentId: true },
      }),
    ]);

    const byVariant = new Map(variantPrices.map((r) => [r.variantId, r.price]));
    const byCategory = new Map(
      categoryPrices.map((r) => [r.categoryId, { type: r.type, value: r.value }]),
    );
    const parentById = buildCategoryParentMap(categories);

    for (const item of items) {
      out.set(item.variantId, this.resolveOne(ctx, item, { byVariant, byCategory, parentById }));
    }

    return out;
  }

  resolveOne(
    ctx: CommerceContext,
    item: VariantPriceInput,
    maps: {
      byVariant: Map<string, number>;
      byCategory: Map<string, { type: import('@prisma/client').GroupCategoryPriceType; value: number }>;
      parentById: ReturnType<typeof buildCategoryParentMap>;
    },
  ): ResolvedVariantPrice {
    const basePrice = item.basePrice;
    let groupPrice = basePrice;
    const skuOverride = maps.byVariant.get(item.variantId);
    if (skuOverride != null) {
      groupPrice = skuOverride;
    } else {
      const catRule = findNearestCategoryRule(item.categoryId, maps.byCategory, maps.parentById);
      if (catRule) {
        groupPrice = applyCategoryPriceRule(
          basePrice,
          catRule.type,
          catRule.value,
          ctx.priceRounding,
        );
      }
    }
    return { basePrice, groupPrice };
  }
}
