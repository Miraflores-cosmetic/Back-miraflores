/**
 * Единый источник ACL админки Miraflores (pathname + API path).
 *
 * Новый admin-модуль — чеклист:
 * 1. Здесь: `resolveAdminSectionFromApiPath` + `ADMIN_BACKEND_BFF_PREFIXES` (+ sample в index.spec.ts)
 * 2. Admin: href в `adminNav.ts` (+ `adminNavSync.spec.ts` должен проходить)
 * 3. Nest: `@AdminOnly()` / guards на controller; BFF allowlist подхватит prefix из п.1
 */

export const ADMIN_SECTION_DASHBOARD = 'dashboard' as const;

export const ADMIN_SECTION_IDS = [
  ADMIN_SECTION_DASHBOARD,
  'catalog',
  'users',
  'blog',
  'reviews',
  'discounts',
  'certificates',
  'orders',
  /** mark-paid / refund — отдельно от просмотра и фулфилмента заказов. */
  'orders_finance',
  'settings',
  /** LLM-ассистент (FAB + API); не входит в дашборд автоматически. */
  'assistant',
] as const;

export type AdminSectionId = (typeof ADMIN_SECTION_IDS)[number];

/** Разделы, которые можно назначить MODERATOR (дашборд — всегда). */
export const MODERATOR_ASSIGNABLE_SECTIONS = ADMIN_SECTION_IDS.filter(
  (id) => id !== ADMIN_SECTION_DASHBOARD,
) as Exclude<AdminSectionId, typeof ADMIN_SECTION_DASHBOARD>[];

export type ModeratorAssignableSectionId = (typeof MODERATOR_ASSIGNABLE_SECTIONS)[number];

export const ALL_STAFF_SECTIONS_WITH_DASHBOARD: readonly AdminSectionId[] = [
  ...ADMIN_SECTION_IDS,
];

export function isAdminSectionId(value: string): value is AdminSectionId {
  return (ADMIN_SECTION_IDS as readonly string[]).includes(value);
}

export function normalizeStoredAdminSections(
  raw: readonly string[],
): ModeratorAssignableSectionId[] {
  const seen = new Set<ModeratorAssignableSectionId>();
  for (const item of raw) {
    if (
      isAdminSectionId(item) &&
      item !== ADMIN_SECTION_DASHBOARD &&
      (MODERATOR_ASSIGNABLE_SECTIONS as readonly string[]).includes(item)
    ) {
      seen.add(item as ModeratorAssignableSectionId);
    }
  }
  return MODERATOR_ASSIGNABLE_SECTIONS.filter((id) => seen.has(id));
}

export const ADMIN_SECTION_LABELS_RU: Record<AdminSectionId, string> = {
  dashboard: 'Дашборд',
  catalog: 'Каталог',
  users: 'Пользователи',
  blog: 'Блог',
  reviews: 'Отзывы',
  discounts: 'Скидки и промо',
  certificates: 'Сертификаты',
  orders: 'Заказы',
  orders_finance: 'Заказы: оплата и возвраты',
  settings: 'Настройки',
  assistant: '🤦‍♀️ Ассистент',
};

export type AdminApiAccessTarget = AdminSectionId | 'staff';

/**
 * Префиксы Nest admin API, разрешённые через Next BFF (`/api/admin/backend/...`).
 * Должны покрывать все пути, для которых `resolveAdminSectionFromApiPath` ≠ null
 * (кроме публичных / не-admin маршрутов).
 */
export const ADMIN_BACKEND_BFF_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['catalog', 'admin'],
  ['users', 'admin'],
  ['dashboard', 'admin'],
  ['discounts', 'admin'],
  ['promo', 'admin'],
  ['orders', 'admin'],
  ['blog', 'admin'],
  ['cms', 'admin'],
  ['reviews', 'admin'],
  ['gift-certificates', 'admin'],
  ['settings', 'admin'],
  ['quiz', 'admin'],
  ['assistant', 'admin'],
  ['auth', 'admin'],
] as const;

