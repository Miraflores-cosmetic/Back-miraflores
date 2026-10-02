import { describe, expect, it } from 'vitest';
import { adminPathAllowed } from './adminPathAllowed';
import type { StaffContext } from './adminStaffTypes';

describe('adminPathAllowed', () => {
  const moderatorOrders: StaffContext = {
    isSuperAdmin: false,
    sections: ['orders'],
    staffDisplayName: null,
    staffAvatarUrl: null,
  };

  const superAdmin: StaffContext = {
    isSuperAdmin: true,
    sections: ['dashboard'],
    staffDisplayName: null,
    staffAvatarUrl: null,
  };

  it('deny without staff', () => {
    expect(adminPathAllowed('/admin/orders', null)).toBe(false);
    expect(adminPathAllowed('/admin/catalog/products', undefined)).toBe(false);
  });

  it('moderator: orders yes, catalog no', () => {
    expect(adminPathAllowed('/admin/orders', moderatorOrders)).toBe(true);
    expect(adminPathAllowed('/admin/orders/abc', moderatorOrders)).toBe(true);
    expect(adminPathAllowed('/admin/catalog/products', moderatorOrders)).toBe(false);
  });

  it('staff CRUD path только суперадмин', () => {
    expect(adminPathAllowed('/admin/settings/staff', moderatorOrders)).toBe(false);
    expect(adminPathAllowed('/admin/settings/staff', superAdmin)).toBe(true);
  });

  it('staff profile (/me) доступен модератору', () => {
    expect(adminPathAllowed('/admin/settings/staff/me', moderatorOrders)).toBe(true);
  });

  it('dashboard (/admin) всегда доступен модератору', () => {
    expect(adminPathAllowed('/admin', moderatorOrders)).toBe(true);
  });

  it('orders_finance без orders — список заказов доступен', () => {
    const financeOnly: StaffContext = {
      isSuperAdmin: false,
      sections: ['orders_finance'],
      staffDisplayName: null,
      staffAvatarUrl: null,
    };
    expect(adminPathAllowed('/admin/orders', financeOnly)).toBe(true);
  });

  it('settings hub только суперадмин', () => {
    const moderatorSettings: StaffContext = {
      isSuperAdmin: false,
      sections: ['settings'],
      staffDisplayName: null,
      staffAvatarUrl: null,
    };
    expect(adminPathAllowed('/admin/settings', moderatorSettings)).toBe(false);
    expect(adminPathAllowed('/admin/settings/seo', moderatorSettings)).toBe(true);
    expect(adminPathAllowed('/admin/settings', superAdmin)).toBe(true);
  });

  it('homepage-sets / hero — grant settings (не только суперадмин)', () => {
    const moderatorSettings: StaffContext = {
      isSuperAdmin: false,
      sections: ['settings'],
      staffDisplayName: null,
      staffAvatarUrl: null,
    };
    expect(adminPathAllowed('/admin/homepage-sets', moderatorSettings)).toBe(true);
    expect(adminPathAllowed('/admin/hero', moderatorSettings)).toBe(true);
    expect(adminPathAllowed('/admin/faq', moderatorSettings)).toBe(true);
    expect(adminPathAllowed('/admin/settings/promo', moderatorSettings)).toBe(true);
  });

  it('discounts — нужен grant discounts', () => {
    const withDiscounts: StaffContext = {
      isSuperAdmin: false,
      sections: ['discounts'],
      staffDisplayName: null,
      staffAvatarUrl: null,
    };
    const without: StaffContext = {
      isSuperAdmin: false,
      sections: ['settings'],
      staffDisplayName: null,
      staffAvatarUrl: null,
    };
    expect(adminPathAllowed('/admin/discounts', withDiscounts)).toBe(true);
    expect(adminPathAllowed('/admin/discounts/new', withDiscounts)).toBe(true);
    expect(adminPathAllowed('/admin/promo', withDiscounts)).toBe(true);
    expect(adminPathAllowed('/admin/discounts', without)).toBe(false);
  });
});
