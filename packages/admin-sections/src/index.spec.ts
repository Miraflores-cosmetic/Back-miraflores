import { describe, expect, it } from 'vitest';
import {
  adminApiPathToBffPrefix,
  isAllowedAdminBackendPath,
  resolveAdminSectionFromApiPath,
  resolveAdminSectionFromPathname,
  sectionsMissingCatalogHint,
  sectionsMissingCertificatesCatalogHint,
  sectionsMissingFulfillmentHint,
  sectionsMissingOrdersHint,
  staffCanAccessAdminPath,
  staffCanAssistant,
  staffCanCertificatesFinance,
  staffCanOrdersFinance,
} from './index';

/** Представительные admin API paths — при добавлении модуля расширять и BFF prefix. */
const ADMIN_API_PATH_SAMPLES = [
  '/api/v1/settings/admin/staff-profile',
  '/api/v1/settings/admin/staff',
  '/api/v1/settings/admin/staff/abc',
  '/api/v1/settings/admin/faq',
  '/api/v1/settings/admin/product-attributes',
  '/api/v1/catalog/admin/product-attribute-options',
  '/api/v1/settings/admin/quiz-content',
  '/api/v1/quiz/admin/overview',
  '/api/v1/assistant/admin/chat',
  '/api/v1/settings/admin/gratitude',
  '/api/v1/catalog/admin/products',
  '/api/v1/promo/admin',
  '/api/v1/gift-certificates/admin/issue',
  '/api/v1/auth/admin/me',
  '/api/v1/orders/admin',
  '/api/v1/orders/admin/abc/mark-paid',
  '/api/v1/orders/admin/abc/refund',
  '/api/v1/orders/admin/abc/packing',
  '/api/v1/users/admin',
  '/api/v1/user-groups/admin',
  '/api/v1/catalog/admin/visibility',
  '/api/v1/dashboard/admin/summary',
  '/api/v1/discounts/admin',
  '/api/v1/blog/admin/posts',
  '/api/v1/cms/admin/pages',
  '/api/v1/reviews/admin',
] as const;

describe('isAllowedAdminBackendPath', () => {
  it('разрешает известные admin-префиксы', () => {
    expect(isAllowedAdminBackendPath(['gift-certificates', 'admin'])).toBe(true);
    expect(isAllowedAdminBackendPath(['orders', 'admin', 'x'])).toBe(true);
    expect(isAllowedAdminBackendPath(['auth', 'admin', 'me'])).toBe(true);
    expect(isAllowedAdminBackendPath(['quiz', 'admin'])).toBe(true);
    expect(isAllowedAdminBackendPath(['assistant', 'admin', 'chat'])).toBe(true);
  });

  it('отклоняет чужие пути', () => {
    expect(isAllowedAdminBackendPath(['gift-certificates'])).toBe(false);
    expect(isAllowedAdminBackendPath(['hack', 'admin'])).toBe(false);
    expect(isAllowedAdminBackendPath(['auth', 'me'])).toBe(false);
  });

  it('все sample API paths мапятся на разрешённый BFF prefix', () => {
    for (const path of ADMIN_API_PATH_SAMPLES) {
      expect(resolveAdminSectionFromApiPath(path), path).not.toBeNull();
      const prefix = adminApiPathToBffPrefix(path);
      expect(prefix, `${path} → prefix`).not.toBeNull();
      expect(isAllowedAdminBackendPath([...prefix!, 'probe']), path).toBe(true);
    }
  });
});

