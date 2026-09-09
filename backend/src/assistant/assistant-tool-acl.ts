import type { AdminSectionId } from '@miraflores/admin-sections';

/**
 * Секция(и), нужные для tool. Несколько = достаточно любой (OR).
 * `assistant` сам по себе tools не даёт — только доступ к API чата.
 */
export const ASSISTANT_TOOL_SECTIONS: Record<string, AdminSectionId | AdminSectionId[]> = {
  get_dashboard_overview: 'dashboard',
  sales_timeseries: 'dashboard',
  compare_periods: 'dashboard',
  top_products: 'dashboard',
  funnel_lite: 'orders',
  list_orders: 'orders',
  search_products: 'catalog',
  list_oos_variants: 'catalog',
  content_gaps: ['blog', 'settings'],
  list_user_groups: 'users',
  get_user_group: 'users',
  list_discounts: 'discounts',
  get_discount: 'discounts',
  list_promo_codes: 'discounts',
  get_promo_code: 'discounts',
  list_catalog_visibility: ['users', 'catalog'],
};

export function staffCanUseAssistantTool(
  toolName: string,
  sections: readonly string[],
  isSuperAdmin: boolean,
): boolean {
  if (isSuperAdmin) return true;
  const need = ASSISTANT_TOOL_SECTIONS[toolName];
  if (!need) return false;
  const required = Array.isArray(need) ? need : [need];
  const set = new Set(sections);
  return required.some((s) => set.has(s));
}

export function filterAssistantToolNames(
  toolNames: readonly string[],
  sections: readonly string[],
  isSuperAdmin: boolean,
): string[] {
  return toolNames.filter((name) =>
    staffCanUseAssistantTool(name, sections, isSuperAdmin),
  );
}

/** Какие области content_gaps доступны по секциям staff. */
export function contentGapScopesForStaff(
  sections: readonly string[],
  isSuperAdmin: boolean,
): Array<'faq' | 'pages' | 'blog' | 'hero'> {
  if (isSuperAdmin) return ['faq', 'pages', 'blog', 'hero'];
  const set = new Set(sections);
  const scopes: Array<'faq' | 'pages' | 'blog' | 'hero'> = [];
  if (set.has('settings')) {
    scopes.push('faq', 'pages', 'hero');
  }
  if (set.has('blog')) {
    scopes.push('blog');
  }
  return scopes;
}
