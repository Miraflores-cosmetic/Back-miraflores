import { describe, expect, it } from 'vitest';
import { GroupCategoryPriceType } from '@prisma/client';
import {
  buildCategoryParentMap,
  categoryAncestorIds,
  findNearestCategoryRule,
} from './category-tree.util';

describe('category-tree.util', () => {
  const parentById = buildCategoryParentMap([
    { id: 'root', parentId: null },
    { id: 'mid', parentId: 'root' },
    { id: 'leaf', parentId: 'mid' },
    { id: 'leaf2', parentId: 'mid' },
  ]);

  it('categoryAncestorIds walks up to root', () => {
    expect(categoryAncestorIds('leaf', parentById)).toEqual(['leaf', 'mid', 'root']);
  });

  it('findNearestCategoryRule picks most specific ancestor', () => {
    const rules = new Map([
      ['root', { type: GroupCategoryPriceType.PERCENT_OFF, value: 10 }],
      ['mid', { type: GroupCategoryPriceType.PERCENT_OFF, value: 20 }],
    ]);
    expect(findNearestCategoryRule('leaf', rules, parentById)?.value).toBe(20);
  });

  it('findNearestCategoryRule uses leaf when present', () => {
    const rules = new Map([
      ['mid', { type: GroupCategoryPriceType.FIXED_PRICE, value: 500 }],
      ['leaf', { type: GroupCategoryPriceType.FIXED_PRICE, value: 400 }],
    ]);
    expect(findNearestCategoryRule('leaf', rules, parentById)?.value).toBe(400);
  });

  it('findNearestCategoryRule returns null when no rule', () => {
    const rules = new Map([['leaf2', { type: GroupCategoryPriceType.FIXED_OFF, value: 50 }]]);
    expect(findNearestCategoryRule('leaf', rules, parentById)).toBeNull();
  });
});
