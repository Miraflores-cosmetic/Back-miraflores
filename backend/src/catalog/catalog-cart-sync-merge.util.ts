/** Merge key: variant + shade — иначе оттенки схлопываются и shadeId теряется. */
export function cartSyncLineKey(
  variantId: string,
  shadeId: string | null,
): string {
  return `${variantId}\0${shadeId ?? ''}`;
}

export type CartSyncMergedLine = {
  variantId: string;
  shadeId: string | null;
  qty: number;
};

/** Нормализация входа cart/sync: merge qty по variantId+shadeId. */
export function mergeCartSyncInputLines(
  lines: Array<{ variantId: string; shadeId?: string | null; qty: number }>,
  maxLines = 100,
): CartSyncMergedLine[] {
  const merged = new Map<string, CartSyncMergedLine>();
  for (const line of lines) {
    if (!line?.variantId || !Number.isFinite(line.qty) || line.qty <= 0) continue;
    const variantId = line.variantId.trim();
    const shadeId = line.shadeId?.trim() || null;
    const key = cartSyncLineKey(variantId, shadeId);
    const prev = merged.get(key);
    const qty = Math.floor(line.qty);
    if (prev) prev.qty += qty;
    else merged.set(key, { variantId, shadeId, qty });
  }
  return [...merged.values()].slice(0, maxLines);
}
