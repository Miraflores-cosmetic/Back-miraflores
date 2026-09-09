'use client';

import { AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import pn from '@/app/(admin)/admin/catalog/products/productNew.module.css';

const GROUPS_HREF = '/admin/settings/user-groups';

export function UserGroupPageNav({ variant }: { variant: 'list' | 'detail' }) {
  if (variant === 'list') {
    return (
      <div className={pn.stickyToolbarNav}>
        <AdminCompactBtnLink href="/admin/settings" variant="outline">
          ← Настройки
        </AdminCompactBtnLink>
      </div>
    );
  }

  return (
    <div className={pn.stickyToolbarNav}>
      <AdminCompactBtnLink href="/admin/settings" variant="outline">
        ← Настройки
      </AdminCompactBtnLink>
      <AdminCompactBtnLink href={GROUPS_HREF} variant="outline">
        ← Группы
      </AdminCompactBtnLink>
    </div>
  );
}
