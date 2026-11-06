/** Путь PLP как на витрине (см. Front `buildCategoryCatalogHref`). */

export type CategorySlugRow = {
  id: string;
  slug: string;
  parentId: string | null;
  updatedAt: Date;
};

/**
 * Для цепочки root → … → leaf: `/catalog/{root}` или `/catalog/{root}/{leaf}`.
 * Промежуточные уровни в URL не участвуют (как во Front).
 */
export function categoryRowToCatalogPath(
  leaf: CategorySlugRow,
  byId: ReadonlyMap<string, CategorySlugRow>,
): string {
  const chain: CategorySlugRow[] = [];
  let cur: CategorySlugRow | undefined = leaf;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  if (!chain.length) {
    return `/catalog/${encodeURIComponent(leaf.slug)}`;
  }
  const root = chain[0]!;
  const last = chain[chain.length - 1]!;
  if (root.id === last.id) {
    return `/catalog/${encodeURIComponent(last.slug)}`;
  }
  if (root.slug === last.slug) {
    return `/catalog/${encodeURIComponent(root.slug)}`;
  }
  return `/catalog/${encodeURIComponent(root.slug)}/${encodeURIComponent(last.slug)}`;
}

export function uniqueCategoryCatalogPaths(
  rows: readonly CategorySlugRow[],
): Map<string, Date> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pathToLastmod = new Map<string, Date>();
  for (const row of rows) {
    const path = categoryRowToCatalogPath(row, byId);
    const prev = pathToLastmod.get(path);
    if (!prev || row.updatedAt > prev) {
      pathToLastmod.set(path, row.updatedAt);
    }
  }
  return pathToLastmod;
}
