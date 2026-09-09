import { describe, expect, it, vi } from 'vitest';
import {
  CatalogVisibilityMode,
  CatalogVisibilityTarget,
  type CatalogGroupVisibility,
} from '@prisma/client';
import { buildCategoryParentMap } from './category-tree.util';
import { CatalogVisibilityService } from './catalog-visibility.service';
import type { CommerceContext } from './commerce-context.types';

function ctx(
  kind: CommerceContext['kind'],
  groupId = 'wholesale',
): CommerceContext {
  const isGuest = kind === 'guest';
  return {
    kind,
    groupId,
    groupName: kind,
    groupSlug: kind,
    allowCatalogDiscounts: true,
    allowPromoCodes: true,
    priceRounding: 'NEAREST',
    isGuest,
    isRegistered: !isGuest,
    userGroupId: kind === 'registered_group' ? groupId : null,
  };
}

function rule(
  partial: Partial<CatalogGroupVisibility> & Pick<CatalogGroupVisibility, 'mode' | 'targetType' | 'targetId'>,
): CatalogGroupVisibility {
  return {
    id: `r-${partial.targetId}-${partial.mode}`,
    groupId: partial.groupId ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as CatalogGroupVisibility;
}

function svc() {
  return new CatalogVisibilityService(
    { category: { findMany: vi.fn() } } as never,
    { getRules: vi.fn(), invalidate: vi.fn() } as never,
  );
}

const parentById = buildCategoryParentMap([
  { id: 'root', parentId: null },
  { id: 'leaf', parentId: 'root' },
]);

describe('CatalogVisibilityService context matrix', () => {
  const productId = 'p1';
  const categoryId = 'leaf';
  const v1 = 'var-a';
  const v2 = 'var-b';

  it('no rules → visible for all contexts', () => {
    const s = svc();
    for (const c of [ctx('guest'), ctx('registered_default'), ctx('registered_group')]) {
      expect(s.isVisible(c, [])).toBe(true);
    }
  });

  it('HIDE_FROM_GUESTS hides only guests', () => {
    const s = svc();
    const rules = [
      rule({
        mode: CatalogVisibilityMode.HIDE_FROM_GUESTS,
        targetType: CatalogVisibilityTarget.PRODUCT,
        targetId: productId,
      }),
    ];
    const applicable = s.collectRulesForTarget(
      rules,
      { productId, categoryId, variantIds: [v1] },
      parentById,
    );
    expect(s.isVisible(ctx('guest'), applicable)).toBe(false);
    expect(s.isVisible(ctx('registered_default'), applicable)).toBe(true);
  });

  it('HIDE_FROM_GROUP hides matching group only', () => {
    const s = svc();
    const rules = [
      rule({
        mode: CatalogVisibilityMode.HIDE_FROM_GROUP,
        targetType: CatalogVisibilityTarget.PRODUCT,
        targetId: productId,
        groupId: 'wholesale',
      }),
    ];
    const applicable = s.collectRulesForTarget(
      rules,
      { productId, categoryId, variantIds: [] },
      parentById,
    );
    expect(s.isVisible(ctx('registered_group', 'wholesale'), applicable)).toBe(false);
    expect(s.isVisible(ctx('registered_group', 'retail'), applicable)).toBe(true);
    expect(s.isVisible(ctx('guest', 'guests'), applicable)).toBe(true);
  });

  it('SHOW_ONLY_REGISTERED hides guests', () => {
    const s = svc();
    const rules = [
      rule({
        mode: CatalogVisibilityMode.SHOW_ONLY_REGISTERED,
        targetType: CatalogVisibilityTarget.PRODUCT,
        targetId: productId,
      }),
    ];
    const applicable = s.collectRulesForTarget(
      rules,
      { productId, categoryId, variantIds: [] },
      parentById,
    );
    expect(s.isVisible(ctx('guest'), applicable)).toBe(false);
    expect(s.isVisible(ctx('registered_default'), applicable)).toBe(true);
  });

  it('SHOW_ONLY_GROUP requires registered + same group', () => {
    const s = svc();
    const rules = [
      rule({
        mode: CatalogVisibilityMode.SHOW_ONLY_GROUP,
        targetType: CatalogVisibilityTarget.PRODUCT,
        targetId: productId,
        groupId: 'vip',
      }),
    ];
    const applicable = s.collectRulesForTarget(
      rules,
      { productId, categoryId, variantIds: [] },
      parentById,
    );
    expect(s.isVisible(ctx('guest'), applicable)).toBe(false);
    expect(s.isVisible(ctx('registered_default'), applicable)).toBe(false);
    expect(s.isVisible(ctx('registered_group', 'vip'), applicable)).toBe(true);
    expect(s.isVisible(ctx('registered_group', 'other'), applicable)).toBe(false);
  });

  it('category rule applies to descendant products', () => {
    const s = svc();
    const rules = [
      rule({
        mode: CatalogVisibilityMode.HIDE_FROM_GUESTS,
        targetType: CatalogVisibilityTarget.CATEGORY,
        targetId: 'root',
      }),
    ];
    const applicable = s.collectRulesForTarget(
      rules,
      { productId, categoryId: 'leaf', variantIds: [] },
      parentById,
    );
    expect(applicable).toHaveLength(1);
    expect(s.isVisible(ctx('guest'), applicable)).toBe(false);
  });

  it('VARIANT hide affects single variant only', () => {
    const s = svc();
    const rules = [
      rule({
        mode: CatalogVisibilityMode.HIDE_FROM_GUESTS,
        targetType: CatalogVisibilityTarget.VARIANT,
        targetId: v1,
      }),
    ];
    const visible = svc().filterVisibleVariantIdsWithRules(
      ctx('guest'),
      rules,
      parentById,
      { productId, categoryId, variantIds: [v1, v2] },
    );
    expect(visible).toEqual([v2]);
  });

  it('VARIANT show-only leaves only matching variant', () => {
    const s = svc();
    const rules = [
      rule({
        mode: CatalogVisibilityMode.SHOW_ONLY_REGISTERED,
        targetType: CatalogVisibilityTarget.VARIANT,
        targetId: v1,
      }),
    ];
    const guestVisible = s.filterVisibleVariantIdsWithRules(
      ctx('guest'),
      rules,
      parentById,
      { productId, categoryId, variantIds: [v1, v2] },
    );
    expect(guestVisible).toEqual([]);

    const regVisible = s.filterVisibleVariantIdsWithRules(
      ctx('registered_default'),
      rules,
      parentById,
      { productId, categoryId, variantIds: [v1, v2] },
    );
    expect(regVisible).toEqual([v1]);
  });
});