/** Первые два сегмента BFF-пути (`segments` из `[...segments]`). */
export function adminApiPathToBffPrefix(pathOnly: string): [string, string] | null {
  const p = pathOnly.split('?')[0].replace(/\/+$/, '');
  const rest = p.replace(/^\/api\/v1\/?/, '').replace(/^\//, '');
  const parts = rest.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return [parts[0], parts[1]];
}

/** Allowlist прокси `/api/admin/backend/...` → Nest `/api/v1/...`. */
export function isAllowedAdminBackendPath(segments: string[]): boolean {
  if (segments.length < 2) return false;
  const [a, b] = segments;
  return ADMIN_BACKEND_BFF_PREFIXES.some(([prefix, second]) => prefix === a && second === b);
}

/**
 * Nest API path (без query).
 * Профиль сотрудника: `/settings/admin/staff-profile` (не под `/staff/:id`).
 * CRUD staff: `/settings/admin/staff` — только суперадмин.
 * mark-paid / refund — секция `orders_finance`, остальной orders API — `orders`.
 */
export function resolveAdminSectionFromApiPath(pathOnly: string): AdminApiAccessTarget | null {
  const p = pathOnly.split('?')[0].replace(/\/+$/, '');

  if (p.includes('/settings/admin/staff-profile')) return 'dashboard';
  if (p.includes('/settings/admin/staff')) return 'staff';

  if (p.includes('/users/admin')) return 'users';
  if (
    p.includes('/orders/admin/') &&
    (p.endsWith('/mark-paid') || p.endsWith('/refund'))
  ) {
    return 'orders_finance';
  }
  if (p.includes('/orders/admin')) return 'orders';
  if (p.includes('/blog/admin')) return 'blog';
  if (p.includes('/cms/admin')) return 'blog';
  if (p.includes('/reviews/admin')) return 'reviews';
  if (p.includes('/discounts/admin')) return 'discounts';
  if (p.includes('/promo/admin')) return 'discounts';
  if (p.includes('/gift-certificates/admin')) return 'certificates';
  if (p.includes('/quiz/admin')) return 'settings';
  if (p.includes('/assistant/admin')) return 'assistant';
  if (p.includes('/dashboard/admin')) return 'dashboard';
  if (p.includes('/settings/admin/')) return 'settings';
  if (p.includes('/catalog/admin')) return 'catalog';
  if (p.includes('/auth/admin/me') || p.endsWith('/auth/me')) return 'dashboard';

  return null;
}

export type AdminPathAccessTarget = AdminSectionId | 'staff';

/** Next.js pathname админки. */
export function resolveAdminSectionFromPathname(pathname: string): AdminPathAccessTarget | null {
  const p = pathname.replace(/\/+$/, '') || '/';

  if (p === '/admin/login') return null;
  if (p === '/admin/settings/staff/me') return ADMIN_SECTION_DASHBOARD;
  if (p === '/admin') return ADMIN_SECTION_DASHBOARD;

  if (p === '/admin/settings/staff' || p.startsWith('/admin/settings/staff/')) {
    return 'staff';
  }

  if (p.startsWith('/admin/faq')) return 'settings';
  if (p.startsWith('/admin/quiz')) return 'settings';
  if (
    p.startsWith('/admin/hero') ||
    p.startsWith('/admin/homepage-sets') ||
    p.startsWith('/admin/settings/hero') ||
    p.startsWith('/admin/settings/home')
  ) {
    return 'settings';
  }
  if (p.startsWith('/admin/cart') || p.startsWith('/admin/delivery')) return 'settings';
  /** Hub «Настройки» — только суперадмин; deep links (`/admin/settings/seo`, FAQ…) — grant `settings`. */
  if (p === '/admin/settings') return 'staff';
  if (p.startsWith('/admin/settings/')) return 'settings';
  if (
    p.startsWith('/admin/catalog') ||
    p.startsWith('/admin/collections') ||
    p.startsWith('/admin/product-sets') ||
    p.startsWith('/admin/products')
  ) {
    return 'catalog';
  }
  if (p.startsWith('/admin/users')) return 'users';
  if (p.startsWith('/admin/blog') || p.startsWith('/admin/pages')) return 'blog';
  if (p.startsWith('/admin/reviews')) return 'reviews';
  if (p.startsWith('/admin/discounts') || p.startsWith('/admin/promo')) return 'discounts';
  if (p.startsWith('/admin/certificates')) return 'certificates';
  if (p.startsWith('/admin/orders')) return 'orders';

  return null;
}

export function staffCanAccessAdminPath(
  pathname: string,
  sections: readonly AdminSectionId[],
  isSuperAdmin: boolean,
): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/admin/login') return true;
  if (isSuperAdmin) return true;

  const target = resolveAdminSectionFromPathname(pathname);
  if (target == null) return false;
  if (target === 'staff') return false;
  if (target === ADMIN_SECTION_DASHBOARD) return true;
  if (target === 'orders') {
    return staffCanAccessOrdersUi(sections, isSuperAdmin);
  }
  return sections.includes(target);
}

