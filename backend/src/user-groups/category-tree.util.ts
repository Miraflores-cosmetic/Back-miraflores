export type CategoryParentMap = ReadonlyMap<string, string | null>;

export type CategoryPriceRule = {
  type: import('@prisma/client').GroupCategoryPriceType;
  value: number;
};

/** Product category → parent → … → root (most specific first). */
export function categoryAncestorIds(
  categoryId: string,
  parentById: CategoryParentMap,
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = categoryId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = parentById.get(cur) ?? null;
  }
  return chain;
}

/** Nearest (most specific) category rule on the ancestor chain. */
export function findNearestCategoryRule(
  categoryId: string,
  rulesByCategoryId: ReadonlyMap<string, CategoryPriceRule>,
  parentById: CategoryParentMap,
): CategoryPriceRule | null {
  for (const id of categoryAncestorIds(categoryId, parentById)) {
    const rule = rulesByCategoryId.get(id);
    if (rule) return rule;
  }
  return null;
}

export function buildCategoryParentMap(
  rows: ReadonlyArray<{ id: string; parentId: string | null }>,
): CategoryParentMap {
  return new Map(rows.map((r) => [r.id, r.parentId]));
}