describe('resolveAdminSectionFromPathname', () => {
  it('matrix pathname → section', () => {
    const cases: Array<[string, string | null]> = [
      ['/admin/login', null],
      ['/admin', 'dashboard'],
      ['/admin/settings/staff/me', 'dashboard'],
      ['/admin/settings/staff', 'staff'],
      ['/admin/settings/staff/x', 'staff'],
      ['/admin/settings', 'staff'],
      ['/admin/settings/seo', 'settings'],
      ['/admin/catalog/products', 'catalog'],
      ['/admin/collections', 'catalog'],
      ['/admin/product-sets', 'catalog'],
      ['/admin/users', 'users'],
      ['/admin/settings/user-groups', 'users'],
      ['/admin/user-groups', 'users'],
      ['/admin/blog', 'blog'],
      ['/admin/pages', 'blog'],
      ['/admin/faq', 'settings'],
      ['/admin/quiz', 'settings'],
      ['/admin/settings/gratitude', 'settings'],
      ['/admin/cart', 'settings'],
      ['/admin/settings/home', 'settings'],
      ['/admin/settings/home/hero', 'settings'],
      ['/admin/settings/home/sets', 'settings'],
      ['/admin/settings/hero', 'settings'],
      ['/admin/hero', 'settings'],
      ['/admin/homepage-sets', 'settings'],
      ['/admin/delivery', 'settings'],
      ['/admin/discounts', 'discounts'],
      ['/admin/promo', 'discounts'],
      ['/admin/certificates', 'certificates'],
      ['/admin/certificates/issue', 'certificates'],
      ['/admin/orders', 'orders'],
    ];
    for (const [path, section] of cases) {
      expect(resolveAdminSectionFromPathname(path), path).toBe(section);
    }
  });
});

describe('resolveAdminSectionFromApiPath', () => {
  it('matrix API → section; staff-profile ≠ staff CRUD', () => {
    expect(resolveAdminSectionFromApiPath('/api/v1/settings/admin/staff-profile')).toBe(
      'dashboard',
    );
    expect(resolveAdminSectionFromApiPath('/api/v1/settings/admin/staff-profile/avatar')).toBe(
      'dashboard',
    );
    expect(resolveAdminSectionFromApiPath('/api/v1/settings/admin/staff-profile/reset-password')).toBe(
      'dashboard',
    );
    expect(resolveAdminSectionFromApiPath('/api/v1/settings/admin/staff')).toBe('staff');
    expect(resolveAdminSectionFromApiPath('/api/v1/settings/admin/staff/abc')).toBe('staff');
    expect(resolveAdminSectionFromApiPath('/api/v1/settings/admin/faq')).toBe('settings');
    expect(resolveAdminSectionFromApiPath('/api/v1/settings/admin/quiz-content')).toBe('settings');
    expect(resolveAdminSectionFromApiPath('/api/v1/quiz/admin/overview')).toBe('settings');
    expect(resolveAdminSectionFromApiPath('/api/v1/assistant/admin/chat')).toBe('assistant');
    expect(resolveAdminSectionFromApiPath('/api/v1/assistant/admin/threads')).toBe('assistant');
    expect(resolveAdminSectionFromApiPath('/api/v1/settings/admin/gratitude')).toBe('settings');
    expect(resolveAdminSectionFromApiPath('/api/v1/settings/applicable-gift')).toBe(null);
    expect(resolveAdminSectionFromApiPath('/api/v1/catalog/admin/products')).toBe('catalog');
    expect(resolveAdminSectionFromApiPath('/api/v1/promo/admin')).toBe('discounts');
    expect(resolveAdminSectionFromApiPath('/api/v1/gift-certificates/admin')).toBe(
      'certificates_read',
    );
    expect(resolveAdminSectionFromApiPath('/api/v1/gift-certificates/admin/issue')).toBe(
      'certificates_finance',
    );
    expect(
      resolveAdminSectionFromApiPath('/api/v1/gift-certificates/admin/abc/revoke'),
    ).toBe('certificates_finance');
    expect(
      resolveAdminSectionFromApiPath('/api/v1/gift-certificates/admin/denominations', 'GET'),
    ).toBe('certificates_read');
    expect(
      resolveAdminSectionFromApiPath('/api/v1/gift-certificates/admin/denominations', 'POST'),
    ).toBe('certificates');
    expect(resolveAdminSectionFromApiPath('/api/v1/auth/admin/me')).toBe('dashboard');
    expect(resolveAdminSectionFromApiPath('/api/v1/orders/admin')).toBe('orders');
    expect(resolveAdminSectionFromApiPath('/api/v1/orders/admin/abc')).toBe('orders');
    expect(resolveAdminSectionFromApiPath('/api/v1/orders/admin/abc/mark-paid')).toBe(
      'orders_finance',
    );
    expect(resolveAdminSectionFromApiPath('/api/v1/orders/admin/abc/refund')).toBe(
      'orders_finance',
    );
    expect(resolveAdminSectionFromApiPath('/api/v1/orders/admin/abc/packing')).toBe('orders');
  });
});

