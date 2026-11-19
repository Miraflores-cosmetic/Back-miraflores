/**
 * Наименование позиции заказа / чека (54-ФЗ).
 * Приоритет: название из нац. каталога (+ оттенок), иначе витринное имя.
 */
export function orderItemTitle(opts: {
  nationalCatalogName?: string | null;
  name: string;
  variantName?: string | null;
  shadeName?: string | null;
}): string {
  const national = opts.nationalCatalogName?.trim() || '';
  if (national) {
    return [national, opts.shadeName?.trim() || null]
      .filter(Boolean)
      .join(' · ');
  }
  return [opts.name, opts.variantName, opts.shadeName]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .join(' · ');
}
