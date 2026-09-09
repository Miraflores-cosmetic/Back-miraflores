import { describe, expect, it } from 'vitest';
import {
  ADMIN_NAV,
  canSeeSection,
  filterAdminNav,
  initialOpenGroups,
  isGroupPathActive,
  isNavLinkActive,
} from './adminNav';
import type { StaffContext } from '@/lib/adminStaffTypes';

const moderatorOrders: StaffContext = {
  isSuperAdmin: false,
  sections: ['orders'],
  staffDisplayName: null,
  staffAvatarUrl: null,
};

const superAdmin: StaffContext = {
  isSuperAdmin: true,
  sections: ['dashboard', 'catalog', 'orders', 'settings', 'assistant'],
  staffDisplayName: null,
  staffAvatarUrl: null,
};

describe('canSeeSection', () => {
  it('dashboard всегда виден модератору', () => {
    expect(canSeeSection('dashboard', moderatorOrders)).toBe(true);
  });

  it('staff CRUD только суперадмин', () => {
    expect(canSeeSection('staff', moderatorOrders)).toBe(false);
    expect(canSeeSection('staff', superAdmin)).toBe(true);
  });

  it('без staff context → deny', () => {
    expect(canSeeSection('orders', null)).toBe(false);
  });

  it('orders_finance видит пункт «Заказы»', () => {
    const financeOnly: StaffContext = {
      isSuperAdmin: false,
      sections: ['orders_finance'],
      staffDisplayName: null,
      staffAvatarUrl: null,
    };
    expect(canSeeSection('orders', financeOnly)).toBe(true);
  });

  it('certificates_finance видит пункт «Сертификаты»', () => {
    const financeOnly: StaffContext = {
      isSuperAdmin: false,
      sections: ['certificates_finance'],
      staffDisplayName: null,
      staffAvatarUrl: null,
    };
    expect(canSeeSection('certificates', financeOnly)).toBe(true);
  });
});

describe('filterAdminNav', () => {
  it('модератор с orders видит заказы, не видит каталог', () => {
    const nav = filterAdminNav(ADMIN_NAV, moderatorOrders);
    const labels = nav.flatMap((item) => {
      if (item.type === 'link') return [item.label];
      if (item.type === 'group') return item.children.map((c) => c.label);
      return [];
    });
    expect(labels).toContain('Заказы');
    expect(labels).not.toContain('Товары');
    expect(labels).not.toContain('Сотрудники');
  });

  it('суперадмин видит staff в настройках', () => {
    const nav = filterAdminNav(ADMIN_NAV, superAdmin);
    const labels = nav.flatMap((item) =>
      item.type === 'group' ? item.children.map((c) => c.label) : [],
    );
    expect(labels).toContain('Сотрудники');
  });

  it('пустой staff → только dashboard (если бы был link)', () => {
    const nav = filterAdminNav(ADMIN_NAV, {
      isSuperAdmin: false,
      sections: [],
      staffDisplayName: null,
      staffAvatarUrl: null,
    });
    expect(nav.some((i) => i.type === 'link' && i.href === '/admin')).toBe(true);
    expect(nav.some((i) => i.type === 'link' && i.href === '/admin/orders')).toBe(false);
  });
});

describe('isNavLinkActive', () => {
  it('exact match для дашборда', () => {
    expect(isNavLinkActive('/admin', '/admin', true)).toBe(true);
    expect(isNavLinkActive('/admin/orders', '/admin', true)).toBe(false);
  });
});

describe('isGroupPathActive', () => {
  it('исключает staff profile из settings group', () => {
    const settingsGroup = ADMIN_NAV.find(
      (i) => i.type === 'group' && i.id === 'settings',
    );
    expect(settingsGroup?.type).toBe('group');
    if (settingsGroup?.type !== 'group') return;
    expect(isGroupPathActive(settingsGroup, '/admin/settings/staff/me')).toBe(false);
    expect(isGroupPathActive(settingsGroup, '/admin/settings/seo')).toBe(true);
  });

  it('user-groups открывает Users, не Settings', () => {
    const usersGroup = ADMIN_NAV.find((i) => i.type === 'group' && i.id === 'users');
    const settingsGroup = ADMIN_NAV.find((i) => i.type === 'group' && i.id === 'settings');
    expect(usersGroup?.type).toBe('group');
    expect(settingsGroup?.type).toBe('group');
    if (usersGroup?.type !== 'group' || settingsGroup?.type !== 'group') return;
    expect(isGroupPathActive(usersGroup, '/admin/settings/user-groups/abc')).toBe(true);
    expect(isGroupPathActive(settingsGroup, '/admin/settings/user-groups/abc')).toBe(false);
  });
});

describe('initialOpenGroups', () => {
  it('открывает site group на /admin/faq', () => {
    const open = initialOpenGroups('/admin/faq');
    expect(open.site).toBe(true);
    expect(open.settings).toBe(false);
  });
});