describe('staffCanAccessAdminPath', () => {
  it('staff CRUD только суперадмин', () => {
    expect(staffCanAccessAdminPath('/admin/settings/staff', ['settings'], false)).toBe(false);
    expect(staffCanAccessAdminPath('/admin/settings/staff', ['settings'], true)).toBe(true);
    expect(staffCanAccessAdminPath('/admin/settings/staff/me', [], false)).toBe(true);
  });

  it('модератор видит только свои разделы', () => {
    expect(staffCanAccessAdminPath('/admin/orders', ['orders'], false)).toBe(true);
    expect(staffCanAccessAdminPath('/admin/catalog/products', ['orders'], false)).toBe(false);
  });

  it('orders_finance без orders — UI заказов доступен', () => {
    expect(staffCanAccessAdminPath('/admin/orders', ['orders_finance'], false)).toBe(true);
    expect(staffCanAccessAdminPath('/admin/orders/abc', ['orders_finance'], false)).toBe(true);
  });

  it('certificates_finance без certificates — UI сертификатов доступен', () => {
    expect(
      staffCanAccessAdminPath('/admin/certificates', ['certificates_finance'], false),
    ).toBe(true);
  });

  it('settings hub только суперадмин', () => {
    expect(staffCanAccessAdminPath('/admin/settings', ['settings'], false)).toBe(false);
    expect(staffCanAccessAdminPath('/admin/settings', ['settings'], true)).toBe(true);
    expect(staffCanAccessAdminPath('/admin/settings/seo', ['settings'], false)).toBe(true);
  });
});

describe('sectionsMissingCatalogHint', () => {
  it('подсказывает catalog для discounts / certificates / reviews', () => {
    expect(sectionsMissingCatalogHint(['discounts'])).toEqual(['discounts']);
    expect(sectionsMissingCatalogHint(['discounts', 'catalog'])).toEqual([]);
    expect(sectionsMissingCatalogHint(['reviews'])).toEqual(['reviews']);
    expect(sectionsMissingCatalogHint(['reviews', 'catalog'])).toEqual([]);
    expect(sectionsMissingCatalogHint(['certificates', 'reviews'])).toEqual([
      'certificates',
      'reviews',
    ]);
  });
});

describe('sectionsMissingFulfillmentHint', () => {
  it('подсказывает orders для orders_finance без grant orders', () => {
    expect(sectionsMissingFulfillmentHint(['orders_finance'])).toEqual(['orders_finance']);
    expect(sectionsMissingFulfillmentHint(['orders_finance', 'orders'])).toEqual([]);
  });
});

describe('sectionsMissingCertificatesCatalogHint', () => {
  it('подсказывает certificates для certificates_finance', () => {
    expect(sectionsMissingCertificatesCatalogHint(['certificates_finance'])).toEqual([
      'certificates_finance',
    ]);
    expect(
      sectionsMissingCertificatesCatalogHint(['certificates_finance', 'certificates']),
    ).toEqual([]);
  });
});

describe('sectionsMissingOrdersHint (deprecated alias)', () => {
  it('делегирует в sectionsMissingFulfillmentHint', () => {
    expect(sectionsMissingOrdersHint(['orders_finance'])).toEqual(['orders_finance']);
  });
});

describe('staffCanOrdersFinance', () => {
  it('суперадмин или явный grant', () => {
    expect(staffCanOrdersFinance([], true)).toBe(true);
    expect(staffCanOrdersFinance(['orders'], false)).toBe(false);
    expect(staffCanOrdersFinance(['orders', 'orders_finance'], false)).toBe(true);
  });
});

describe('staffCanCertificatesFinance', () => {
  it('суперадмин или явный grant', () => {
    expect(staffCanCertificatesFinance([], true)).toBe(true);
    expect(staffCanCertificatesFinance(['certificates'], false)).toBe(false);
    expect(staffCanCertificatesFinance(['certificates_finance'], false)).toBe(true);
  });
});

describe('staffCanAssistant', () => {
  it('суперадмин или явный grant', () => {
    expect(staffCanAssistant([], true)).toBe(true);
    expect(staffCanAssistant(['dashboard', 'orders'], false)).toBe(false);
    expect(staffCanAssistant(['assistant'], false)).toBe(true);
  });
});
