import { Injectable } from '@nestjs/common';
import {
  CatalogVisibilityMode,
  type CatalogGroupVisibility,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CommerceContext } from './commerce-context.types';
import {
  buildCategoryParentMap,
  categoryAncestorIds,
  type CategoryParentMap,
} from './category-tree.util';
import { UserGroupsSharedCacheService } from './user-groups-shared-cache.service';

export type VisibilityTarget = {
  productId: string;
  categoryId: string;
  variantIds?: string[];
};

@Injectable()
export class CatalogVisibilityService {
  private categoryParentById: CategoryParentMap | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sharedCache: UserGroupsSharedCacheService,
  ) {}

  invalidateCache(): void {
    this.sharedCache.invalidate();
    this.categoryParentById = null;
  }

  async hasActiveRules(): Promise<boolean> {
    const rules = await this.loadRules();
    return rules.length > 0;
  }

  async loadRules(): Promise<CatalogGroupVisibility[]> {
    return this.sharedCache.getRules(() => this.prisma.catalogGroupVisibility.findMany());
  }

  collectRulesForTarget(
    rules: CatalogGroupVisibility[],
    target: VisibilityTarget,
    parentById?: CategoryParentMap,
  ): CatalogGroupVisibility[] {
    const variantIds = new Set(target.variantIds ?? []);
    const categoryIds = parentById
      ? new Set(categoryAncestorIds(target.categoryId, parentById))
      : new Set([target.categoryId]);

    return rules.filter((r) => {
      if (r.targetType === 'PRODUCT' && r.targetId === target.productId) return true;
      if (r.targetType === 'CATEGORY' && categoryIds.has(r.targetId)) return true;
      if (r.targetType === 'VARIANT' && variantIds.has(r.targetId)) return true;
      return false;
    });
  }

  isVisible(ctx: CommerceContext, applicable: CatalogGroupVisibility[]): boolean {
    if (!applicable.length) return true;

    const showOnly = applicable.filter(
      (r) =>
        r.mode === CatalogVisibilityMode.SHOW_ONLY_GROUP ||
        r.mode === CatalogVisibilityMode.SHOW_ONLY_REGISTERED,
    );
    const hideRules = applicable.filter(
      (r) =>
        r.mode === CatalogVisibilityMode.HIDE_FROM_GUESTS ||
        r.mode === CatalogVisibilityMode.HIDE_FROM_REGISTERED ||
        r.mode === CatalogVisibilityMode.HIDE_FROM_GROUP,
    );

    let visible = true;
    if (showOnly.length > 0) {
      visible = showOnly.some((r) => this.ruleMatchesShow(ctx, r));
    }
    if (visible && hideRules.some((r) => this.ruleMatchesHide(ctx, r))) {
      visible = false;
    }
    return visible;
  }

  async isTargetVisible(ctx: CommerceContext, target: VisibilityTarget): Promise<boolean> {
    const variantIds = target.variantIds ?? [];
    if (!variantIds.length) {
      const [rules, parentById] = await Promise.all([
        this.loadRules(),
        this.loadCategoryParentMap(),
      ]);
      return this.isVisible(ctx, this.collectRulesForTarget(rules, target, parentById));
    }
    const visible = await this.filterVisibleVariantIds(ctx, {
      productId: target.productId,
      categoryId: target.categoryId,
      variantIds,
    });
    return visible.length > 0;
  }

  /** Per-variant visibility; product shown if any variant remains visible. */
  async filterVisibleVariantIds(
    ctx: CommerceContext,
    target: { productId: string; categoryId: string; variantIds: string[] },
  ): Promise<string[]> {
    if (!target.variantIds.length) return [];
    const [rules, parentById] = await Promise.all([
      this.loadRules(),
      this.loadCategoryParentMap(),
    ]);
    return this.filterVisibleVariantIdsWithRules(ctx, rules, parentById, target);
  }

  filterVisibleVariantIdsWithRules(
    ctx: CommerceContext,
    rules: CatalogGroupVisibility[],
    parentById: CategoryParentMap,
    target: { productId: string; categoryId: string; variantIds: string[] },
  ): string[] {
    const { productId, categoryId, variantIds } = target;
    const productApplicable = this.collectRulesForTarget(
      rules,
      { productId, categoryId, variantIds: [] },
      parentById,
    );
    if (!this.isVisible(ctx, productApplicable)) return [];

    const variantShowOnly = rules.filter(
      (r) =>
        r.targetType === 'VARIANT' &&
        (r.mode === CatalogVisibilityMode.SHOW_ONLY_GROUP ||
          r.mode === CatalogVisibilityMode.SHOW_ONLY_REGISTERED) &&
        variantIds.includes(r.targetId),
    );

    let candidates = variantIds;
    if (variantShowOnly.length > 0) {
      candidates = variantIds.filter((vid) =>
        variantShowOnly.some(
          (r) => r.targetId === vid && this.ruleMatchesShow(ctx, r),
        ),
      );
    }

    return candidates.filter((vid) => {
      const variantOnly = this.collectRulesForTarget(
        rules,
        { productId, categoryId, variantIds: [vid] },
        parentById,
      ).filter((r) => r.targetType === 'VARIANT');
      return this.isVisible(ctx, [...productApplicable, ...variantOnly]);
    });
  }

  async filterVisible<T extends VisibilityTarget>(ctx: CommerceContext, items: T[]): Promise<T[]> {
    if (!items.length) return items;
    const [rules, parentById] = await Promise.all([
      this.loadRules(),
      this.loadCategoryParentMap(),
    ]);
    return items.filter((item) => {
      const variantIds = item.variantIds ?? [];
      if (!variantIds.length) {
        return this.isVisible(ctx, this.collectRulesForTarget(rules, item, parentById));
      }
      return (
        this.filterVisibleVariantIdsWithRules(ctx, rules, parentById, {
          productId: item.productId,
          categoryId: item.categoryId,
          variantIds,
        }).length > 0
      );
    });
  }

  async applyVariantVisibilityToProductSources<
    T extends { id: string; categoryId: string; variants: Array<{ id: string }> },
  >(ctx: CommerceContext, sources: T[]): Promise<T[]> {
    if (!sources.length) return sources;
    const [rules, parentById] = await Promise.all([
      this.loadRules(),
      this.loadCategoryParentMap(),
    ]);
    const out: T[] = [];
    for (const source of sources) {
      const visibleIds = this.filterVisibleVariantIdsWithRules(ctx, rules, parentById, {
        productId: source.id,
        categoryId: source.categoryId,
        variantIds: source.variants.map((v) => v.id),
      });
      if (!visibleIds.length) continue;
      const visibleSet = new Set(visibleIds);
      out.push({
        ...source,
        variants: source.variants.filter((v) => visibleSet.has(v.id)),
      } as T);
    }
    return out;
  }

  private async loadCategoryParentMap(): Promise<CategoryParentMap> {
    if (this.categoryParentById) return this.categoryParentById;
    const rows = await this.prisma.category.findMany({
      select: { id: true, parentId: true },
    });
    this.categoryParentById = buildCategoryParentMap(rows);
    return this.categoryParentById;
  }

  private ruleMatchesShow(ctx: CommerceContext, rule: CatalogGroupVisibility): boolean {
    if (rule.mode === CatalogVisibilityMode.SHOW_ONLY_REGISTERED) {
      return ctx.isRegistered;
    }
    if (rule.mode === CatalogVisibilityMode.SHOW_ONLY_GROUP) {
      return ctx.isRegistered && rule.groupId != null && ctx.groupId === rule.groupId;
    }
    return false;
  }

  private ruleMatchesHide(ctx: CommerceContext, rule: CatalogGroupVisibility): boolean {
    if (rule.mode === CatalogVisibilityMode.HIDE_FROM_GUESTS) {
      return ctx.isGuest;
    }
    if (rule.mode === CatalogVisibilityMode.HIDE_FROM_REGISTERED) {
      return ctx.isRegistered;
    }
    if (rule.mode === CatalogVisibilityMode.HIDE_FROM_GROUP) {
      return rule.groupId != null && ctx.groupId === rule.groupId;
    }
    return false;
  }
}