/** Список/карточка заказов в UI — grant `orders` или `orders_finance`. */
export function staffCanAccessOrdersUi(
  sections: readonly string[],
  isSuperAdmin: boolean,
): boolean {
  if (isSuperAdmin) return true;
  return sections.includes('orders') || sections.includes('orders_finance');
}

/** Nav «Заказы» — тот же критерий, что и UI заказов. */
export function staffCanSeeOrdersNav(
  sections: readonly string[],
  isSuperAdmin: boolean,
): boolean {
  return staffCanAccessOrdersUi(sections, isSuperAdmin);
}

/** Суперадмин или явный grant `orders_finance`. */
export function staffCanOrdersFinance(
  sections: readonly string[],
  isSuperAdmin: boolean,
): boolean {
  if (isSuperAdmin) return true;
  return sections.includes('orders_finance');
}

/** Суперадмин или явный grant `assistant` (FAB + API). */
export function staffCanAssistant(
  sections: readonly string[],
  isSuperAdmin: boolean,
): boolean {
  if (isSuperAdmin) return true;
  return sections.includes('assistant');
}

/** Разделы, которым в UI часто нужен catalog (пикеры товаров/категорий). */
export const SECTIONS_NEEDING_CATALOG: readonly ModeratorAssignableSectionId[] = [
  'discounts',
  'certificates',
  'reviews',
];

export function sectionsMissingCatalogHint(
  sections: readonly string[],
): ModeratorAssignableSectionId[] {
  const set = new Set(sections);
  if (set.has('catalog')) return [];
  return SECTIONS_NEEDING_CATALOG.filter((id) => set.has(id));
}

/** `orders_finance` без `orders` — UI заказов есть, packing/фулфилмент API — нет. */
export const SECTIONS_NEEDING_FULFILLMENT: readonly ModeratorAssignableSectionId[] = [
  'orders_finance',
];

/** @deprecated используйте SECTIONS_NEEDING_FULFILLMENT */
export const SECTIONS_NEEDING_ORDERS = SECTIONS_NEEDING_FULFILLMENT;

export function sectionsMissingFulfillmentHint(
  sections: readonly string[],
): ModeratorAssignableSectionId[] {
  const set = new Set(sections);
  if (set.has('orders')) return [];
  return SECTIONS_NEEDING_FULFILLMENT.filter((id) => set.has(id));
}

/** @deprecated используйте sectionsMissingFulfillmentHint */
export function sectionsMissingOrdersHint(
  sections: readonly string[],
): ModeratorAssignableSectionId[] {
  return sectionsMissingFulfillmentHint(sections);
}
