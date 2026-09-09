'use client';

import { AdminCompactBtnLink } from '@/components/AdminCompactBtn/AdminCompactBtn';
import pn from '@/app/(admin)/admin/catalog/products/productNew.module.css';

const GROUPS_HREF = '/admin/settings/user-groups';

/** Breadcrumb: канон Users; hub «Настройки» только для суперадмина. */
export function UserGroupPageNav({
  variant,
  showSettingsBack,
}: {
  variant: 'list' | 'detail';
  showSettingsBack: boolean;
}) {
  if (variant === 'list') {
    return (
      <div className={pn.stickyToolbarNav}>
        {showSettingsBack ? (
          <AdminCompactBtnLink href="/admin/settings" variant="outline">
            ← Настройки
          </AdminCompactBtnLink>
        ) : null}
        <AdminCompactBtnLink href="/admin/users" variant="outline">
          ← Пользователи
        </AdminCompactBtnLink>
      </div>
    );
  }

  return (
    <div className={pn.stickyToolbarNav}>
      {showSettingsBack ? (
        <AdminCompactBtnLink href="/admin/settings" variant="outline">
          ← Настройки
        </AdminCompactBtnLink>
      ) : (
        <AdminCompactBtnLink href="/admin/users" variant="outline">
          ← Пользователи
        </AdminCompactBtnLink>
      )}
      <AdminCompactBtnLink href={GROUPS_HREF} variant="outline">
        ← Группы
      </AdminCompactBtnLink>
    </div>
  );
}
