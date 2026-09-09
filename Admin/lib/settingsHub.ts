import {
  staffCanAccessAdminPath,
  type AdminSectionId,
} from '@miraflores/admin-sections';
import type { StaffContext } from '@/lib/adminStaffTypes';

export type SettingsHubLink = {
  href: string;
  label: string;
  section: AdminSectionId | 'staff';
  /** Hub badge: grant для доступа, если ≠ settings. */
  aclBadge?: string;
};

/** Карточки hub `/admin/settings` — hub только суперадмин; фильтр для консистентности ACL. */
export const SETTINGS_HUB_LINKS: readonly SettingsHubLink[] = [
  { href: '/admin/settings/seo', label: 'SEO', section: 'settings' },
  { href: '/admin/settings/menu', label: 'Меню', section: 'settings' },
  { href: '/admin/settings/attributes', label: 'Атрибуты', section: 'settings' },
  {
    href: '/admin/settings/user-groups',
    label: 'Группы пользователей',
    section: 'users',
    aclBadge: 'Пользователи',
  },
  { href: '/admin/cart', label: 'Корзина', section: 'settings' },
  { href: '/admin/settings/gratitude', label: 'Программа благодарности', section: 'settings' },
  { href: '/admin/settings/staff', label: 'Сотрудники', section: 'staff' },
];

export function filterSettingsHubLinks(staff: StaffContext): SettingsHubLink[] {
  return SETTINGS_HUB_LINKS.filter((link) => {
    /** Hub только у суперадмина; группы — deep link под Users, не дублируем для grant-only. */
    if (link.href === '/admin/settings/user-groups' && !staff.isSuperAdmin) {
      return false;
    }
    return staffCanAccessAdminPath(
      link.href,
      staff.sections as AdminSectionId[],
      staff.isSuperAdmin,
    );
  });
}
