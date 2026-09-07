import type { AdminSectionId } from '@/lib/adminSections';
import type { StaffContext } from '@/lib/adminStaffTypes';
import {
  staffCanSeeCertificatesNav,
  staffCanSeeOrdersNav,
} from '@miraflores/admin-sections';

export type NavChild = {
  href: string;
  label: string;
  section?: AdminSectionId | 'staff';
};

export type NavLinkItem = {
  type: 'link';
  href: string;
  label: string;
  exact?: boolean;
  section: AdminSectionId;
};

export type NavGroupItem = {
  type: 'group';
  /** Stable key for open-state (not the visible label). */
  id: string;
  label: string;
  children: NavChild[];
  /** Path prefixes that keep this group open. */
  prefixes: string[];
  /** Paths that must not keep the group open (e.g. profile under /settings). */
  excludePaths?: string[];
  section: AdminSectionId;
};

export type NavDividerItem = { type: 'divider' };

export type NavItem = NavLinkItem | NavGroupItem | NavDividerItem;

export const ADMIN_NAV: NavItem[] = [
  { type: 'link', href: '/admin', label: 'Дашборд', exact: true, section: 'dashboard' },
  {
    type: 'group',
    id: 'catalog',
    label: 'Каталог',
    section: 'catalog',
    prefixes: [
      '/admin/catalog',
      '/admin/collections',
      '/admin/product-sets',
      '/admin/products',
      '/admin/certificates',
    ],
    children: [
      { href: '/admin/catalog/products', label: 'Товары', section: 'catalog' },
      { href: '/admin/catalog/categories', label: 'Категории', section: 'catalog' },
      { href: '/admin/catalog/tags', label: 'Контекстные теги', section: 'catalog' },
      { href: '/admin/collections', label: 'Коллекции', section: 'catalog' },
      { href: '/admin/product-sets', label: 'Наборы', section: 'catalog' },
      { href: '/admin/certificates', label: 'Сертификаты', section: 'certificates' },
    ],
  },
  {
    type: 'group',
    id: 'discounts',
    label: 'Скидки',
    section: 'discounts',
    prefixes: ['/admin/discounts', '/admin/promo'],
    children: [
      { href: '/admin/discounts', label: 'Акции', section: 'discounts' },
      { href: '/admin/promo', label: 'Промокоды', section: 'discounts' },
    ],
  },
  {
    type: 'group',
    id: 'blog',
    label: 'Блог',
    section: 'blog',
    prefixes: ['/admin/pages', '/admin/blog'],
    children: [
      { href: '/admin/pages', label: 'Страницы', section: 'blog' },
    ],
  },
  { type: 'link', href: '/admin/reviews', label: 'Отзывы', section: 'reviews' },
  {
    type: 'group',
    id: 'site',
    label: 'Сайт',
    section: 'settings',
    prefixes: [
      '/admin/faq',
      '/admin/quiz',
      '/admin/hero',
      '/admin/homepage-sets',
      '/admin/settings/home',
      '/admin/settings/menu',
    ],
    children: [
      { href: '/admin/hero', label: 'Hero', section: 'settings' },
      { href: '/admin/homepage-sets', label: 'Наборы на главной', section: 'settings' },
      { href: '/admin/faq', label: 'FAQ', section: 'settings' },
      { href: '/admin/quiz', label: 'Квиз', section: 'settings' },
      { href: '/admin/settings/menu', label: 'Меню', section: 'settings' },
    ],
  },
  { type: 'divider' },
  { type: 'link', href: '/admin/orders', label: 'Заказы', section: 'orders' },
  { type: 'link', href: '/admin/users', label: 'Пользователи', section: 'users' },
  { type: 'divider' },
  {
    type: 'group',
    id: 'settings',
    label: 'Настройки',
    section: 'settings',
    prefixes: ['/admin/settings', '/admin/cart'],
    excludePaths: [
      '/admin/settings/staff/me',
      '/admin/settings/home',
      '/admin/settings/menu',
    ],
    children: [
      { href: '/admin/settings/seo', label: 'SEO', section: 'settings' },
      { href: '/admin/cart', label: 'Корзина', section: 'settings' },
      { href: '/admin/settings/gratitude', label: 'Программа благодарности', section: 'settings' },
      { href: '/admin/settings/staff', label: 'Сотрудники', section: 'staff' },
    ],
  },
];

export function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isNavLinkActive(
  pathname: string,
  href: string,
  exact?: boolean,
): boolean {
  if (exact) return pathname === href;
  return pathMatchesPrefix(pathname, href);
}

export function isGroupPathActive(item: NavGroupItem, pathname: string): boolean {
  if (item.excludePaths?.some((p) => pathMatchesPrefix(pathname, p))) {
    return false;
  }
  return item.prefixes.some((p) => pathMatchesPrefix(pathname, p));
}

export function canSeeSection(
  section: AdminSectionId | 'staff',
  staff: StaffContext | null | undefined,
): boolean {
  if (!staff) return false;
  if (staff.isSuperAdmin) return true;
  if (section === 'staff') return false;
  if (section === 'dashboard') return true;
  if (section === 'orders') {
    return staffCanSeeOrdersNav(staff.sections, staff.isSuperAdmin);
  }
  if (section === 'certificates') {
    return staffCanSeeCertificatesNav(staff.sections, staff.isSuperAdmin);
  }
  return staff.sections.includes(section);
}

/** ACL-filtered nav; collapses empty groups and duplicate/trailing dividers. */
export function filterAdminNav(
  nav: readonly NavItem[],
  staff: StaffContext | null | undefined,
): NavItem[] {
  const out: NavItem[] = [];
  for (const item of nav) {
    if (item.type === 'divider') {
      if (out.length > 0 && out[out.length - 1]?.type !== 'divider') {
        out.push(item);
      }
      continue;
    }
    if (item.type === 'link') {
      if (canSeeSection(item.section, staff)) out.push(item);
      continue;
    }
    const children = item.children.filter((c) => {
      if (c.section === 'staff') return Boolean(staff?.isSuperAdmin);
      return canSeeSection((c.section ?? item.section) as AdminSectionId, staff);
    });
    if (children.length === 0) continue;
    out.push({ ...item, children });
  }
  while (out.length > 0 && out[out.length - 1]?.type === 'divider') {
    out.pop();
  }
  return out;
}

/** Route-driven open map keyed by group id. */
export function initialOpenGroups(
  pathname: string,
  nav: readonly NavItem[] = ADMIN_NAV,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const item of nav) {
    if (item.type === 'group') {
      out[item.id] = isGroupPathActive(item, pathname);
    }
  }
  return out;
}
