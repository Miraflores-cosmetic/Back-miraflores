import { describe, expect, it } from 'vitest';
import { ADMIN_NAV, type NavItem } from '@/app/(admin)/admin/adminNav';
import {
  adminApiPathToBffPrefix,
  isAllowedAdminBackendPath,
  resolveAdminSectionFromPathname,
  type AdminPathAccessTarget,
} from '@miraflores/admin-sections';

function collectNavHrefs(nav: readonly NavItem[]): Array<{ href: string; section?: string }> {
  const out: Array<{ href: string; section?: string }> = [];
  for (const item of nav) {
    if (item.type === 'link') {
      out.push({ href: item.href, section: item.section });
    } else if (item.type === 'group') {
      for (const child of item.children) {
        out.push({ href: child.href, section: child.section ?? item.section });
      }
    }
  }
  return out;
}

/** staff hub vs grant: pathname resolver может вернуть staff при child.section = settings. */
function expectedPathTarget(
  href: string,
  declared: string | undefined,
): AdminPathAccessTarget | null {
  const resolved = resolveAdminSectionFromPathname(href);
  if (declared === 'staff') return 'staff';
  return resolved;
}

describe('adminNav ↔ admin-sections sync', () => {
  it('каждый href nav резолвится в ACL-секцию', () => {
    for (const { href } of collectNavHrefs(ADMIN_NAV)) {
      expect(resolveAdminSectionFromPathname(href), href).not.toBeNull();
    }
  });

  it('section на пункте nav совпадает с resolveAdminSectionFromPathname', () => {
    for (const { href, section } of collectNavHrefs(ADMIN_NAV)) {
      const expected = expectedPathTarget(href, section);
      expect(resolveAdminSectionFromPathname(href), `${href} (${section})`).toBe(expected);
    }
  });

  it('hub /admin/settings — staff-only (не settings grant)', () => {
    expect(resolveAdminSectionFromPathname('/admin/settings')).toBe('staff');
    expect(resolveAdminSectionFromPathname('/admin/settings/seo')).toBe('settings');
  });
});

/** Sample Nest paths — при новом модуле добавить сюда и в packages/admin-sections index.spec.ts. */
const ADMIN_API_PATH_SAMPLES = [
  '/api/v1/settings/admin/staff-profile',
  '/api/v1/settings/admin/staff',
  '/api/v1/settings/admin/faq',
  '/api/v1/settings/admin/product-attributes',
  '/api/v1/catalog/admin/product-attribute-options',
  '/api/v1/quiz/admin/overview',
  '/api/v1/assistant/admin/chat',
  '/api/v1/catalog/admin/products',
  '/api/v1/orders/admin/abc/mark-paid',
  '/api/v1/orders/admin/abc/packing',
  '/api/v1/auth/admin/me',
] as const;

describe('admin BFF allowlist sync', () => {
  it('sample API paths покрыты BFF prefix allowlist', () => {
    for (const path of ADMIN_API_PATH_SAMPLES) {
      const prefix = adminApiPathToBffPrefix(path);
      expect(prefix, path).not.toBeNull();
      expect(isAllowedAdminBackendPath([...prefix!, 'probe']), path).toBe(true);
    }
  });
});
