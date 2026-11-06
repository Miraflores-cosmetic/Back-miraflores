import type { CategorySlugRow } from './category-catalog-path.util';

/** PLP path /catalog, /catalog/:root, /catalog/:root/:leaf — leaf любого уровня под root. */
export function isValidCatalogListPath(
  cat: string,
  sub: string,
  rows: readonly Pick<CategorySlugRow, 'id' | 'slug' | 'parentId'>[],
): boolean {
  if (!cat && !sub) return true;
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (cat && !sub) {
    const root = rows.find((r) => r.slug === cat && !r.parentId);
    return Boolean(root);
  }
  if (cat && sub) {
    const root = rows.find((r) => r.slug === cat && !r.parentId);
    const leaf = rows.find((r) => r.slug === sub);
    if (!root || !leaf) return false;
    return isCategoryUnderRoot(leaf, root.id, byId);
  }
  return false;
}

function isCategoryUnderRoot(
  leaf: Pick<CategorySlugRow, 'id' | 'parentId'>,
  rootId: string,
  byId: ReadonlyMap<string, Pick<CategorySlugRow, 'id' | 'parentId'>>,
): boolean {
  let cur: typeof leaf | undefined = leaf;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.parentId === rootId) return true;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return false;
}
